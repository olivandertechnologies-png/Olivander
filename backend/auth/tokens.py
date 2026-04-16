import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from cryptography.fernet import Fernet
from fastapi import HTTPException

from config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from db.supabase import (
    get_business_by_email,
    get_business_by_id,
    update_tokens,
    upsert_business,
)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.getenv("ENCRYPTION_KEY")
        if not key:
            raise RuntimeError("ENCRYPTION_KEY is not set")
        _fernet = Fernet(key.encode())
    return _fernet


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        normalised = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalised)

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)

        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _encrypt(value: str | None) -> str | None:
    if not value:
        return None

    return _get_fernet().encrypt(value.encode()).decode()


def _decrypt(value: str | None) -> str | None:
    if not value:
        return None

    return _get_fernet().decrypt(value.encode()).decode()


def _get_decrypted_tokens(business: dict[str, Any]) -> tuple[str | None, str | None]:
    return (
        _decrypt(business.get("access_token")) if business.get("access_token") else None,
        _decrypt(business.get("refresh_token")) if business.get("refresh_token") else None,
    )


def upsert_business_tokens(
    *,
    email: str,
    access_token: str,
    refresh_token: str | None,
    token_expiry: datetime | None,
    business_name: str | None = None,
    contact_name: str | None = None,
) -> dict[str, Any]:
    existing = get_business_by_email(email)
    existing_refresh_token = (
        _decrypt(existing.get("refresh_token"))
        if existing and existing.get("refresh_token")
        else None
    )
    payload = {
        "email": email,
        "business_name": business_name or (existing.get("business_name") if existing else None),
        "contact_name": contact_name or (existing.get("contact_name") if existing else None),
        "access_token": _encrypt(access_token),
        "refresh_token": _encrypt(refresh_token or existing_refresh_token),
        "token_expiry": token_expiry.astimezone(timezone.utc).isoformat() if token_expiry else None,
        "onboarded": existing.get("onboarded", False) if existing else False,
    }

    business = upsert_business(payload) or get_business_by_email(email)

    if not business:
        raise RuntimeError("Could not persist Google OAuth tokens in Supabase.")

    return business


def clear_business_tokens(business_id: str) -> None:
    update_tokens(business_id, None, None, None)


def _refresh_access_token(business: dict[str, Any]) -> str:
    _, refresh_token = _get_decrypted_tokens(business)

    if not refresh_token:
        raise HTTPException(status_code=401, detail="Google refresh token is missing.")

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth is not configured.")

    response = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(status_code=502, detail="Google token refresh failed.")

    payload = response.json()
    access_token = payload.get("access_token")

    if not access_token:
        raise HTTPException(status_code=502, detail="Google token refresh did not return an access token.")

    expires_in = int(payload.get("expires_in", 3600))
    token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    next_refresh_token = payload.get("refresh_token") or refresh_token

    update_tokens(
        str(business["id"]),
        _encrypt(access_token),
        _encrypt(next_refresh_token),
        token_expiry.isoformat(),
    )

    return access_token


def get_valid_token(business_id: str) -> str:
    business = get_business_by_id(business_id)

    if not business:
        raise HTTPException(status_code=401, detail="Business session is invalid.")

    access_token, _ = _get_decrypted_tokens(business)
    token_expiry = _parse_timestamp(business.get("token_expiry"))
    refresh_deadline = datetime.now(timezone.utc) + timedelta(minutes=5)

    if not access_token:
        raise HTTPException(status_code=401, detail="Google account is not connected.")

    if token_expiry is None or token_expiry <= refresh_deadline:
        return _refresh_access_token(business)

    return access_token
