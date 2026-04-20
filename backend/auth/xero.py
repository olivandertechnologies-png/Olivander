"""Xero OAuth 2.0 router.

Flow:
  GET /auth/xero            → redirect user to Xero consent screen
  GET /auth/xero/callback   → exchange code, fetch connections, store tokens

Tokens are Fernet-encrypted before storage (same key as Google tokens).
After the callback, postMessage notifies the opener with provider="xero".
No new session JWT is issued — Xero is an additional service connection.
The user must already be authenticated via Google.
"""
import base64
import logging
import secrets
from datetime import datetime, timedelta, timezone
from json import dumps
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from auth.deps import get_current_business
from auth.google import resolve_oauth_message_targets, store_oauth_state, consume_oauth_state
from auth.tokens import _decrypt, _encrypt, _parse_timestamp  # shared helpers
from config import FRONTEND_ORIGIN, XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI
from db.supabase import get_business_by_id, update_xero_tokens
from rate_limit import limiter

router = APIRouter(tags=["xero-auth"])
logger = logging.getLogger("olivander")

XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"

XERO_SCOPES = (
    "openid profile email "
    "accounting.transactions accounting.contacts "
    "offline_access"
)


def _xero_basic_auth() -> str:
    """Base64-encoded client_id:client_secret for token endpoint."""
    if not XERO_CLIENT_ID or not XERO_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Xero OAuth client is not configured.")
    raw = f"{XERO_CLIENT_ID}:{XERO_CLIENT_SECRET}"
    return base64.b64encode(raw.encode()).decode()


def _fetch_xero_tokens(code: str) -> dict[str, Any]:
    """Exchange authorization code for tokens."""
    response = requests.post(
        XERO_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": XERO_REDIRECT_URI,
        },
        headers={
            "Authorization": f"Basic {_xero_basic_auth()}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=20,
    )
    if not response.ok:
        logger.error("Xero token exchange failed: %s %s", response.status_code, response.text)
        raise HTTPException(status_code=502, detail="Xero token exchange failed.")
    return response.json()


