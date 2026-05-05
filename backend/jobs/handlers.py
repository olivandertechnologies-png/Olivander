"""Job handlers for each job_type in the job_queue table.

Each handler receives the job row dict and must complete the work or raise.
Handlers are called from the JobRunner in a thread pool so they may use
blocking I/O freely.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("olivander")


# ---------------------------------------------------------------------------
# follow_up_email
# ---------------------------------------------------------------------------
# Payload: {
#   "business_id": str,
#   "sequence_type": "new_lead" | "quote_sent" | "post_job" | "meeting_booked",
#   "step": int,                # 1-based index in the sequence
#   "original_email_id": str,
#   "sender_name": str,
#   "sender_email": str,
#   "subject": str,
#   "original_body": str,
# }

_FOLLOW_UP_PROMPTS: dict[str, dict[int, str]] = {
    "new_lead": {
        1: (
            "Write a brief, warm follow-up to a potential new customer who enquired "
            "two days ago and hasn't replied yet. Reference their original enquiry "
            "briefly, ask if they'd still like to proceed, and offer one clear next step. "
            "Two to three sentences only."
        ),
        2: (
            "Write a short 5-day follow-up to a potential customer we haven't heard back from. "
            "Keep it friendly but direct. Acknowledge they're probably busy. "
            "Offer to answer any questions. Two sentences maximum."
        ),
        3: (
            "Write a final courteous follow-up to a lead after 10 days of no response. "
            "Let them know you're leaving the door open for whenever the timing is right. "
            "One to two sentences only."
        ),
    },
    "quote_sent": {
        1: (
            "Write a brief 3-day follow-up after sending a quote. "
            "Check if they've had a chance to review it and if they have any questions. "
            "Two sentences maximum."
        ),
        2: (
            "Write a 7-day follow-up after sending a quote. "
            "Reiterate that you're ready to get started and ask if the timing still works. "
            "Two sentences maximum."
        ),
    },
    "post_job": {
        1: (
            "Write a warm thank-you message to send the day after completing a job. "
            "Thank them for their business, confirm the work is complete, and let them know "
            "you're available if anything comes up. Two to three sentences."
        ),
        2: (
            "Write a friendly 7-day follow-up asking if everything is going well after "
            "the recent job. If appropriate, mention that a Google or Facebook review "
            "would be greatly appreciated. Two to three sentences."
        ),
    },
    "meeting_booked": {
        1: (
            "Write a brief 24-hour reminder for tomorrow's meeting. Confirm the time and "
            "mention that you're looking forward to it. One to two sentences."
        ),
        2: (
            "Write a brief 2-hour reminder for an upcoming meeting today. Confirm you'll "
            "be there and share any last-minute details if relevant. One sentence."
        ),
    },
}


def _draft_follow_up(
    sequence_type: str,
    step: int,
    sender_name: str,
    sender_email: str,
    subject: str,
    original_body: str,
    business_context: dict[str, Any],
    business_id: str,
) -> str:
    """Use the AI provider to draft a follow-up email body."""
    from core.ai import get_ai_provider

    prompt_instruction = (
        _FOLLOW_UP_PROMPTS.get(sequence_type, {}).get(step)
        or "Write a brief, professional follow-up. Two to three sentences only."
    )

    business_name = business_context.get("business_name") or "Olivander"
    business_type = business_context.get("business_type") or "service business"
    tone = (
        business_context.get("reply_tone")
        or business_context.get("tone")
        or "warm, professional, brief"
    )

    prompt = f"""You are drafting a follow-up email on behalf of {business_name}, a {business_type} in New Zealand.

Tone: {tone}. Human, warm, and direct. Use New Zealand English.
Never start with "I hope this email finds you well" or similar filler.
Sign off as: {business_name}

Original email context:
From: {sender_name} <{sender_email}>
Subject: {subject}
Body: {original_body[:500]}

Follow-up instruction:
{prompt_instruction}

