"""Lead pipeline API endpoints.

PRD v6.0 Section 8.5 — MVP addition.
A lightweight pipeline derived from email classifications. Not CRM — just
never dropping a ball.

Stages: new_enquiry → contacted → quote_sent → quote_accepted → won | lost
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from db.supabase import (
    create_lead,
    get_lead,
    get_lead_pipeline_summary,
    get_leads,
    log_activity,
    update_lead,
)
from rate_limit import limiter

router = APIRouter(prefix="/api/leads", tags=["leads"])
logger = logging.getLogger("olivander")

VALID_STAGES = {"new_enquiry", "contacted", "quote_sent", "quote_accepted", "won", "lost"}
VALID_SOURCES = {"email", "manual", "research"}


class LeadCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    source: str = "manual"
    enquiry_type: str | None = None
    notes: str | None = None
    thread_id: str | None = None


class LeadUpdate(BaseModel):
    stage: str | None = None
    notes: str | None = None
    email: str | None = None
    phone: str | None = None
    follow_up_due_at: str | None = None


@router.get("/summary")
@limiter.limit("60/minute")
async def pipeline_summary(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Summary counts for the Home screen lead badge."""
    return get_lead_pipeline_summary(business_id)


@router.get("")
@limiter.limit("60/minute")
async def list_leads(
    request: Request,
    stage: str | None = None,
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    if stage and stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {stage}")
    return get_leads(business_id, stage=stage)


@router.post("")
@limiter.limit("30/minute")
async def create_lead_entry(
    request: Request,
    payload: LeadCreate,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    if payload.source not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid source: {payload.source}")

    lead = create_lead(
        business_id,
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        source=payload.source,
        enquiry_type=payload.enquiry_type,
        notes=payload.notes,
        thread_id=payload.thread_id,
    )
    if not lead:
        raise HTTPException(status_code=500, detail="Could not create lead.")

    log_activity(
        business_id,
        f"Lead added: {payload.name}",
        activity_type="lead_created",
        metadata={"lead_id": lead.get("id"), "source": payload.source},
    )
    return lead


@router.patch("/{lead_id}")
@limiter.limit("30/minute")
async def patch_lead(
    request: Request,
    lead_id: str,
    payload: LeadUpdate,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    if payload.stage and payload.stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {payload.stage}")

    existing = get_lead(business_id, lead_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Lead not found.")

    updates: dict[str, Any] = {}
    if payload.stage is not None:
        updates["stage"] = payload.stage
        if payload.stage in ("won", "lost"):
            from datetime import datetime, timezone
            updates["closed_at"] = datetime.now(timezone.utc).isoformat()
    if payload.notes is not None:
        updates["notes"] = payload.notes
    if payload.email is not None:
        updates["email"] = payload.email
    if payload.phone is not None:
        updates["phone"] = payload.phone
    if payload.follow_up_due_at is not None:
        updates["follow_up_due_at"] = payload.follow_up_due_at

    if not updates:
        return existing

    result = update_lead(business_id, lead_id, updates)
    if not result:
        raise HTTPException(status_code=500, detail="Could not update lead.")

    if payload.stage and payload.stage != existing.get("stage"):
        log_activity(
            business_id,
            f"Lead {existing.get('name')} moved to {payload.stage}",
            activity_type="lead_stage_changed",
            metadata={"lead_id": lead_id, "from": existing.get("stage"), "to": payload.stage},
        )

    return result