def _refresh_xero_tokens(refresh_token: str) -> dict[str, Any]:
    """Use refresh token to obtain a new access token."""
    response = requests.post(
        XERO_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        headers={
            "Authorization": f"Basic {_xero_basic_auth()}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=20,
    )
    if not response.ok:
        logger.error("Xero token refresh failed: %s %s", response.status_code, response.text)
        raise HTTPException(status_code=502, detail="Xero token refresh failed.")
    return response.json()


def _fetch_xero_tenant_id(access_token: str) -> str:
    """Return the first tenant (organization) ID from Xero connections."""
    response = requests.get(
        XERO_CONNECTIONS_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        timeout=20,
    )
    if not response.ok:
        raise HTTPException(status_code=502, detail="Could not fetch Xero organisation list.")
    connections = response.json()
    if not connections:
        raise HTTPException(status_code=400, detail="No Xero organisation found. Please connect a Xero account.")
    return str(connections[0]["tenantId"])


def get_valid_xero_token(business_id: str) -> tuple[str, str]:
    """Return (access_token, tenant_id) for the business, refreshing if needed.

    Raises HTTPException(401) if Xero is not connected.
    """
    business = get_business_by_id(business_id)
    if not business:
        raise HTTPException(status_code=401, detail="Business not found.")

    encrypted_access = business.get("xero_access_token")
    encrypted_refresh = business.get("xero_refresh_token")
    tenant_id = business.get("xero_tenant_id")

    if not encrypted_access or not tenant_id:
        raise HTTPException(status_code=401, detail="Xero is not connected for this account.")

    access_token = _decrypt(encrypted_access)
    token_expiry = _parse_timestamp(business.get("xero_token_expiry"))
    refresh_deadline = datetime.now(timezone.utc) + timedelta(minutes=5)

    if not access_token:
        raise HTTPException(status_code=401, detail="Xero token is missing.")

    if token_expiry is None or token_expiry <= refresh_deadline:
        refresh_token = _decrypt(encrypted_refresh) if encrypted_refresh else None
        if not refresh_token:
            raise HTTPException(status_code=401, detail="Xero refresh token is missing — please reconnect.")

        payload = _refresh_xero_tokens(refresh_token)
        access_token = payload["access_token"]
        new_refresh = payload.get("refresh_token") or refresh_token
        expires_in = int(payload.get("expires_in", 1800))
        expiry = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

        update_xero_tokens(
            business_id,
            _encrypt(access_token),
            _encrypt(new_refresh),
            expiry,
            tenant_id,
        )

    return str(access_token), str(tenant_id)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/auth/xero")
@limiter.limit("10/minute")
async def auth_xero(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> JSONResponse:
    """Return the Xero authorization URL. Called while the user is logged in."""
    if not XERO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Xero OAuth client is not configured.")

    state = secrets.token_urlsafe(32)
    store_oauth_state(state, "")  # no code_verifier needed for Xero

    params = {
        "response_type": "code",
        "client_id": XERO_CLIENT_ID,
        "redirect_uri": XERO_REDIRECT_URI,
        "scope": XERO_SCOPES,
        "state": state,
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return JSONResponse({"url": f"{XERO_AUTH_URL}?{query}"})


@router.get("/auth/xero/callback")
@limiter.limit("10/minute")
async def auth_xero_callback(request: Request) -> HTMLResponse:
    """Handle Xero OAuth callback, store tokens, notify opener via postMessage."""
    if request.query_params.get("error"):
        raise HTTPException(status_code=400, detail="Xero connection was cancelled.")

    state = request.query_params.get("state")
    code = request.query_params.get("code")

    if not state or not code:
        raise HTTPException(status_code=400, detail="Invalid Xero callback parameters.")

    # Validate and consume state (CSRF check)
    consume_oauth_state(state)

    # Exchange code for tokens
    token_payload = _fetch_xero_tokens(code)
    access_token = token_payload.get("access_token", "")
    refresh_token = token_payload.get("refresh_token", "")
    expires_in = int(token_payload.get("expires_in", 1800))
    expiry = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    # Get the Xero tenant (organisation)
    tenant_id = _fetch_xero_tenant_id(access_token)

    # We need to know which business this is — the state alone doesn't carry it.
    # We rely on the frontend to have the session available and pass business_id
    # via the postMessage handler. The callback stores tokens against the business_id
    # that the frontend sends in a follow-up PATCH to /api/connections/xero.
    # For now we store the raw tokens temporarily in a cookie-less state;
    # the frontend immediately calls /api/connections/xero/store with the tokens.
    # SIMPLER APPROACH: just store in a temp session cookie for the callback window.
    # The frontend reads the postMessage and then calls the store endpoint.
    #
    # Actually: pass the tokens back via postMessage payload — the frontend stores
    # them server-side by calling /api/connections/xero (POST) immediately.

    message_targets = resolve_oauth_message_targets(request)

    # Encrypt before putting in the postMessage so tokens are opaque in browser memory.
    # The frontend must POST these immediately to /api/connections/xero/store.
    encrypted_payload = {
        "access_token": _encrypt(access_token),
        "refresh_token": _encrypt(refresh_token),
        "expiry": expiry,
        "tenant_id": tenant_id,
    }

    html = f"""<!doctype html>
<html>
  <body>
    <div id="status">Finishing Xero connection...</div>
    <script>
      const payload = {{
        source: "olivander-xero-oauth",
        provider: "xero",
        status: "connected",
        xeroTokens: {dumps(encrypted_payload)}
      }};
      const targets = {dumps(message_targets)};
      if (window.opener) {{
        for (const target of targets) {{
          try {{
            window.opener.postMessage(payload, target);
          }} catch (error) {{
            console.warn("Could not post OAuth result to", target, error);
          }}
        }}
      }}
      document.getElementById("status").textContent = "Xero connected. You can close this window.";
      window.setTimeout(() => window.close(), 120);
    </script>
  </body>
</html>"""
    return HTMLResponse(content=html)


@router.post("/api/connections/xero/store")
@limiter.limit("10/minute")
async def store_xero_tokens(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Persist encrypted Xero tokens received from the OAuth callback postMessage.

    The frontend calls this immediately after receiving the postMessage from the
    Xero callback window.

    Body: { access_token, refresh_token, expiry, tenant_id } — all Fernet-encrypted.
    """
    body = await request.json()
    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    expiry = body.get("expiry")
    tenant_id = body.get("tenant_id")

    if not access_token or not tenant_id:
        raise HTTPException(status_code=400, detail="Missing Xero token data.")

    update_xero_tokens(business_id, access_token, refresh_token, expiry, tenant_id)
    logger.info("Xero tokens stored for business %s (tenant %s)", business_id, tenant_id)
    return {"success": True, "xero": True}


@router.post("/api/connections/xero/disconnect")
@limiter.limit("10/minute")
async def disconnect_xero(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Clear Xero tokens for the business."""
    update_xero_tokens(business_id, None, None, None, None)
    return {"success": True, "xero": False}