Write the follow-up email body only. No subject line. No headers.""".strip()

    ai = get_ai_provider()
    return ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=300,
        operation="follow_up_draft",
        business_id=business_id,
    )


def handle_follow_up_email(job: dict[str, Any]) -> None:
    from db.supabase import (
        create_approval,
        get_business_by_id,
        get_memory_profile,
        log_activity,
    )

    payload = job.get("payload") or {}
    business_id = str(payload.get("business_id") or "")
    sequence_type = str(payload.get("sequence_type") or "new_lead")
    step = int(payload.get("step") or 1)
    sender_name = str(payload.get("sender_name") or "")
    sender_email = str(payload.get("sender_email") or "")
    subject = str(payload.get("subject") or "")
    original_body = str(payload.get("original_body") or "")
    original_email_id = payload.get("original_email_id")

    if not business_id:
        logger.warning("follow_up_email job %s missing business_id — skipping", job.get("id"))
        return

    business_info = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)
    business_context = {
        "business_name": memory.get("business_name") or business_info.get("business_name") or "",
        "business_type": memory.get("business_type") or "",
        "reply_tone": memory.get("reply_tone") or "",
        "tone": memory.get("tone") or "",
    }

    draft_body = _draft_follow_up(
        sequence_type=sequence_type,
        step=step,
        sender_name=sender_name,
        sender_email=sender_email,
        subject=subject,
        original_body=original_body,
        business_context=business_context,
        business_id=business_id,
    )

    re_subject = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    approval = create_approval(
        business_id=business_id,
        approval_type="email_reply",
        who=f"{sender_name} <{sender_email}>" if sender_name else sender_email,
        what=re_subject,
        why=f"Scheduled follow-up ({sequence_type}, step {step})",
        original_email_id=original_email_id,
        draft_content=draft_body,
    )

    if approval:
        log_activity(
            business_id,
            f"Follow-up draft created for {sender_email} ({sequence_type} step {step})",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "sequence_type": sequence_type,
                "step": step,
            },
        )

    logger.info(
        "follow_up_email job complete: business=%s sequence=%s step=%d",
        business_id,
        sequence_type,
        step,
    )


# ---------------------------------------------------------------------------
# renew_gmail_watch
# ---------------------------------------------------------------------------
# Payload: {"business_id": str}

def handle_renew_gmail_watch(job: dict[str, Any]) -> None:
    from auth.tokens import get_valid_token
    from db.supabase import log_activity
    from gmail.client import setup_gmail_watch

    payload = job.get("payload") or {}
    business_id = str(payload.get("business_id") or "")

    if not business_id:
        logger.warning("renew_gmail_watch job %s missing business_id — skipping", job.get("id"))
        return

    pubsub_topic = os.getenv("PUBSUB_TOPIC")
    if not pubsub_topic:
        logger.warning("renew_gmail_watch: PUBSUB_TOPIC not set — skipping renewal")
        return

    access_token = get_valid_token(business_id)
    result = setup_gmail_watch(access_token, pubsub_topic)
    expiry = result.get("expiration")
    logger.info("Gmail watch renewed for business %s (expiry=%s)", business_id, expiry)

    log_activity(
        business_id,
        "Gmail push notification watch renewed",
        activity_type="gmail_watch_renewed",
        metadata={"expiration": expiry},
    )

    # Enqueue the next renewal 6 days from now
    from db.supabase import enqueue_job as db_enqueue_job
    next_run = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
    db_enqueue_job(
        job_type="renew_gmail_watch",
        payload={"business_id": business_id},
        run_at=next_run,
        business_id=business_id,
        max_attempts=3,
    )


# ---------------------------------------------------------------------------
# chase_invoice
# ---------------------------------------------------------------------------
# Payload: {
#   "business_id": str,
#   "xero_invoice_id": str,
#   "contact_name": str,
#   "contact_email": str,
#   "amount_formatted": str,   # e.g. "$1,200.00"
#   "due_date": str,           # ISO date
#   "step": int,               # 1=Day7, 2=Day14, 3=Day21
# }

_CHASER_DELAYS_DAYS = {1: 7, 2: 14, 3: 21}

_CHASER_TONE: dict[int, str] = {
    1: (
        "Write a polite first payment reminder. The invoice is now 7 days past due. "
        "Mention the amount and due date. Ask them to arrange payment at their earliest convenience. "
        "Two to three sentences. Friendly but clear."
    ),
    2: (
        "Write a firm second payment reminder. The invoice is now 14 days overdue. "
        "Include the amount outstanding and the original due date. "
        "Ask them to contact us immediately if there is an issue. "
        "Three sentences maximum."
    ),
    3: (
        "Write a final payment reminder before escalation. The invoice is 21 days overdue. "
        "State the amount clearly. Let them know this is the final reminder before the account "
        "is escalated. Keep it professional and brief. Two to three sentences."
    ),
}


def handle_chase_invoice(job: dict[str, Any]) -> None:
    from auth.xero import get_valid_xero_token
    from core.ai import get_ai_provider
    from db.supabase import (
        create_approval,
        get_business_by_id,
        get_memory_profile,
        invoice_source_id,
        log_activity,
        pending_invoice_reminder_approval_exists,
    )
    from xero.client import get_invoice

    payload = job.get("payload") or {}
    business_id = str(payload.get("business_id") or "")
    xero_invoice_id = str(payload.get("xero_invoice_id") or "")
    contact_name = str(payload.get("contact_name") or "Customer")
    contact_email = str(payload.get("contact_email") or "")
    amount_formatted = str(payload.get("amount_formatted") or "")
    due_date = str(payload.get("due_date") or "")
    step = int(payload.get("step") or 1)

    if not business_id or not xero_invoice_id:
        logger.warning("chase_invoice job %s missing required fields — skipping", job.get("id"))
        return

    # Query Xero live — never use cached state (PRD Section 19.7)
    try:
        xero_token, tenant_id = get_valid_xero_token(business_id)
        invoice = get_invoice(xero_token, tenant_id, xero_invoice_id)
    except Exception as error:
        logger.error("chase_invoice: could not fetch Xero invoice %s: %s", xero_invoice_id, error)
        raise

    xero_status = (invoice.get("Status") or "").upper()
    if xero_status in ("PAID", "VOIDED", "DELETED"):
        logger.info(
            "chase_invoice: invoice %s is %s — no chaser needed", xero_invoice_id, xero_status
        )
        return

    if pending_invoice_reminder_approval_exists(business_id, xero_invoice_id):
        logger.info(
            "chase_invoice: invoice %s already has a pending reminder approval — skipping",
            xero_invoice_id,
        )
        return

    # Draft the chaser
    business_info = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)
    business_name = memory.get("business_name") or business_info.get("business_name") or "Olivander"
    business_type = memory.get("business_type") or "service business"
    tone = memory.get("reply_tone") or "warm, professional, direct"

    instruction = _CHASER_TONE.get(step, _CHASER_TONE[1])

    prompt = f"""You are drafting an invoice chaser on behalf of {business_name}, a {business_type} in New Zealand.

