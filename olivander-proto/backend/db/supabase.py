import logging
from typing import Any

from supabase import Client, create_client

from config import SUPABASE_KEY, SUPABASE_URL

_supabase_client: Client | None = None
logger = logging.getLogger("olivander")


def _normalise_row(data: Any) -> dict[str, Any] | None:
    if not data:
        return None

    if isinstance(data, list):
        return data[0] if data else None

    if isinstance(data, dict):
        return data

    return None


def verify_supabase_connection() -> None:
    supabase = get_supabase_client()

    try:
        supabase.table("businesses").select("id").limit(1).execute()
    except Exception as error:
        raise RuntimeError("Supabase connection failed.") from error

    logger.info("Supabase connected")


def get_supabase_client() -> Client:
    global _supabase_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in backend/.env."
        )

    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

    return _supabase_client


def get_business_by_id(business_id: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .select("*")
        .eq("id", business_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def get_business_by_email(email: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def upsert_business(data: dict[str, Any]) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .upsert(data, on_conflict="email")
        .execute()
    )
    return _normalise_row(response.data)


def update_tokens(
    business_id: str,
    access_token: str | None,
    refresh_token: str | None,
    expiry: str | None,
) -> None:
    (
        get_supabase_client()
        .table("businesses")
        .update(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expiry": expiry,
            }
        )
        .eq("id", business_id)
        .execute()
    )


def get_memory_profile(business_id: str) -> dict[str, str]:
    response = (
        get_supabase_client()
        .table("memory")
        .select("key, value")
        .eq("business_id", business_id)
        .execute()
    )
    rows = response.data or []
    return {
        str(row.get("key")): str(row.get("value"))
        for row in rows
        if row.get("key") is not None and row.get("value") is not None
    }


def set_memory_value(business_id: str, key: str, value: str) -> None:
    existing = (
        get_supabase_client()
        .table("memory")
        .select("id")
        .eq("business_id", business_id)
        .eq("key", key)
        .limit(1)
        .execute()
    )
    row = _normalise_row(existing.data)

    if row and row.get("id"):
        (
            get_supabase_client()
            .table("memory")
            .update({"value": value})
            .eq("id", row["id"])
            .execute()
        )
        return

    (
        get_supabase_client()
        .table("memory")
        .insert({"business_id": business_id, "key": key, "value": value})
        .execute()
    )
