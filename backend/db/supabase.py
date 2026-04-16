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


def create_approval(
    business_id: str,
    approval_type: str,
    who: str | None = None,
    what: str | None = None,
    why: str | None = None,
    original_email_id: str | None = None,
    draft_content: str | None = None,
) -> dict[str, Any] | None:
    """Create a pending approval in the approvals table."""
    response = (
        get_supabase_client()
        .table("approvals")
        .insert({
            "business_id": business_id,
            "status": "pending",
            "type": approval_type,
            "who": who,
            "what": what,
            "why": why,
            "original_email_id": original_email_id,
            "draft_content": draft_content,
            "when_ts": None,
        })
        .execute()
    )
    return _normalise_row(response.data)


def get_approval_by_id(approval_id: str) -> dict[str, Any] | None:
    """Get an approval by ID."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("*")
        .eq("id", approval_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def update_approval_status(
    approval_id: str,
    status: str,
    edited_content: str | None = None,
    when_ts: str | None = None,
) -> None:
    """Update approval status (pending -> approved/rejected/edited)."""
    update_data = {"status": status}
    if edited_content:
        update_data["edited_content"] = edited_content
    if when_ts:
        update_data["when_ts"] = when_ts

    (
        get_supabase_client()
        .table("approvals")
        .update(update_data)
        .eq("id", approval_id)
        .execute()
    )


def log_activity(
    business_id: str,
    description: str,
    activity_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Log an activity/action to the activity table."""
    (
        get_supabase_client()
        .table("activity")
        .insert({
            "business_id": business_id,
            "description": description,
            "type": activity_type,
            "metadata": metadata or {},
        })
        .execute()
    )


def get_approvals_for_business(
    business_id: str,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Get approvals for a business, optionally filtered by status."""
    query = (
        get_supabase_client()
        .table("approvals")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
    )

    if status:
        query = query.eq("status", status)

    response = query.execute()
    return response.data or []
