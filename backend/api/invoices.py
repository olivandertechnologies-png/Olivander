"""Invoice API endpoints.

POST /api/invoices   — natural language → structured invoice approval

The invoice is extracted from natural language via the AI provider, queued as
a 'xero_invoice' approval, and only created in Xero when the owner approves.

PRD rule: Finance actions never above Tier 3. Every invoice requires approval.
"""
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from auth.xero import get_valid_xero_token
from core.ai import get_ai_provider
from db.supabase import (
    create_approval,
    get_business_by_id,
    get_memory_profile,
    invoice_source_id,
    log_activity,
    pending_invoice_chaser_job_exists,
    pending_invoice_reminder_approval_exists,
)
from rate_limit import limiter
from xero.client import get_invoice, list_unpaid_invoices, normalise_invoice_summary

router = APIRouter(prefix="/api/invoices", tags=["invoices"])
logger = logging.getLogger("olivander")


def _invoice_summary(invoice_data: dict[str, Any]) -> str:
    """Build a short human-readable summary for the approval card."""
    contact = invoice_data.get("contact_name") or "Unknown contact"
    items = invoice_data.get("line_items") or []
    total_excl = sum(
        float(i.get("unit_amount_excl_gst", 0)) * float(i.get("quantity", 1))
        for i in items
    )
    gst_registered = invoice_data.get("gst_registered", False)
    if gst_registered:
        gst = round(total_excl * 0.15, 2)
        total_incl = round(total_excl + gst, 2)
        return f"Invoice: {contact} — NZD ${total_excl:.2f} + ${gst:.2f} GST = ${total_incl:.2f}"
    return f"Invoice: {contact} — NZD ${total_excl:.2f}"


class InvoiceRequest(BaseModel):
    description: str  # Natural language, e.g. "Send invoice to Bob for 2 kayak lessons at $75 each"


class ManualReminderRequest(BaseModel):
    note: str | None = None


def _format_money(amount: float, currency: str = "NZD") -> str:
    return f"{currency} ${amount:,.2f}"


def _manual_reminder_prompt(
    business_id: str,
    invoice: dict[str, Any],
    *,
    note: str | None = None,
) -> str:
    """Build the prompt for an owner-approved invoice reminder draft."""
    business_info = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)
    business_name = memory.get("business_name") or business_info.get("business_name") or "Olivander"
    business_type = memory.get("business_type") or "service business"
    tone = memory.get("reply_tone") or "warm, professional, direct"
    amount = _format_money(float(invoice.get("amount_due") or 0), invoice.get("currency_code") or "NZD")
    due_date = invoice.get("due_date") or "not listed"
    days_overdue = int(invoice.get("days_overdue") or 0)
    timing = (
        f"{days_overdue} days overdue"
        if days_overdue > 0
        else "not yet overdue, but still unpaid"
    )
    owner_note = f"\nOwner note: {note.strip()}" if note and note.strip() else ""

    return f"""You are drafting a payment reminder on behalf of {business_name}, a {business_type} in New Zealand.

Tone: {tone}. Use New Zealand English.
Sign off as: {business_name}

Invoice details:
- Contact: {invoice.get("contact_name") or "Customer"}
- Invoice number: {invoice.get("invoice_number") or invoice.get("invoice_id")}
- Amount outstanding: {amount}
- Due date: {due_date}
- Timing: {timing}{owner_note}

Write the email body only. Keep it concise, polite, and clear. No subject line. No headers.""".strip()


def _draft_manual_reminder(
    business_id: str,
    invoice: dict[str, Any],
    *,
    note: str | None = None,
) -> str:
    ai = get_ai_provider()
    return ai.complete(
        messages=[{"role": "user", "content": _manual_reminder_prompt(business_id, invoice, note=note)}],
        temperature=0.3,
        max_tokens=300,
        operation="manual_invoice_reminder_draft",
        business_id=business_id,
    )


