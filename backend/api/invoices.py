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
from core.ai import get_ai_provider
from db.supabase import create_approval, get_memory_profile, log_activity
from rate_limit import limiter

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
