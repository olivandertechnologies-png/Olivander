import asyncio
import datetime
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from agent.learning import maybe_learn_from_edit
from auth.deps import get_current_business
from auth.tokens import get_valid_token
from db.supabase import (
    claim_approval,
    get_approval_by_id,
    log_activity,
    update_approval_status,
)
from gmail.client import get_message, send_message
from jobs.queue import enqueue_job
from rate_limit import limiter

router = APIRouter(prefix="/api/actions", tags=["actions"])
logger = logging.getLogger("olivander")


class ApprovalActionRequest(BaseModel):
    action: str  # "approve", "reject", "edit"
    edited_content: str | None = None
    rejection_reason: str | None = None


def _safe_log_activity(
    business_id: str,
    description: str,
    *,
    activity_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    try:
        log_activity(
            business_id,
            description,
            activity_type=activity_type,
            metadata=metadata,
        )
    except Exception as error:
        logger.warning("Could not log activity for approval flow: %s", error, exc_info=True)


def _error_detail(error: Exception) -> str:
    if isinstance(error, HTTPException):
        if isinstance(error.detail, str):
            return error.detail
        return json.dumps(error.detail)
    return str(error) or error.__class__.__name__


def _mark_approval_failed(approval_id: str, business_id: str, error: Exception) -> None:
    failure_detail = _error_detail(error)
    failure_ts = datetime.datetime.now(datetime.timezone.utc).isoformat()

    try:
        update_approval_status(approval_id, "failed", when_ts=failure_ts)
    except Exception as update_error:
        logger.error(
            "Failed to mark approval %s as failed after execution error: %s",
            approval_id,
            update_error,
            exc_info=True,
        )

    _safe_log_activity(
        business_id,
        "Approval claimed but execution failed",
        activity_type="approval_send_failed",
        metadata={
            "approval_id": approval_id,
            "error": failure_detail,
        },
    )


@router.post("/{approval_id}/approve")
@limiter.limit("60/minute")
async def approve_action(
    request: Request,
    approval_id: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Approve an action.

    Handles three approval types:
    - xero_invoice → create invoice in Xero (no Google token needed)
    - calendar_event → create event via Calendar API (draft_content is JSON)
    - email_reply / booking_reply → send email via Gmail API
    """
    claimed = False

    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        # Atomic claim — prevents double-approval races
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        claimed = claim_approval(approval_id, "approved", now)
        if not claimed:
            latest = get_approval_by_id(approval_id) or approval
            return {
                "status": "already_handled",
                "current_status": latest.get("status"),
            }

        approval_type = approval.get("type") or "email_reply"

        # ── Xero invoice — does not need Google token ───────────────────────
        if approval_type == "xero_invoice":
            from auth.xero import get_valid_xero_token
            from xero.client import create_invoice, find_or_create_contact

            invoice_payload = approval.get("edited_content") or approval.get("draft_content") or "{}"
            try:
                invoice_data = json.loads(invoice_payload)
            except (TypeError, json.JSONDecodeError) as error:
                raise HTTPException(
                    status_code=400,
                    detail="Invoice approval contains invalid JSON.",
                ) from error

            xero_token, tenant_id = get_valid_xero_token(business_id)
            contact_id = find_or_create_contact(
                xero_token,
                tenant_id,
                name=str(invoice_data.get("contact_name") or "Unknown"),
                email=invoice_data.get("contact_email"),
            )
            invoice = create_invoice(
                xero_token,
                tenant_id,
                contact_id=contact_id,
                line_items=invoice_data.get("line_items") or [],
                due_date_days=int(invoice_data.get("due_date_days") or 30),
                gst_registered=bool(invoice_data.get("gst_registered", True)),
            )
            invoice_id = invoice.get("InvoiceID") or invoice.get("invoiceID")
            _safe_log_activity(
                business_id,
                f"Xero invoice created for {invoice_data.get('contact_name')}",
                activity_type="approval_executed",
                metadata={
                    "approval_id": approval_id,
                    "xero_invoice_id": invoice_id,
                    "contact_name": invoice_data.get("contact_name"),
                },
            )

            # Enqueue Day-7 invoice chaser (subsequent steps self-chain)
            if invoice_id:
                try:
                    due_date_days = int(invoice_data.get("due_date_days") or 30)
                    line_items = invoice_data.get("line_items") or []
                    total_excl = sum(
                        float(i.get("unit_amount_excl_gst", 0)) * float(i.get("quantity", 1))
                        for i in line_items
                    )
                    gst_registered = bool(invoice_data.get("gst_registered", True))
                    if gst_registered:
                        amount_formatted = f"NZD ${total_excl + total_excl * 0.15:.2f} incl. GST"
                    else:
                        amount_formatted = f"NZD ${total_excl:.2f}"
                    enqueue_job(
                        job_type="chase_invoice",
                        payload={
                            "business_id": business_id,
                            "xero_invoice_id": invoice_id,
                            "contact_name": str(invoice_data.get("contact_name") or ""),
                            "contact_email": str(invoice_data.get("contact_email") or ""),
                            "amount_formatted": amount_formatted,
                            "due_date": (
                                datetime.datetime.now(datetime.timezone.utc)
                                + datetime.timedelta(days=due_date_days)
                            ).strftime("%d %B %Y"),
                            "step": 1,
                        },
                        delay_seconds=(due_date_days + 7) * 86400,
                        business_id=business_id,
                    )
                except Exception as chaser_error:
                    logger.warning(
                        "Could not enqueue invoice chaser for %s: %s",
                        invoice_id,
                        chaser_error,
                    )

            return {
                "status": "approved",
                "approval_id": approval_id,
                "xero_invoice_id": invoice_id,
                "approved_at": now,
            }

        # ── Quote send — HTML email to client ──────────────────────────────
        if approval_type == "send_quote":
            access_token = get_valid_token(business_id)
            quote_payload = approval.get("edited_content") or approval.get("draft_content") or "{}"
            try:
                quote_data = json.loads(quote_payload)
            except (TypeError, json.JSONDecodeError) as error:
                raise HTTPException(
                    status_code=400,
                    detail="Quote approval contains invalid JSON.",
                ) from error

            contact_name = str(quote_data.get("contact_name") or "")
            contact_email = str(quote_data.get("contact_email") or "")
            title = str(quote_data.get("title") or "Quote")
            html_body = str(quote_data.get("html_body") or "")

            if not contact_email:
                raise HTTPException(
                    status_code=400,
                    detail=f"No email address for {contact_name}. Edit the approval to add one before sending.",
                )

            # Build plain-text fallback
            items = quote_data.get("line_items") or []
            lines = [f"  - {i.get('description','')} x{i.get('quantity',1)} @ ${i.get('unit_amount_excl_gst',0)}" for i in items]
            text_body = f"{title}\n\nPrepared for {contact_name}\n\n" + "\n".join(lines)

            from gmail.client import send_html_message
            from db.supabase import get_memory_profile
            from api.quotes import generate_quote_pdf
            memory = get_memory_profile(business_id)
            business_name = memory.get("business_name") or "Your Business"

            try:
                pdf_bytes = generate_quote_pdf(quote_data, business_name)
                safe_name = contact_name.replace("/", "-") if contact_name else "Quote"
                pdf_filename = f"{title} - {safe_name}.pdf"
            except Exception as pdf_error:
                logger.warning("PDF generation failed, sending without attachment: %s", pdf_error)
                pdf_bytes = None
                pdf_filename = "Quote.pdf"

            send_html_message(
                access_token,
                to_email=contact_email,
                subject=f"{title} from {business_name}",
                html_body=html_body,
                text_body=text_body,
                pdf_bytes=pdf_bytes,
                pdf_filename=pdf_filename,
            )

            _safe_log_activity(
                business_id,
                f"Quote sent to {contact_name} ({contact_email})",
                activity_type="approval_executed",
                metadata={
                    "approval_id": approval_id,
                    "contact_name": contact_name,
                    "contact_email": contact_email,
                    "type": "quote",
                },
            )

            # Enqueue +5 day and +10 day follow-ups
            try:
                follow_base = {
                    "business_id": business_id,
                    "contact_name": contact_name,
                    "contact_email": contact_email,
                    "quote_title": title,
                    "approval_id": approval_id,
                    "step": 1,
                }
                enqueue_job(
                    job_type="follow_up_email",
                    payload={**follow_base, "follow_up_reason": "quote_no_response"},
                    delay_seconds=5 * 86400,
                    business_id=business_id,
                )
            except Exception as fu_error:
                logger.warning("Could not enqueue quote follow-up: %s", fu_error)

            return {
                "status": "approved",
                "approval_id": approval_id,
                "sent_to": contact_email,
                "approved_at": now,
            }

        # ── All remaining types need a Google access token ──────────────────
        access_token = get_valid_token(business_id)

        # ── Calendar event ──────────────────────────────────────────────────
        if approval_type == "calendar_event":
            from gcal.client import DEFAULT_TZ, create_event
            from db.supabase import get_memory_profile

            event_payload = approval.get("edited_content") or approval.get("draft_content") or "{}"
            try:
                event_data = json.loads(event_payload)
            except (TypeError, json.JSONDecodeError) as error:
                raise HTTPException(
                    status_code=400,
                    detail="Calendar event approval contains invalid JSON.",
                ) from error

            if not isinstance(event_data, dict):
                raise HTTPException(
                    status_code=400,
                    detail="Calendar event approval must be a JSON object.",
                )

            start = str(event_data.get("start") or "").strip()
            end = str(event_data.get("end") or "").strip()
            if not start or not end:
                raise HTTPException(
                    status_code=400,
                    detail="Calendar event approval is missing a start or end time.",
                )

            tz_name = get_memory_profile(business_id).get("timezone") or DEFAULT_TZ
            event = create_event(
                access_token,
                summary=event_data.get("summary") or "Booking",
                start=start,
                end=end,
                description=event_data.get("description"),
                attendee_email=event_data.get("attendee_email"),
                tz_name=tz_name,
            )

            _safe_log_activity(
                business_id,
                f"Calendar event created: {event_data.get('summary')}",
                activity_type="approval_executed",
                metadata={
                    "approval_id": approval_id,
                    "event_id": event.get("id"),
                    "event_summary": event_data.get("summary"),
                },
            )

            # Enqueue 24h and 2h reminder drafts if we have an attendee email
            attendee_email = event_data.get("attendee_email") or ""
            attendee_name = event_data.get("attendee_name") or ""
            if attendee_email and start:
                try:
                    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
                    event_dt = _dt.fromisoformat(start.replace("Z", "+00:00"))
                    human_start = event_dt.strftime("%-d %B at %-I:%M %p")
                    reminder_base = {
                        "business_id": business_id,
                        "event_summary": event_data.get("summary") or "your appointment",
                        "attendee_name": attendee_name,
                        "attendee_email": attendee_email,
                        "event_start": human_start,
                    }
                    # 24h before
                    run_24h = (event_dt - _td(hours=24)).isoformat()
                    enqueue_job(
                        job_type="calendar_reminder",
                        payload={**reminder_base, "reminder_type": "24h"},
                        run_at=run_24h,
                        business_id=business_id,
                    )
                    # 2h before
                    run_2h = (event_dt - _td(hours=2)).isoformat()
                    enqueue_job(
                        job_type="calendar_reminder",
                        payload={**reminder_base, "reminder_type": "2h"},
                        run_at=run_2h,
                        business_id=business_id,
                    )
                except Exception as reminder_error:
                    logger.warning(
                        "Could not enqueue calendar reminders for event %s: %s",
                        event.get("id"),
                        reminder_error,
                    )

            return {
                "status": "approved",
                "approval_id": approval_id,
                "event_id": event.get("id"),
                "event_summary": event_data.get("summary"),
                "approved_at": now,
            }

        # ── Email (email_reply or booking_reply) ────────────────────────────
        original_message_id = approval.get("original_email_id")
        external_source = str(original_message_id or "").startswith("xero_invoice:")
        if original_message_id and not external_source:
            try:
                original = get_message(access_token, original_message_id)
                to_email = original.get("from", "unknown@example.com")
                subject = f"Re: {original.get('subject', 'No subject')}"
                thread_id = original.get("thread_id")
            except Exception as e:
                logger.error("Failed to get original message: %s", e)
                to_email = approval.get("who", "unknown@example.com")
                subject = approval.get("what") or "Re: Your inquiry"
                thread_id = None
        else:
            to_email = approval.get("who", "unknown@example.com")
            subject = approval.get("what") or "Re: Your inquiry"
            thread_id = None

        draft_body = approval.get("edited_content") or approval.get("draft_content") or ""

        send_message(
            access_token,
            to_email=to_email,
            subject=subject,
            body=draft_body,
            thread_id=thread_id,
        )

        _safe_log_activity(
            business_id,
            f"Approved and sent email to {to_email}",
            activity_type="approval_executed",
            metadata={
                "approval_id": approval_id,
                "to_email": to_email,
                "subject": subject,
            },
        )

        # Learn from edits — fire in background so it never delays the response
        original_draft = approval.get("draft_content") or ""
        edited_draft = approval.get("edited_content") or ""
        if original_draft and edited_draft and original_draft.strip() != edited_draft.strip():
            # Parse classification from the why field ("Classified as new_lead")
            why = approval.get("why") or ""
            classification = why.removeprefix("Classified as ").strip() or approval_type
            asyncio.get_running_loop().run_in_executor(
                None,
                maybe_learn_from_edit,
                business_id,
                original_draft,
                edited_draft,
                classification,
            )

        return {
            "status": "approved",
            "approval_id": approval_id,
            "sent_to": to_email,
            "sent_at": now,
        }

    except HTTPException as error:
        if claimed:
            _mark_approval_failed(approval_id, business_id, error)
        raise
    except Exception as error:
        if claimed:
            _mark_approval_failed(approval_id, business_id, error)
        logger.error("Failed to approve action %s: %s", approval_id, error, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to approve action",
        ) from error


@router.post("/{approval_id}/reject")
@limiter.limit("60/minute")
async def reject_action(
    request: Request,
    approval_id: str,
    payload: ApprovalActionRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Reject an action."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if approval.get("status") != "pending":
            return {
                "status": "already_handled",
                "current_status": approval.get("status"),
            }

        # Update approval status
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_approval_status(approval_id, "rejected", when_ts=now)

        # Log activity
        rejection_reason = payload.rejection_reason or "No reason provided"
        _safe_log_activity(
            business_id,
            f"Rejected action: {rejection_reason}",
            activity_type="approval_rejected",
            metadata={
                "approval_id": approval_id,
                "reason": rejection_reason,
            },
        )

        return {
            "status": "rejected",
            "approval_id": approval_id,
            "reason": rejection_reason,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to reject action {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to reject action",
        ) from error


@router.patch("/{approval_id}/edit")
@limiter.limit("60/minute")
async def edit_action(
    request: Request,
    approval_id: str,
    payload: ApprovalActionRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Edit an approval (update draft content)."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if approval.get("status") != "pending":
            return {
                "status": "already_handled",
                "current_status": approval.get("status"),
            }

        if not payload.edited_content:
            raise HTTPException(status_code=400, detail="edited_content is required")

        # Update approval with edited content
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_approval_status(
            approval_id,
            "pending",
            edited_content=payload.edited_content,
            when_ts=now,
        )

        # Log activity
        _safe_log_activity(
            business_id,
            "Edited approval content",
            activity_type="approval_edited",
            metadata={
                "approval_id": approval_id,
                "edited_at": now,
            },
        )

        return {
            "status": "edited",
            "approval_id": approval_id,
            "edited_at": now,
            "edited_content": payload.edited_content,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to edit action {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to edit action",
        ) from error


@router.get("/{approval_id}")
@limiter.limit("60/minute")
async def get_approval_detail(
    request: Request,
    approval_id: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Get approval details."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        return {
            "id": approval.get("id"),
            "status": approval.get("status"),
            "type": approval.get("type"),
            "who": approval.get("who"),
            "what": approval.get("what"),
            "why": approval.get("why"),
            "draft_content": approval.get("draft_content"),
            "edited_content": approval.get("edited_content"),
            "created_at": approval.get("created_at"),
            "when_ts": approval.get("when_ts"),
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to get approval {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve approval",
        ) from error
