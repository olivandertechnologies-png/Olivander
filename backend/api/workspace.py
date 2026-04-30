"""First-customer workspace endpoints.

Persists the manual/demo-ready records used by the first tradie build:
jobs, inbox cards, and admin action cards.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agent.classify import SKIP_LABELS, classify_email
from agent.draft import draft_reply
from agent.rag import retrieve_context_chunks
from auth.deps import get_current_business
from auth.tokens import get_valid_token
from db.supabase import (
    create_workspace_action,
    create_workspace_job,
    create_workspace_message,
    get_business_by_id,
    get_memory_profile,
    get_workspace_actions,
    get_workspace_job,
    get_workspace_jobs,
    get_workspace_message_by_source_email,
    get_workspace_messages,
    log_activity,
    update_workspace_action,
    update_workspace_job,
    update_workspace_message,
)
from gmail.client import get_thread, list_recent_messages
from jobs.handlers import _draft_follow_up
from rate_limit import limiter

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

_CLASSIFICATION_LABELS = {
    "new_lead": "New lead",
    "existing_client": "Needs reply",
    "booking_request": "Booking request",
    "complaint": "Needs reply",
    "invoice": "Payment question",
    "payment_confirmation": "Payment question",
}

_JOB_TYPE_LABELS = {
    "new_lead": "New customer enquiry",
    "existing_client": "Customer admin",
    "booking_request": "Booking admin",
    "complaint": "Customer issue",
    "invoice": "Payment admin",
    "payment_confirmation": "Payment admin",
}


def _clean_dict(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def _business_context(business_id: str) -> dict[str, Any]:
    business = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)
    return {
        "business_name": memory.get("business_name") or business.get("business_name") or "",
        "owner_email": memory.get("owner_email") or business.get("email") or "",
        "business_type": memory.get("business_type") or "",
        "pricing_range": memory.get("pricing_range") or "",
        "payment_terms": memory.get("payment_terms") or "",
        "reply_tone": memory.get("reply_tone") or "",
        "tone": memory.get("reply_tone") or memory.get("tone") or "",
        "services": memory.get("services") or "",
        "location": memory.get("location") or "",
    }


def _thread_context(thread_messages: list[dict[str, Any]]) -> str:
    return "\n---\n".join(
        f"From: {message.get('from') or ''}\n"
        f"Subject: {message.get('subject') or ''}\n"
        f"Date: {message.get('date') or ''}\n\n"
        f"{message.get('body') or message.get('snippet') or ''}"
        for message in reversed(thread_messages)
    )


def _message_interpretation(classification: str) -> str:
    label = _CLASSIFICATION_LABELS.get(classification, "Needs reply")
    if classification in {"invoice", "payment_confirmation"}:
        return f"{label}. Verify payment or invoice details before any customer-facing reply."
    if classification == "booking_request":
        return "Booking request. Confirm timing before making any customer-facing commitment."
    if classification == "new_lead":
        return "New lead. Reply quickly and capture the missing job details."
    if classification == "complaint":
        return "Customer issue. Keep the reply careful and approval-first."
    return "Customer message needs a reply."


def _action_priority(classification: str) -> str:
    if classification in {"new_lead", "complaint", "invoice"}:
        return "high"
    return "medium"


def _follow_up_sequence_for_job(job: dict[str, Any]) -> tuple[str, int, str]:
    status = str(job.get("status") or "")
    days_since_quote = int(job.get("quote_sent_days_ago") or 0)
    if status == "quote_sent":
        step = 2 if days_since_quote >= 7 else 1
        return "quote_sent", step, (
            f"Quote sent {days_since_quote or 'several'} days ago and no customer response is recorded."
        )
    if status == "completed":
        return "post_job", 1, "Job is complete. Follow up while the work is still fresh."
    return "new_lead", 1, "Job has a visible next action and needs a customer follow-up."


def _normalise_job(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id")),
        "customer": row.get("customer") or "",
        "email": row.get("email") or "",
        "phone": row.get("phone") or "",
        "address": row.get("address") or "",
        "jobType": row.get("job_type") or "Manual job",
        "status": row.get("status") or "new_lead",
        "value": float(row.get("value") or 0),
        "scheduledFor": row.get("scheduled_for") or "",
        "nextAction": row.get("next_action") or "",
        "quoteSentDaysAgo": row.get("quote_sent_days_ago"),
        "invoice": row.get("invoice") or None,
        "notes": row.get("notes") or [],
        "timeline": row.get("timeline") or [],
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _normalise_message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row.get("id")),
        "customer": row.get("customer") or "",
        "email": row.get("email") or "",
        "phone": row.get("phone") or "",
        "subject": row.get("subject") or "Untitled message",
        "source": row.get("source") or "manual",
        "sourceEmailId": row.get("source_email_id"),
        "sourceThreadId": row.get("source_thread_id"),
        "category": row.get("category") or "Needs reply",
        "receivedAt": row.get("received_at") or "",
        "jobType": row.get("job_type") or "",
        "address": row.get("address") or "",
        "body": row.get("body") or "",
        "interpretation": row.get("interpretation") or "",
        "draft": row.get("draft") or "",
        "status": row.get("status") or "active",
        "plusOnlyReason": row.get("plus_only_reason") or "",
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _normalise_action(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("value")
    return {
        "id": str(row.get("id")),
        "type": row.get("type") or "reply",
        "title": row.get("title") or "",
        "customer": row.get("customer") or "",
        "email": row.get("email") or "",
        "sourceMessageId": row.get("source_message_id"),
        "jobId": row.get("job_id"),
        "priority": row.get("priority") or "medium",
        "reason": row.get("reason") or "",
        "detail": row.get("detail") or "",
        "draft": row.get("draft") or "",
        "status": row.get("status") or "open",
        "plusOnly": bool(row.get("plus_only", False)),
        "lockedReason": row.get("locked_reason") or "",
        "value": float(value) if value is not None else None,
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


class JobPayload(BaseModel):
    customer: str
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    jobType: str = "Manual job"
    status: str = "new_lead"
    value: float = 0
    scheduledFor: str | None = None
    nextAction: str | None = None
    quoteSentDaysAgo: int | None = None
    invoice: dict[str, Any] | None = None
    notes: list[str] = Field(default_factory=list)
    timeline: list[str] = Field(default_factory=list)


class JobPatch(BaseModel):
    customer: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    jobType: str | None = None
    status: str | None = None
    value: float | None = None
    scheduledFor: str | None = None
    nextAction: str | None = None
    quoteSentDaysAgo: int | None = None
    invoice: dict[str, Any] | None = None
    notes: list[str] | None = None
    timeline: list[str] | None = None


class MessagePayload(BaseModel):
    customer: str
    email: str | None = None
    phone: str | None = None
    subject: str
    source: str = "manual"
    sourceEmailId: str | None = None
    sourceThreadId: str | None = None
    category: str = "Needs reply"
    receivedAt: str | None = None
    jobType: str | None = None
    address: str | None = None
    body: str
    interpretation: str | None = None
    draft: str | None = None
    plusOnlyReason: str | None = None


class MessagePatch(BaseModel):
    status: str | None = None
    draft: str | None = None
    interpretation: str | None = None


class ActionPayload(BaseModel):
    type: str = "reply"
    title: str
    customer: str | None = None
    email: str | None = None
    sourceMessageId: str | None = None
    jobId: str | None = None
    priority: str = "medium"
    reason: str | None = None
    detail: str | None = None
    draft: str | None = None
    status: str = "open"
    plusOnly: bool = False
    lockedReason: str | None = None
    value: float | None = None


class ActionPatch(BaseModel):
    status: str | None = None
    reason: str | None = None
    detail: str | None = None
    draft: str | None = None


class InboxImportPayload(BaseModel):
    maxResults: int = Field(default=10, ge=1, le=25)


def _job_payload(payload: JobPayload | JobPatch) -> dict[str, Any]:
    return _clean_dict({
        "customer": payload.customer,
        "email": payload.email,
        "phone": payload.phone,
        "address": payload.address,
        "job_type": payload.jobType,
        "status": payload.status,
        "value": payload.value,
        "scheduled_for": payload.scheduledFor,
        "next_action": payload.nextAction,
        "quote_sent_days_ago": payload.quoteSentDaysAgo,
        "invoice": payload.invoice,
        "notes": payload.notes,
        "timeline": payload.timeline,
    })


def _message_payload(payload: MessagePayload) -> dict[str, Any]:
    return _clean_dict({
        "customer": payload.customer,
        "email": payload.email,
        "phone": payload.phone,
        "subject": payload.subject,
        "source": payload.source,
        "source_email_id": payload.sourceEmailId,
        "source_thread_id": payload.sourceThreadId,
        "category": payload.category,
        "received_at": payload.receivedAt,
        "job_type": payload.jobType,
        "address": payload.address,
        "body": payload.body,
        "interpretation": payload.interpretation,
        "draft": payload.draft,
        "plus_only_reason": payload.plusOnlyReason,
    })


def _action_payload(payload: ActionPayload) -> dict[str, Any]:
    return _clean_dict({
        "type": payload.type,
        "title": payload.title,
        "customer": payload.customer,
        "email": payload.email,
        "source_message_id": payload.sourceMessageId,
        "job_id": payload.jobId,
        "priority": payload.priority,
        "reason": payload.reason,
        "detail": payload.detail,
        "draft": payload.draft,
        "status": payload.status,
        "plus_only": payload.plusOnly,
        "locked_reason": payload.lockedReason,
        "value": payload.value,
    })


@router.get("/state")
@limiter.limit("60/minute")
async def get_workspace_state(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    return {
        "jobs": [_normalise_job(row) for row in get_workspace_jobs(business_id)],
        "messages": [_normalise_message(row) for row in get_workspace_messages(business_id)],
        "actions": [_normalise_action(row) for row in get_workspace_actions(business_id)],
    }


@router.post("/inbox/import")
@limiter.limit("10/minute")
async def import_gmail_inbox(
    request: Request,
    payload: InboxImportPayload,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Import recent unread Gmail into first-customer inbox/action cards.

    This drafts only reviewable workspace actions. It does not send email.
    """
    import asyncio

    def _run_import() -> dict[str, Any]:
        access_token = get_valid_token(business_id)
        context = _business_context(business_id)
        messages = list_recent_messages(
            access_token,
            max_results=payload.maxResults,
            label_ids=["INBOX", "UNREAD"],
        )
        imported_messages: list[dict[str, Any]] = []
        imported_actions: list[dict[str, Any]] = []
        skipped = {"duplicate": 0, "non_actionable": 0, "failed": 0}

        for message in messages:
            source_email_id = str(message.get("id") or "").strip()
            if not source_email_id:
                skipped["failed"] += 1
                continue

            if get_workspace_message_by_source_email(business_id, source_email_id):
                skipped["duplicate"] += 1
                continue

            sender_name = message.get("from_name") or message.get("from") or "Unknown sender"
            sender_email = message.get("from") or "unknown@example.com"
            subject = message.get("subject") or "Untitled email"
            body = message.get("full_body") or message.get("snippet") or ""
            thread_id = message.get("thread_id")

            try:
                classification = classify_email(
                    subject=subject,
                    body=body,
                    sender=sender_email,
                    business_id=business_id,
                )
                if classification in SKIP_LABELS:
                    skipped["non_actionable"] += 1
                    continue

                if thread_id:
                    thread_messages = get_thread(access_token, thread_id)
                    thread_context = _thread_context(thread_messages)
                else:
                    thread_context = (
                        f"From: {sender_email}\n"
                        f"Subject: {subject}\n"
                        f"Date: {message.get('date') or ''}\n\n"
                        f"{body}"
                    )

                retrieved_context = retrieve_context_chunks(business_id, classification)
                draft = draft_reply(
                    subject=subject,
                    body=body,
                    sender=sender_email,
                    classification=classification,
                    business_context=context,
                    thread_context=thread_context,
                    business_id=business_id,
                    retrieved_context=retrieved_context,
                )

                category = _CLASSIFICATION_LABELS.get(classification, "Needs reply")
                finance_action = classification in {"invoice", "payment_confirmation"}
                message_row = create_workspace_message(
                    business_id,
                    {
                        "customer": sender_name,
                        "email": sender_email,
                        "subject": subject,
                        "source": "gmail",
                        "source_email_id": source_email_id,
                        "source_thread_id": thread_id,
                        "category": category,
                        "received_at": message.get("date") or "Gmail",
                        "job_type": _JOB_TYPE_LABELS.get(classification, "Customer admin"),
                        "body": body,
                        "interpretation": _message_interpretation(classification),
                        "draft": draft,
                        "plus_only_reason": "Invoice and payment workflows are included in Admin Plus." if finance_action else None,
                    },
                )
                if not message_row:
                    skipped["failed"] += 1
                    continue

                action_row = create_workspace_action(
                    business_id,
                    {
                        "type": "reply",
                        "title": f"Reply to {sender_name}: {subject}",
                        "customer": sender_name,
                        "email": sender_email,
                        "source_message_id": str(message_row.get("id")),
                        "priority": _action_priority(classification),
                        "reason": _message_interpretation(classification),
                        "detail": body,
                        "draft": draft,
                        "status": "open",
                        "plus_only": finance_action,
                        "locked_reason": "Invoice and payment replies are included in Admin Plus." if finance_action else None,
                    },
                )

                imported_messages.append(_normalise_message(message_row))
                if action_row:
                    imported_actions.append(_normalise_action(action_row))
            except Exception:
                skipped["failed"] += 1

        if imported_messages:
            log_activity(
                business_id,
                f"Imported {len(imported_messages)} Gmail inbox card(s)",
                activity_type="workspace_gmail_imported",
                metadata={"skipped": skipped},
            )

        return {
            "imported": len(imported_messages),
            "actionsCreated": len(imported_actions),
            "skipped": skipped,
            "messages": imported_messages,
            "actions": imported_actions,
        }

    return await asyncio.get_running_loop().run_in_executor(None, _run_import)