Tone: {tone}. Use New Zealand English.
Sign off as: {business_name}

Invoice details:
- Contact: {contact_name}
- Amount outstanding: {amount_formatted}
- Original due date: {due_date}
- Chaser step: {step} of 3

{instruction}

Write the email body only. No subject line. No headers.""".strip()

    ai = get_ai_provider()
    draft_body = ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=300,
        operation="chase_invoice_draft",
        business_id=business_id,
    )

    approval = create_approval(
        business_id=business_id,
        approval_type="email_reply",
        who=f"{contact_name} <{contact_email}>" if contact_email else contact_name,
        what=f"Invoice chaser — {contact_name} ({amount_formatted})",
        why=f"Invoice {xero_invoice_id} is overdue (step {step} of 3). Xero status: {xero_status}.",
        original_email_id=invoice_source_id(xero_invoice_id),
        draft_content=draft_body,
    )

    if approval:
        log_activity(
            business_id,
            f"Invoice chaser approval queued for {contact_name} (step {step})",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "xero_invoice_id": xero_invoice_id,
                "step": step,
            },
        )

    # Enqueue next chaser step if there is one
    next_step = step + 1
    if next_step in _CHASER_DELAYS_DAYS:
        from db.supabase import enqueue_job as db_enqueue_job
        days = _CHASER_DELAYS_DAYS[next_step] - _CHASER_DELAYS_DAYS[step]
        next_run = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        db_enqueue_job(
            job_type="chase_invoice",
            payload={**payload, "step": next_step},
            run_at=next_run,
            business_id=business_id,
            max_attempts=3,
        )

    logger.info(
        "chase_invoice job complete: business=%s invoice=%s step=%d",
        business_id,
        xero_invoice_id,
        step,
    )


# ---------------------------------------------------------------------------
# calendar_reminder
# ---------------------------------------------------------------------------
# Payload: {
#   "business_id": str,
#   "event_summary": str,
#   "attendee_name": str,
#   "attendee_email": str,
#   "event_start": str,        # human-readable, e.g. "Tuesday 22 April at 2:00 PM"
#   "reminder_type": "24h" | "2h",
# }

def handle_calendar_reminder(job: dict[str, Any]) -> None:
    from core.ai import get_ai_provider
    from db.supabase import create_approval, get_business_by_id, get_memory_profile, log_activity

    payload = job.get("payload") or {}
    business_id = str(payload.get("business_id") or "")
    event_summary = str(payload.get("event_summary") or "your appointment")
    attendee_name = str(payload.get("attendee_name") or "")
    attendee_email = str(payload.get("attendee_email") or "")
    event_start = str(payload.get("event_start") or "")
    reminder_type = str(payload.get("reminder_type") or "24h")

    if not business_id or not attendee_email:
        logger.warning("calendar_reminder job %s missing required fields — skipping", job.get("id"))
        return

    business_info = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)
    business_name = memory.get("business_name") or business_info.get("business_name") or "Olivander"
    business_type = memory.get("business_type") or "service business"
    tone = memory.get("reply_tone") or "warm, professional, brief"

    if reminder_type == "2h":
        instruction = (
            "Write a brief 2-hour reminder for an appointment happening today. "
            "Confirm the time and that you're looking forward to it. One sentence."
        )
    else:
        instruction = (
            "Write a brief 24-hour reminder for an appointment tomorrow. "
            "Confirm the details and let them know you'll be ready. Two sentences."
        )

    prompt = f"""You are sending an appointment reminder on behalf of {business_name}, a {business_type} in New Zealand.

