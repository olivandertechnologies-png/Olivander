"""Google Calendar API client.

Wraps the Calendar REST API using the same pattern as gmail/client.py — plain
requests calls, access token supplied by the caller, FastAPI HTTPExceptions on errors.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests
from fastapi import HTTPException

logger = logging.getLogger("olivander")

CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
DEFAULT_TZ = "Pacific/Auckland"
DEFAULT_BUFFER_MINUTES = 15
DEFAULT_HOURS_START = "09:00"
DEFAULT_HOURS_END = "17:00"
LOOKAHEAD_BUSINESS_DAYS = 7
SLOT_INCREMENT_MINUTES = 30


def _cal_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _ensure_aware(value: datetime, *, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must include timezone information.",
        )
    return value


def _parse_google_datetime(value: str, tz: ZoneInfo) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(tz)


def _round_up_to_increment(value: datetime, minutes: int) -> datetime:
    rounded = value.replace(second=0, microsecond=0)
    remainder = rounded.minute % minutes
    if remainder == 0 and value.second == 0 and value.microsecond == 0:
        return rounded

    minutes_to_add = (minutes - remainder) % minutes
    if minutes_to_add == 0:
        minutes_to_add = minutes
    return (rounded + timedelta(minutes=minutes_to_add)).replace(second=0, microsecond=0)


def list_events(
    access_token: str,
    *,
    time_min: datetime,
    time_max: datetime,
    calendar_id: str = "primary",
    max_results: int = 100,
) -> list[dict[str, Any]]:
    """List events in a time window, ordered by start time."""
    time_min = _ensure_aware(time_min, field_name="time_min")
    time_max = _ensure_aware(time_max, field_name="time_max")

    response = requests.get(
        f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events",
        params={
            "timeMin": time_min.isoformat(),
            "timeMax": time_max.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": max_results,
        },
        headers=_cal_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Calendar list events failed with status {response.status_code}.",
        )

    result = []
    for item in response.json().get("items", []) or []:
        start = item.get("start", {})
        end = item.get("end", {})
        result.append({
            "id": item.get("id"),
            "summary": item.get("summary") or "",
            "start": start.get("dateTime") or start.get("date"),
            "end": end.get("dateTime") or end.get("date"),
            "status": item.get("status", "confirmed"),
        })
    return result


def check_availability(
    access_token: str,
    *,
    time_min: datetime,
    time_max: datetime,
    calendar_id: str = "primary",
) -> list[dict[str, str]]:
    """Return busy periods within the range using the freeBusy API.

    Returns a list of {'start': ISO, 'end': ISO}. Empty list means fully free.
    """
    time_min = _ensure_aware(time_min, field_name="time_min")
    time_max = _ensure_aware(time_max, field_name="time_max")

    response = requests.post(
        f"{CALENDAR_API_BASE}/freeBusy",
        json={
            "timeMin": time_min.isoformat(),
            "timeMax": time_max.isoformat(),
            "items": [{"id": calendar_id}],
        },
        headers={**_cal_headers(access_token), "Content-Type": "application/json"},
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Calendar freeBusy failed with status {response.status_code}.",
        )

    busy = (
        response.json()
        .get("calendars", {})
        .get(calendar_id, {})
        .get("busy", [])
    ) or []
    return [{"start": b["start"], "end": b["end"]} for b in busy]


def propose_slots(
    access_token: str,
    *,
    duration_minutes: int,
    buffer_minutes: int = DEFAULT_BUFFER_MINUTES,
    tz_name: str = DEFAULT_TZ,
    hours_start: str = DEFAULT_HOURS_START,
    hours_end: str = DEFAULT_HOURS_END,
    num_slots: int = 3,
    calendar_id: str = "primary",
) -> list[dict[str, str]]:
    """Return up to num_slots available booking slots over the next 7 business days.

    Each slot dict has 'start' and 'end' (ISO strings with tz offset) plus
    'display' (human-readable, e.g. 'Monday 7 April, 10am–11am').
    """
    tz = ZoneInfo(tz_name)
    now_local = datetime.now(tz)

    if duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes must be positive.")
    if buffer_minutes < 0:
        raise HTTPException(status_code=400, detail="buffer_minutes cannot be negative.")
    if num_slots < 1:
        return []

    start_h, start_m = map(int, hours_start.split(":"))
    end_h, end_m = map(int, hours_end.split(":"))
    slot_delta = timedelta(minutes=duration_minutes)
    buffer_delta = timedelta(minutes=buffer_minutes)
    slot_increment = timedelta(minutes=SLOT_INCREMENT_MINUTES)

    business_days: list[tuple[datetime, datetime]] = []
    candidate_date = now_local.date()
    while len(business_days) < LOOKAHEAD_BUSINESS_DAYS:
        if candidate_date.weekday() < 5:
            day_start = datetime(
                candidate_date.year,
                candidate_date.month,
                candidate_date.day,
                start_h,
                start_m,
                0,
                tzinfo=tz,
            )
            day_end = datetime(
                candidate_date.year,
                candidate_date.month,
                candidate_date.day,
                end_h,
                end_m,
                0,
                tzinfo=tz,
            )
            if day_end <= day_start:
                raise HTTPException(
                    status_code=400,
                    detail="Business hours end must be after the start time.",
                )
            business_days.append((day_start, day_end))
        candidate_date += timedelta(days=1)

    window_start = business_days[0][0].replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = business_days[-1][1]
    busy_periods = check_availability(
        access_token,
        time_min=window_start.astimezone(timezone.utc),
        time_max=window_end.astimezone(timezone.utc),
        calendar_id=calendar_id,
    )

    # Parse busy periods into local timezone, expanding each by buffer
    busy: list[tuple[datetime, datetime]] = []
    for b in busy_periods:
        bs = _parse_google_datetime(b["start"], tz)
        be = _parse_google_datetime(b["end"], tz)
        busy.append((bs - buffer_delta, be + buffer_delta))

    def _is_free(start: datetime, end: datetime) -> bool:
        return not any(start < be and end > bs for bs, be in busy)

    slots: list[dict[str, str]] = []
    for day_start, day_end in business_days:
        candidate = day_start
        if day_start.date() == now_local.date():
            candidate = max(day_start, _round_up_to_increment(now_local, SLOT_INCREMENT_MINUTES))

        while candidate + slot_delta <= day_end:
            if _is_free(candidate, candidate + slot_delta):
                end_dt = candidate + slot_delta
                slots.append({
                    "start": candidate.isoformat(),
                    "end": end_dt.isoformat(),
                    "display": _format_slot(candidate, end_dt),
                })
                if len(slots) >= num_slots:
                    break
                # Advance past the booked slot + buffer before seeking the next
                candidate = end_dt + buffer_delta
            else:
                candidate += slot_increment

        if len(slots) >= num_slots:
            break

    return slots


def _format_slot(start: datetime, end: datetime) -> str:
    """Return a human-readable slot string, e.g. 'Monday 7 April, 10am–11am'."""
    day = f"{start.strftime('%A')} {start.day} {start.strftime('%B')}"

    def _t(dt: datetime) -> str:
        hour = dt.hour % 12 or 12
        period = "am" if dt.hour < 12 else "pm"
        if dt.minute:
            return f"{hour}:{dt.strftime('%M')}{period}"
        return f"{hour}{period}"

    return f"{day}, {_t(start)}–{_t(end)}"


def create_event(
    access_token: str,
    *,
    summary: str,
    start: str,
    end: str,
    description: str | None = None,
    attendee_email: str | None = None,
    tz_name: str = DEFAULT_TZ,
    calendar_id: str = "primary",
) -> dict[str, Any]:
    """Create a calendar event and return the created resource."""
    body: dict[str, Any] = {
        "summary": summary,
        "start": {"dateTime": start, "timeZone": tz_name},
        "end": {"dateTime": end, "timeZone": tz_name},
    }
    if description:
        body["description"] = description
    if attendee_email:
        body["attendees"] = [{"email": attendee_email}]

    response = requests.post(
        f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events",
        json=body,
        headers={**_cal_headers(access_token), "Content-Type": "application/json"},
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Calendar create event failed with status {response.status_code}.",
        )

    return response.json()


def get_event(
    access_token: str,
    event_id: str,
    *,
    calendar_id: str = "primary",
) -> dict[str, Any]:
    """Fetch a single event by ID."""
    response = requests.get(
        f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events/{event_id}",
        headers=_cal_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Calendar get event failed with status {response.status_code}.",
        )

    return response.json()
