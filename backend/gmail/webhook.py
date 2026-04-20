import base64
import hmac
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from agent.classify import SKIP_LABELS, classify_email
from agent.draft import draft_reply
from config import FRONTEND_ORIGIN, WEBHOOK_SECRET
from db.supabase import (
    create_approval,
    get_business_by_email,
    get_business_by_id,
    get_memory_profile,
    log_activity,
)
from gmail.client import get_message, get_thread
from auth.tokens import get_valid_token
from jobs.queue import enqueue_job
from notifications.email_sender import send_approval_notification
from rate_limit import limiter

router = APIRouter(tags=["gmail-webhook"])
logger = logging.getLogger("olivander")


def _decode_pubsub_message(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") or {}
    raw_data = message.get("data")

    if not raw_data:
        return {}

    try:
        decoded = base64.b64decode(raw_data)
        return json.loads(decoded.decode("utf-8"))
    except Exception as error:
        logger.error("Webhook decode error: %s", error)
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from error


def _process_gmail_notification(gmail_address: str, history_id: str) -> None:
    """Process a Gmail notification: classify, draft, and queue for approval.

    Synchronous so it can be safely dispatched via asyncio.to_thread(),
    keeping the event loop free while blocking network calls run in a thread.
    """
    try:
        business = get_business_by_email(gmail_address)
        if not business:
            logger.info("No business found for Gmail address: %s", gmail_address)
            return

        business_id = business["id"]
        access_token = get_valid_token(business_id)

        # Get recent messages (for now, just get the latest unread)
        from gmail.client import list_recent_messages
        recent = list_recent_messages(access_token, max_results=1, label_ids=["UNREAD"])

        if not recent:
            logger.info("No recent messages for %s", business_id)
            return

        msg = recent[0]
        msg_id = msg["id"]
        thread_id = msg.get("thread_id")

        # Get full thread
        thread_messages = get_thread(access_token, thread_id) if thread_id else [msg]
        thread_content = "\n---\n".join(
            f"From: {m['from']}\nSubject: {m['subject']}\nDate: {m['date']}\n\n{m['snippet']}"
            for m in reversed(thread_messages)
        )

        # Classify
        classification = classify_email(
            subject=msg["subject"],
            body=msg["snippet"],
            sender=msg["from"],
            business_id=business_id,
        )

        # Skip spam and fyi emails — log them but don't draft or queue
        if classification in SKIP_LABELS:
            log_activity(
                business_id,
                f"Email from {msg['from']}: {msg['subject']} (classified as {classification})",
                activity_type="email_skipped",
                metadata={"gmail_message_id": msg_id, "classification": classification},
            )
            return

        # Get business context
        business_info = get_business_by_id(business_id) or {}
        memory = get_memory_profile(business_id)
        context = {
            "business_name": memory.get("business_name") or business_info.get("business_name") or "",
            "business_type": memory.get("business_type") or "",
            "tone": memory.get("reply_tone") or "Professional but friendly. Direct. No corporate language.",
            "pricing_range": memory.get("pricing_range") or "",
            "payment_terms": memory.get("payment_terms") or "",
            "services": memory.get("services") or "",
        }

        # For booking requests, propose available slots to include in the draft
        available_slots: list[dict] | None = None
        approval_type = "email_reply"
        if classification == "booking_request":
            try:
                from gcal.client import propose_slots
                tz_name = memory.get("timezone") or "Pacific/Auckland"
                hours_start = memory.get("business_hours_start") or "09:00"
                hours_end = memory.get("business_hours_end") or "17:00"
                buffer_minutes = int(memory.get("booking_buffer_minutes") or 15)
                available_slots = propose_slots(
                    access_token,
                    duration_minutes=60,
                    buffer_minutes=buffer_minutes,
                    tz_name=tz_name,
                    hours_start=hours_start,
                    hours_end=hours_end,
                )
                approval_type = "booking_reply"
            except Exception as cal_error:
                logger.warning(
                    "Could not fetch calendar slots for booking request %s: %s",
                    business_id,
                    cal_error,
                )

        # Draft reply (pass full thread context + business_id for cost tracking)
        draft_body = draft_reply(
            subject=msg["subject"],
            body=msg["snippet"],
            sender=msg["from"],
            classification=classification,
            business_context=context,
            thread_context=thread_content,
            business_id=business_id,
            available_slots=available_slots,
        )

        # Create approval
        approval = create_approval(
            business_id=business_id,
            approval_type=approval_type,
            who=msg["from"],
            what=f"Reply to: {msg['subject']}",
            why=f"Classified as {classification}",
            original_email_id=msg_id,
            draft_content=draft_body,
        )

        if approval:
            log_activity(
                business_id,
                f"Approval queued for email from {msg['from']}",
                activity_type="approval_created",
                metadata={
                    "approval_id": approval.get("id"),
                    "gmail_message_id": msg_id,
                    "classification": classification,
                },
            )

            # Send approval notification email to the owner
            approval_id_str = approval.get("id")
            owner_email = business_info.get("email") or ""
            backend_origin = os.getenv("BACKEND_ORIGIN", "https://olivander-api.onrender.com")
            if approval_id_str and owner_email and WEBHOOK_SECRET:
                send_approval_notification(
                    business_id=business_id,
                    approval_id=approval_id_str,
                    approval=approval,
                    owner_email=owner_email,
                    access_token=access_token,
                    frontend_origin=FRONTEND_ORIGIN,
                    backend_origin=backend_origin,
                    webhook_secret=WEBHOOK_SECRET,
                )

        # Enqueue follow-up sequence for new leads
        if classification == "new_lead":
            _enqueue_new_lead_follow_ups(
                business_id=business_id,
                sender_name=msg.get("from_name") or msg.get("from") or "",
                sender_email=msg.get("from") or "",
                subject=msg.get("subject") or "",
                original_body=msg.get("snippet") or "",
                original_email_id=msg_id,
            )

    except Exception as error:
        logger.error("Failed to process Gmail notification: %s", error, exc_info=True)


def _enqueue_new_lead_follow_ups(
    *,
    business_id: str,
    sender_name: str,
    sender_email: str,
    subject: str,
    original_body: str,
    original_email_id: str | None,
) -> None:
    """Enqueue +48h, +5d, +10d follow-ups for a new lead email."""
    base_payload = {
        "business_id": business_id,
        "sequence_type": "new_lead",
        "sender_name": sender_name,
        "sender_email": sender_email,
        "subject": subject,
        "original_body": original_body[:500],
        "original_email_id": original_email_id,
    }
    for step, delay_hours in [(1, 48), (2, 5 * 24), (3, 10 * 24)]:
        try:
            enqueue_job(
                job_type="follow_up_email",
                payload={**base_payload, "step": step},
                delay_seconds=delay_hours * 3600,
                business_id=business_id,
            )
        except Exception as error:
            logger.warning(
                "Could not enqueue new_lead follow-up step %d for %s: %s",
                step,
                business_id,
                error,
            )


@router.post("/webhook/gmail")
@limiter.limit("100/minute")
async def gmail_push_webhook(request: Request) -> dict[str, Any]:
    # Verify secret via Authorization header: Bearer <WEBHOOK_SECRET>
    # Set this in your Pub/Sub push subscription as an Authorization header.
    expected = WEBHOOK_SECRET or ""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()

    if not token or not expected or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    payload = await request.json()
    decoded = _decode_pubsub_message(payload)

    # Process the notification asynchronously
    gmail_address = decoded.get("emailAddress")
    history_id = decoded.get("historyId")

    if gmail_address and history_id:
        # Dispatch in a thread pool so blocking network I/O in the processor
        # does not stall the event loop. Return 200 immediately to Pub/Sub.
        import asyncio
        asyncio.get_event_loop().run_in_executor(
            None, _process_gmail_notification, gmail_address, history_id
        )

    return {
        "received": True,
        "message_id": (payload.get("message") or {}).get("messageId"),
        "subscription": payload.get("subscription"),
    }