Tone: {tone}. Use New Zealand English.
Sign off as: {business_name}

Appointment:
- Description: {event_summary}
- Time: {event_start}
- Client: {attendee_name or attendee_email}

{instruction}

Write the email body only. No subject line. No headers.""".strip()

    ai = get_ai_provider()
    draft_body = ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=200,
        operation="calendar_reminder_draft",
        business_id=business_id,
    )

    reminder_label = "24-hour" if reminder_type == "24h" else "2-hour"
    approval = create_approval(
        business_id=business_id,
        approval_type="email_reply",
        who=f"{attendee_name} <{attendee_email}>" if attendee_name else attendee_email,
        what=f"{reminder_label} reminder: {event_summary}",
        why=f"Scheduled {reminder_label} reminder before {event_start}.",
        draft_content=draft_body,
    )

    if approval:
        log_activity(
            business_id,
            f"{reminder_label} reminder queued for {attendee_email}",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "event_summary": event_summary,
                "reminder_type": reminder_type,
            },
        )

    logger.info(
        "calendar_reminder job complete: business=%s event=%s type=%s",
        business_id,
        event_summary,
        reminder_type,
    )


# ---------------------------------------------------------------------------
# missed_response_check
# ---------------------------------------------------------------------------
# Payload: {
#   "business_id": str,
#   "original_email_id": str,
#   "thread_id": str,
#   "sender_name": str,
#   "sender_email": str,
#   "subject": str,
#   "original_body": str,
#   "classification": str,
# }

def handle_missed_response_check(job: dict[str, Any]) -> None:
    from db.supabase import (
        create_approval,
        get_approval_for_original_email,
        log_activity,
        missed_response_source_id,
        pending_missed_response_approval_exists,
    )

    payload = job.get("payload") or {}
    business_id = str(payload.get("business_id") or "")
    original_email_id = str(payload.get("original_email_id") or "")
    sender_name = str(payload.get("sender_name") or "")
    sender_email = str(payload.get("sender_email") or "")
    subject = str(payload.get("subject") or "Customer email")
    original_body = str(payload.get("original_body") or "")
    classification = str(payload.get("classification") or "email")

    if not business_id or not original_email_id:
        logger.warning("missed_response_check job %s missing required fields — skipping", job.get("id"))
        return

    original_approval = get_approval_for_original_email(business_id, original_email_id)
    original_status = str((original_approval or {}).get("status") or "").lower()
    if original_status in {"approved", "rejected", "failed"}:
        logger.info(
            "missed_response_check: original email %s already handled with status=%s",
            original_email_id,
            original_status,
        )
        return

    if pending_missed_response_approval_exists(business_id, original_email_id):
        logger.info(
            "missed_response_check: missed-response approval already pending for %s",
            original_email_id,
        )
        return

    who = f"{sender_name} <{sender_email}>" if sender_name and sender_email else sender_email or sender_name
    source_id = missed_response_source_id(original_email_id)
    detail = (
        "This inbound email has not had an approved reply after four hours. "
        "Review the original pending draft, write a reply, or mark this handled if it was dealt with outside Olivander."
    )
    if original_body:
        detail = f"{detail}\n\nOriginal message:\n{original_body[:500]}"

    approval = create_approval(
        business_id=business_id,
        approval_type="missed_response",
        who=who,
        what=f"Missed response - {subject}",
        why=f"No approved reply recorded for this {classification} thread after four hours.",
        original_email_id=source_id,
        draft_content=detail,
    )

    if approval:
        log_activity(
            business_id,
            f"Missed response flagged: {subject}",
            activity_type="missed_response_flagged",
            metadata={
                "approval_id": approval.get("id"),
                "original_email_id": original_email_id,
                "classification": classification,
            },
        )

    logger.info(
        "missed_response_check complete: business=%s original_email=%s",
        business_id,
        original_email_id,
    )


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

HANDLERS: dict[str, Any] = {
    "follow_up_email": handle_follow_up_email,
    "renew_gmail_watch": handle_renew_gmail_watch,
    "chase_invoice": handle_chase_invoice,
    "calendar_reminder": handle_calendar_reminder,
    "missed_response_check": handle_missed_response_check,
}
