import base64
import hmac
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from agent.classify import classify_email
from agent.draft import draft_reply
from db.supabase import (
    create_approval,
    get_business_by_email,
    get_business_by_id,
    get_memory_profile,
    log_activity,
)
from gmail.client import get_message, get_thread
from auth.tokens import get_valid_token
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


async def _process_gmail_notification(gmail_address: str, history_id: str) -> None:
    """Process a Gmail notification: classify, draft, and queue for approval."""
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
        )

        # Skip spam and fyi emails - just log them
        if classification in ("ignore",):
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

        # Draft reply
        draft_body = draft_reply(
            subject=msg["subject"],
            body=msg["snippet"],
            sender=msg["from"],
            classification=classification,
            business_context=context,
        )

        # Create approval
        approval = create_approval(
            business_id=business_id,
            approval_type="email_reply",
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

    except Exception as error:
        logger.error("Failed to process Gmail notification: %s", error, exc_info=True)


@router.post("/webhook/gmail")
@limiter.limit("100/minute")
async def gmail_push_webhook(request: Request, token: str = Query(default="")) -> dict[str, Any]:
    # Configure the Pub/Sub push subscription URL as /webhook/gmail?token=WEBHOOK_SECRET
    expected = os.getenv("WEBHOOK_SECRET")

    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    payload = await request.json()
    decoded = _decode_pubsub_message(payload)

    # Process the notification asynchronously
    gmail_address = decoded.get("emailAddress")
    history_id = decoded.get("historyId")

    if gmail_address and history_id:
        # Fire and forget - process in background
        # We return 200 immediately to acknowledge the Pub/Sub message
        try:
            import asyncio
            # Schedule the task to run in the background
            asyncio.create_task(_process_gmail_notification(gmail_address, history_id))
        except Exception as e:
            logger.error(f"Failed to schedule email processing task: {e}")

    return {
        "received": True,
        "message_id": (payload.get("message") or {}).get("messageId"),
        "subscription": payload.get("subscription"),
    }
