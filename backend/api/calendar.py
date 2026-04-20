"""Calendar API endpoints.

GET  /api/calendar/availability  — busy periods for a specific date
GET  /api/calendar/slots         — propose available booking slots
GET  /api/calendar/events        — list events in a date range
POST /api/calendar/events        — queue a calendar event for approval
"""
import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from auth.tokens import get_valid_token
from gcal.client import check_availability, list_events, propose_slots
from db.supabase import create_approval, get_memory_profile, log_activity
from rate_limit import limiter

router = APIRouter(prefix="/api/calendar", tags=["calendar"])
logger = logging.getLogger("olivander")

_DEFAULT_TZ = "Pacific/Auckland"


def _calendar_prefs(business_id: str) -> dict[str, Any]:
    memory = get_memory_profile(business_id)
    return {
        "tz": memory.get("timezone") or _DEFAULT_TZ,
        "hours_start": memory.get("business_hours_start") or "09:00",
        "hours_end": memory.get("business_hours_end") or "17:00",
        "buffer_minutes": int(memory.get("booking_buffer_minutes") or 15),
    }


@router.get("/availability")
@limiter.limit("60/minute")
async def get_availability(
    request: Request,
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    duration: int = Query(60, ge=15, le=480, description="Appointment duration in minutes"),
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Return busy periods for a given date."""
    try:
        prefs = _calendar_prefs(business_id)
        access_token = get_valid_token(business_id)
        tz = ZoneInfo(prefs["tz"])

        try:
            target = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc

        start_h, start_m = map(int, prefs["hours_start"].split(":"))
        end_h, end_m = map(int, prefs["hours_end"].split(":"))
        day_start = datetime(target.year, target.month, target.day, start_h, start_m, tzinfo=tz)
        day_end = datetime(target.year, target.month, target.day, end_h, end_m, tzinfo=tz)

        busy = check_availability(access_token, time_min=day_start, time_max=day_end)
        return {
            "date": date,
            "duration_minutes": duration,
            "timezone": prefs["tz"],
            "business_hours": {"start": prefs["hours_start"], "end": prefs["hours_end"]},
            "busy_periods": busy,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error("Calendar availability error for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not fetch availability.") from error


@router.get("/slots")
@limiter.limit("60/minute")
async def get_slots(
    request: Request,
    duration: int = Query(60, ge=15, le=480, description="Appointment duration in minutes"),
    count: int = Query(3, ge=1, le=5, description="Number of slots to propose"),
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Propose available booking slots for the next 7 business days."""
    try:
        prefs = _calendar_prefs(business_id)
        access_token = get_valid_token(business_id)

        slots = propose_slots(
            access_token,
            duration_minutes=duration,
            buffer_minutes=prefs["buffer_minutes"],
            tz_name=prefs["tz"],
            hours_start=prefs["hours_start"],
            hours_end=prefs["hours_end"],
            num_slots=count,
        )
        return {"slots": slots, "timezone": prefs["tz"], "duration_minutes": duration}

    except HTTPException:
        raise
    except Exception as error:
        logger.error("Slot proposal error for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not propose slots.") from error


@router.get("/events")
@limiter.limit("60/minute")
async def get_events(
    request: Request,
    from_date: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    """List calendar events in a date range (inclusive)."""
    try:
        prefs = _calendar_prefs(business_id)
        access_token = get_valid_token(business_id)
        tz = ZoneInfo(prefs["tz"])

        try:
            t_min = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=tz)
            t_max = datetime.strptime(to_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=tz
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD") from exc

        return list_events(access_token, time_min=t_min, time_max=t_max)

    except HTTPException:
        raise
    except Exception as error:
        logger.error("Calendar events error for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not fetch events.") from error


class CreateEventRequest(BaseModel):
    summary: str
    start: str
    end: str
    description: str | None = None
    attendee_email: str | None = None


@router.post("/events")
@limiter.limit("30/minute")
async def queue_calendar_event(
    request: Request,
    payload: CreateEventRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Queue a calendar event for approval.

    Event details are stored as JSON in draft_content and executed only when
    the owner approves via the dashboard or email tap.
    """
    event_json = json.dumps({
        "summary": payload.summary,
        "start": payload.start,
        "end": payload.end,
        "description": payload.description,
        "attendee_email": payload.attendee_email,
    })

    approval = create_approval(
        business_id=business_id,
        approval_type="calendar_event",
        who=payload.attendee_email or "",
        what=f"Create event: {payload.summary}",
        why="Calendar event needs owner approval before being confirmed.",
        draft_content=event_json,
    )
    if not approval:
        raise HTTPException(status_code=500, detail="Could not create approval.")

    log_activity(
        business_id,
        f"Calendar event approval queued: {payload.summary}",
        activity_type="approval_created",
        metadata={"approval_id": approval.get("id"), "event_summary": payload.summary},
    )

    return {
        "status": "pending_approval",
        "approval_id": approval.get("id"),
        "summary": payload.summary,
    }