@router.get("/unpaid")
@limiter.limit("60/minute")
async def get_unpaid_invoices(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Return live unpaid Xero invoices for the authenticated business."""
    try:
        xero_token, tenant_id = get_valid_xero_token(business_id)
        invoices = list_unpaid_invoices(xero_token, tenant_id)
        total_due = round(sum(float(invoice.get("amount_due") or 0) for invoice in invoices), 2)
        return {
            "invoices": invoices,
            "count": len(invoices),
            "total_due": total_due,
            "currency_code": invoices[0].get("currency_code", "NZD") if invoices else "NZD",
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.error("Unpaid invoice lookup failed for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load unpaid invoices.") from error


@router.post("")
@limiter.limit("30/minute")
async def create_invoice_approval(
    request: Request,
    payload: InvoiceRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Extract invoice details from natural language and queue for approval.

    The invoice is NOT created in Xero until the owner approves it.
    """
    try:
        memory = get_memory_profile(business_id)
        business_context = {
            "business_name": memory.get("business_name") or "",
            "gst_registered": memory.get("gst_registered") or "false",
        }

        ai = get_ai_provider()
        try:
            invoice_data = ai.extract_invoice_details(
                payload.description,
                business_context,
                business_id=business_id,
            )
        except ValueError as exc:
            logger.error("Invoice extraction failed for %s: %s", business_id, exc)
            raise HTTPException(status_code=422, detail="Could not extract invoice details from that description.") from exc

        summary = _invoice_summary(invoice_data)
        draft_content = json.dumps(invoice_data)

        approval = create_approval(
            business_id=business_id,
            approval_type="xero_invoice",
            who=invoice_data.get("contact_name") or "",
            what=summary,
            why="Finance action — owner approval required before creating invoice.",
            draft_content=draft_content,
        )
        if not approval:
            raise HTTPException(status_code=500, detail="Could not create invoice approval.")

        log_activity(
            business_id,
            f"Invoice approval queued: {summary}",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "contact_name": invoice_data.get("contact_name"),
            },
        )

        return {
            "status": "pending_approval",
            "approval_id": approval.get("id"),
            "summary": summary,
            "invoice_details": invoice_data,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error("Invoice creation failed for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create invoice approval.") from error


@router.post("/{invoice_id}/reminder")
@limiter.limit("30/minute")
async def create_manual_reminder_approval(
    invoice_id: str,
    request: Request,
    payload: ManualReminderRequest | None = None,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Queue a manual invoice reminder for owner approval.

    The reminder is only drafted and added to approvals here. It is not sent
    until the owner approves the approval card.
    """
    try:
        if pending_invoice_reminder_approval_exists(business_id, invoice_id):
            raise HTTPException(
                status_code=409,
                detail="A reminder for this invoice is already waiting for approval.",
            )

        if pending_invoice_chaser_job_exists(business_id, invoice_id, within_hours=48):
            raise HTTPException(
                status_code=409,
                detail="An automated chaser is already scheduled for this invoice within 48 hours.",
            )

        xero_token, tenant_id = get_valid_xero_token(business_id)
        live_invoice = get_invoice(xero_token, tenant_id, invoice_id)
        invoice = normalise_invoice_summary(live_invoice)

        status = str(invoice.get("status") or "").upper()
        if status in {"PAID", "VOIDED", "DELETED"} or float(invoice.get("amount_due") or 0) <= 0:
            raise HTTPException(
                status_code=409,
                detail="This invoice no longer has an outstanding balance in Xero.",
            )
        if status != "AUTHORISED":
            raise HTTPException(
                status_code=409,
                detail=f"Only authorised Xero invoices can be reminded. Current status: {status or 'UNKNOWN'}.",
            )

        contact_email = str(invoice.get("contact_email") or "").strip()
        if not contact_email:
            raise HTTPException(
                status_code=422,
                detail="This Xero contact has no email address. Add one in Xero before sending a reminder.",
            )

        draft_body = _draft_manual_reminder(
            business_id,
            invoice,
            note=payload.note if payload else None,
        )

        invoice_number = invoice.get("invoice_number") or invoice_id
        amount = _format_money(float(invoice.get("amount_due") or 0), invoice.get("currency_code") or "NZD")
        approval = create_approval(
            business_id=business_id,
            approval_type="email_reply",
            who=f"{invoice.get('contact_name')} <{contact_email}>",
            what=f"Invoice reminder - {invoice_number}",
            why=(
                f"Manual reminder requested from live Xero data. "
                f"Outstanding balance: {amount}. Owner approval required before sending."
            ),
            original_email_id=invoice_source_id(invoice_id),
            draft_content=draft_body,
        )
        if not approval:
            raise HTTPException(status_code=500, detail="Could not create reminder approval.")

        log_activity(
            business_id,
            f"Manual invoice reminder queued for {invoice.get('contact_name')} ({invoice_number})",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "xero_invoice_id": invoice_id,
                "invoice_number": invoice_number,
                "amount_due": invoice.get("amount_due"),
            },
        )

        return {
            "status": "pending_approval",
            "approval_id": approval.get("id"),
            "invoice": invoice,
        }
    except HTTPException:
        raise
    except Exception as error:
        logger.error("Manual invoice reminder failed for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create reminder approval.") from error
