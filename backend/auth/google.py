import logging
import os
import secrets
from json import dumps
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import google_auth_oauthlib.flow
import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from jose import jwt

from auth.tokens import upsert_business_tokens
from config import (
    FRONTEND_ORIGIN,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_SCOPES,
)
from db.supabase import get_supabase_client
from rate_limit import limiter

router = APIRouter(tags=["google-auth"])
logger = logging.getLogger("olivander")
OAUTH_ORIGIN_COOKIE = "olivander_oauth_origin"


def normalise_origin(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlparse(value)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    return f"{parsed.scheme}://{parsed.netloc}"


def resolve_oauth_message_targets(request: Request) -> list[str]:
    origins = [
        request.cookies.get(OAUTH_ORIGIN_COOKIE),
        request.headers.get("origin"),
        FRONTEND_ORIGIN,
        str(request.base_url).rstrip("/"),
    ]
    unique_targets: list[str] = []

    for origin in origins:
        normalised = normalise_origin(origin)

        if normalised and normalised not in unique_targets:
            unique_targets.append(normalised)

    return unique_targets


def create_google_flow(state: str | None = None):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth client is not configured.")

    flow = google_auth_oauthlib.flow.Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=GOOGLE_SCOPES,
        state=state,
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI
    return flow


def create_session_token(business_id: str, email: str, contact_name: str | None = None) -> str:
    payload = {
        "business_id": business_id,
        "email": email,
        "contact_name": contact_name,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, os.getenv("JWT_SECRET"), algorithm="HS256")


def store_oauth_state(state: str) -> None:
    (
        get_supabase_client()
        .table("oauth_states")
        .upsert(
            {
                "state": state,
                "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            }
        )
        .execute()
    )


def consume_oauth_state(state: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    response = (
        get_supabase_client()
        .table("oauth_states")
        .select("state, expires_at")
        .eq("state", state)
        .gt("expires_at", now)
        .limit(1)
        .execute()
    )
    rows = response.data or []

    if not rows:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    (
        get_supabase_client()
        .table("oauth_states")
        .delete()
        .eq("state", state)
        .execute()
    )


def fetch_google_userinfo(access_token: str) -> dict[str, Any]:
    response = requests.get(
        "https://www.googleapis.com/oauth2/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(status_code=502, detail="Google userinfo lookup failed.")

    payload = response.json()

    if not payload.get("email"):
        raise HTTPException(status_code=502, detail="Google userinfo did not return an email address.")

    return payload


@router.get("/auth/google")
@limiter.limit("10/minute")
async def auth_google(request: Request) -> JSONResponse:
    state = secrets.token_urlsafe(32)
    store_oauth_state(state)
    flow = create_google_flow(state=state)
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    response = JSONResponse({"url": authorization_url})
    frontend_origin = normalise_origin(request.headers.get("origin")) or normalise_origin(
        FRONTEND_ORIGIN
    )

    if frontend_origin:
        response.set_cookie(
            OAUTH_ORIGIN_COOKIE,
            frontend_origin,
            max_age=600,
            httponly=True,
            samesite="lax",
            secure=frontend_origin.startswith("https://"),
            path="/",
        )

    return response


@router.get("/auth/google/callback")
@limiter.limit("10/minute")
async def auth_google_callback(request: Request) -> HTMLResponse:
    if request.query_params.get("error"):
        raise HTTPException(status_code=400, detail="Google sign-in was cancelled.")

    state = request.query_params.get("state")

    if not state:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    consume_oauth_state(state)
    flow = create_google_flow(state=state)

    try:
        flow.fetch_token(authorization_response=str(request.url))
    except Exception as error:
        logger.warning("Google OAuth token exchange failed: %s", error)
        raise HTTPException(status_code=400, detail="Google sign-in could not be completed.") from error

    credentials = flow.credentials
    access_token = credentials.token
    refresh_token = credentials.refresh_token
    token_expiry = credentials.expiry

    if token_expiry is None:
        token_expiry = datetime.now(timezone.utc) + timedelta(seconds=3600)

    userinfo = fetch_google_userinfo(access_token)
    business = upsert_business_tokens(
        email=userinfo["email"],
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=token_expiry,
        business_name=userinfo.get("name"),
        contact_name=userinfo.get("given_name"),
    )

    business_id = str(business["id"])
    session_token = create_session_token(
        business_id,
        userinfo["email"],
        business.get("contact_name") or userinfo.get("given_name"),
    )
    message_targets = resolve_oauth_message_targets(request)
    response = HTMLResponse(
        f"""
        <!doctype html>
        <html>
          <body>
            <div id="status">Finishing Google connection...</div>
            <script>
              const payload = {{
                source: "olivander-google-oauth",
                provider: "google",
                status: "connected",
                session: {dumps(session_token)},
                businessId: {dumps(business_id)}
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
              document.getElementById("status").textContent = "Google connected. You can close this window.";
              window.setTimeout(() => window.close(), 120);
            </script>
          </body>
        </html>
        """
    )
    response.delete_cookie(
        OAUTH_ORIGIN_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return response
