"""Client records — lightweight contact list derived from approvals history.

Provides:
  GET  /api/clients          → unique contacts seen in approvals, last interaction
  GET  /api/clients/{email}  → single contact detail with interaction history
  POST /api/clients/{email}/notes  → add a note against a contact
"""
import logging
from email.utils import parseaddr
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from db.supabase import get_supabase_client
from rate_limit import limiter

router = APIRouter(prefix="/api/clients", tags=["clients"])
logger = logging.getLogger("olivander")


class ClientNoteRequest(BaseModel):
    note: str


def _parse_who(who: str) -> tuple[str, str]:
    """Return (name, email) from a 'Name <email>' string."""
    name, email = parseaddr(who or "")
    if not email:
        email = who
        name = who
    return name.strip(), email.strip().lower()


def _build_client_record(email: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate approval rows for a single contact email into a client record."""
    sorted_rows = sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)
    latest = sorted_rows[0]
    name, _ = _parse_who(latest.get("who") or "")

    return {
        "email": email,
        "name": name or email,
        "last_interaction": latest.get("created_at"),
        "total_interactions": len(rows),
        "statuses": {
            "approved": sum(1 for r in rows if r.get("status") == "approved"),
            "rejected": sum(1 for r in rows if r.get("status") == "rejected"),
            "pending": sum(1 for r in rows if r.get("status") == "pending"),
        },
    }


def _get_client_notes(business_id: str, contact_email: str) -> list[dict[str, Any]]:
    try:
        response = (
            get_supabase_client()
            .table("client_notes")
            .select("id, note, created_at")
            .eq("business_id", business_id)
            .eq("contact_email", contact_email)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []
    except Exception:
        return []


@router.get("")
@limiter.limit("60/minute")
async def list_clients(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    """Return a deduplicated list of contacts the business has interacted with."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("who, status, created_at")
        .eq("business_id", business_id)
        .not_.is_("who", "null")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    rows = response.data or []

    # Group by normalised email
    by_email: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        _, email = _parse_who(row.get("who") or "")
        if email:
            by_email.setdefault(email, []).append(row)

    clients = [_build_client_record(email, group) for email, group in by_email.items()]
    clients.sort(key=lambda c: c["last_interaction"] or "", reverse=True)
    return clients


@router.get("/{contact_email:path}")
@limiter.limit("60/minute")
async def get_client(
    request: Request,
    contact_email: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Return a single contact's interaction history and notes."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("id, who, what, why, status, draft_content, edited_content, created_at")
        .eq("business_id", business_id)
        .ilike("who", f"%{contact_email}%")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    rows = response.data or []

    if not rows:
        raise HTTPException(status_code=404, detail="No interactions found for this contact.")

    record = _build_client_record(contact_email, rows)
    record["interactions"] = [
        {
            "id": r.get("id"),
            "subject": r.get("what"),
            "why": r.get("why"),
            "status": r.get("status"),
            "created_at": r.get("created_at"),
        }
        for r in rows
    ]
    record["notes"] = _get_client_notes(business_id, contact_email)
    return record


@router.post("/{contact_email:path}/notes")
@limiter.limit("30/minute")
async def add_client_note(
    request: Request,
    contact_email: str,
    payload: ClientNoteRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Add a note against a contact."""
    note = payload.note.strip()
    if not note:
        raise HTTPException(status_code=400, detail="Note cannot be empty.")

    try:
        response = (
            get_supabase_client()
            .table("client_notes")
            .insert({"business_id": business_id, "contact_email": contact_email.lower(), "note": note})
            .execute()
        )
        row = (response.data or [{}])[0]
        return {"id": row.get("id"), "note": note, "created_at": row.get("created_at")}
    except Exception as error:
        logger.error("Failed to save client note for %s: %s", contact_email, error)
        raise HTTPException(status_code=500, detail="Could not save note.") from error