@router.post("/jobs")
@limiter.limit("30/minute")
async def create_job(
    request: Request,
    payload: JobPayload,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    row = create_workspace_job(business_id, _job_payload(payload))
    if not row:
        raise HTTPException(status_code=500, detail="Could not create job.")
    log_activity(business_id, f"Job created: {payload.customer}", activity_type="workspace_job_created")
    return _normalise_job(row)


@router.post("/jobs/{job_id}/follow-up")
@limiter.limit("20/minute")
async def create_job_follow_up(
    request: Request,
    job_id: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    job = get_workspace_job(business_id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    sequence_type, step, reason = _follow_up_sequence_for_job(job)
    customer = str(job.get("customer") or "Customer")
    customer_email = str(job.get("email") or "")
    subject = str(job.get("job_type") or "Job follow-up")
    original_body = "\n".join([
        str(job.get("next_action") or ""),
        *(str(note) for note in (job.get("notes") or [])[:3]),
    ]).strip()

    draft = _draft_follow_up(
        sequence_type=sequence_type,
        step=step,
        sender_name=customer,
        sender_email=customer_email,
        subject=subject,
        original_body=original_body,
        business_context=_business_context(business_id),
        business_id=business_id,
    )

    row = create_workspace_action(
        business_id,
        {
            "type": "follow_up",
            "title": f"Follow up {customer}",
            "customer": customer,
            "email": customer_email,
            "job_id": job_id,
            "priority": "medium" if sequence_type == "quote_sent" else "low",
            "reason": reason,
            "detail": subject,
            "draft": draft,
            "status": "open",
        },
    )
    if not row:
        raise HTTPException(status_code=500, detail="Could not create follow-up action.")

    log_activity(
        business_id,
        f"Follow-up drafted for {customer}",
        activity_type="workspace_follow_up_created",
        metadata={"job_id": job_id, "sequence_type": sequence_type, "step": step},
    )
    return _normalise_action(row)


@router.patch("/jobs/{job_id}")
@limiter.limit("60/minute")
async def patch_job(
    request: Request,
    job_id: str,
    payload: JobPatch,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    updates = _job_payload(payload)
    if not updates:
        raise HTTPException(status_code=400, detail="No job updates supplied.")
    row = update_workspace_job(business_id, job_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _normalise_job(row)


@router.post("/messages")
@limiter.limit("30/minute")
async def create_message(
    request: Request,
    payload: MessagePayload,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    row = create_workspace_message(business_id, _message_payload(payload))
    if not row:
        raise HTTPException(status_code=500, detail="Could not create inbox card.")
    log_activity(business_id, f"Inbox card added: {payload.subject}", activity_type="workspace_message_created")
    return _normalise_message(row)


@router.patch("/messages/{message_id}")
@limiter.limit("60/minute")
async def patch_message(
    request: Request,
    message_id: str,
    payload: MessagePatch,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    updates = _clean_dict(payload.model_dump())
    if not updates:
        raise HTTPException(status_code=400, detail="No message updates supplied.")
    row = update_workspace_message(business_id, message_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Inbox card not found.")
    return _normalise_message(row)


@router.post("/actions")
@limiter.limit("30/minute")
async def create_action(
    request: Request,
    payload: ActionPayload,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    row = create_workspace_action(business_id, _action_payload(payload))
    if not row:
        raise HTTPException(status_code=500, detail="Could not create action card.")
    log_activity(business_id, f"Action card added: {payload.title}", activity_type="workspace_action_created")
    return _normalise_action(row)


@router.patch("/actions/{action_id}")
@limiter.limit("60/minute")
async def patch_action(
    request: Request,
    action_id: str,
    payload: ActionPatch,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    updates = _clean_dict(payload.model_dump())
    if not updates:
        raise HTTPException(status_code=400, detail="No action updates supplied.")
    row = update_workspace_action(business_id, action_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Action card not found.")
    return _normalise_action(row)
