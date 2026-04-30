"""Google Calendar implementation of CalendarProvider."""
from datetime import datetime
from typing import Any

import requests
from fastapi import HTTPException

from providers.base import CalendarProvider

CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"


class GCalProvider(CalendarProvider):
    """Wraps gcal/client.py functions behind the CalendarProvider interface."""

    def get_availability(
        self,
        access_token: str,
        start: datetime,
        end: datetime,
        buffer_mins: int = 15,
    ) -> list[dict[str, str]]:
        from gcal.client import check_availability
        return check_availability(access_token, time_min=start, time_max=end)

    def propose_slots(
        self,
        access_token: str,
        duration_minutes: int,
        buffer_minutes: int = 15,
        tz_name: str = "Pacific/Auckland",
        hours_start: str = "09:00",
        hours_end: str = "17:00",
        num_slots: int = 3,
    ) -> list[dict[str, str]]:
        from gcal.client import propose_slots
        return propose_slots(
            access_token,
            duration_minutes=duration_minutes,
            buffer_minutes=buffer_minutes,
            tz_name=tz_name,
            hours_start=hours_start,
            hours_end=hours_end,
            num_slots=num_slots,
        )

    def create_event(
        self,
        access_token: str,
        *,
        summary: str,
        start: str,
        end: str,
        description: str | None = None,
        attendee_email: str | None = None,
        tz_name: str = "Pacific/Auckland",
    ) -> str:
        from gcal.client import create_event
        result = create_event(
            access_token,
            summary=summary,
            start=start,
            end=end,
            description=description,
            attendee_email=attendee_email,
            tz_name=tz_name,
        )
        return str(result.get("id", ""))

    def update_event(
        self,
        access_token: str,
        event_id: str,
        changes: dict[str, Any],
    ) -> str:
        response = requests.patch(
            f"{CALENDAR_API_BASE}/calendars/primary/events/{event_id}",
            json=changes,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Calendar update event failed with status {response.status_code}.",
            )
        return event_id

    def delete_event(self, access_token: str, event_id: str) -> bool:
        response = requests.delete(
            f"{CALENDAR_API_BASE}/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
        return response.ok or response.status_code == 410  # 410 = already deleted

    def list_events(
        self,
        access_token: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        from gcal.client import list_events
        return list_events(access_token, time_min=start, time_max=end)

    def watch(
        self,
        access_token: str,
        calendar_id: str,
        webhook_url: str,
    ) -> dict[str, Any]:
        import uuid
        response = requests.post(
            f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events/watch",
            json={
                "id": str(uuid.uuid4()),
                "type": "web_hook",
                "address": webhook_url,
            },
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Calendar watch setup failed with status {response.status_code}.",
            )
        return response.json()
