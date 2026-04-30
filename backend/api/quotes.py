"""Quote generation API endpoints.

PRD v6.0 Section 8.1 — MVP addition.
Owner provides natural language instruction → AI extracts quote details →
approval card created → on approval, quote sent as email (Xero quote optional).

Example: "Quote Sarah for a 60sqm deck rebuild, standard rates."
"""
import json
import logging
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from core.ai import get_ai_provider
from db.supabase import create_approval, get_memory_profile, log_activity
from rate_limit import limiter

router = APIRouter(prefix="/api/quotes", tags=["quotes"])
logger = logging.getLogger("olivander")


def _quote_summary(quote_data: dict[str, Any]) -> str:
    contact = quote_data.get("contact_name") or "Unknown contact"
    items = quote_data.get("line_items") or []
    total_excl = sum(
        float(i.get("unit_amount_excl_gst", 0)) * float(i.get("quantity", 1))
        for i in items
    )
    gst_registered = quote_data.get("gst_registered", False)
    title = quote_data.get("title") or "Quote"
    expiry = (date.today() + timedelta(days=int(quote_data.get("expiry_date_days", 30)))).strftime("%d %b %Y")
    if gst_registered:
        gst = round(total_excl * 0.15, 2)
        total_incl = round(total_excl + gst, 2)
        return f"{title} for {contact} — NZD ${total_excl:.2f} + ${gst:.2f} GST = ${total_incl:.2f} (valid until {expiry})"
    return f"{title} for {contact} — NZD ${total_excl:.2f} (valid until {expiry})"


def _format_quote_html(quote_data: dict[str, Any], business_name: str) -> str:
    """Produce an HTML quote body for the approval email and outbound send."""
    contact = quote_data.get("contact_name") or "Valued Customer"
    title = quote_data.get("title") or "Quote"
    items = quote_data.get("line_items") or []
    gst_registered = quote_data.get("gst_registered", False)
    expiry_days = int(quote_data.get("expiry_date_days", 30))
    expiry = (date.today() + timedelta(days=expiry_days)).strftime("%d %B %Y")
    terms = quote_data.get("terms") or ""
    notes = quote_data.get("notes") or ""

    total_excl = sum(
        float(i.get("unit_amount_excl_gst", 0)) * float(i.get("quantity", 1))
        for i in items
    )
    gst_amount = round(total_excl * 0.15, 2) if gst_registered else 0.0
    total_incl = round(total_excl + gst_amount, 2)

    rows = ""
    for item in items:
        qty = float(item.get("quantity", 1))
        unit = float(item.get("unit_amount_excl_gst", 0))
        line_total = round(qty * unit, 2)
        rows += f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #DED9D0">{item.get("description","")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #DED9D0;text-align:right">{qty:g}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #DED9D0;text-align:right">${unit:,.2f}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #DED9D0;text-align:right">${line_total:,.2f}</td>
        </tr>"""

    gst_row = ""
    if gst_registered:
        gst_row = f"""
        <tr>
          <td colspan="3" style="padding:6px 12px;text-align:right;color:#5C6475">GST (15%)</td>
          <td style="padding:6px 12px;text-align:right;color:#5C6475">${gst_amount:,.2f}</td>
        </tr>"""

    terms_section = f'<p style="margin-top:20px;font-size:14px;color:#5C6475"><strong>Terms:</strong> {terms}</p>' if terms else ""
    notes_section = f'<p style="font-size:14px;color:#5C6475">{notes}</p>' if notes else ""

    return f"""
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;color:#3D4452">
  <h2 style="color:#2C3240;margin-bottom:4px">{title}</h2>
  <p style="color:#5C6475;margin-top:0">Prepared for {contact} &nbsp;·&nbsp; Valid until {expiry}</p>
  <p style="color:#5C6475;font-size:14px">From {business_name}</p>

  <table style="width:100%;border-collapse:collapse;margin-top:16px">
    <thead>
      <tr style="background:#F5F0E8">
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#5C6475">Description</th>
        <th style="padding:8px 12px;text-align:right;font-size:13px;color:#5C6475">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:13px;color:#5C6475">Unit</th>
        <th style="padding:8px 12px;text-align:right;font-size:13px;color:#5C6475">Total</th>
      </tr>
    </thead>
    <tbody>
      {rows}
      {gst_row}
      <tr style="background:#F5F0E8">
        <td colspan="3" style="padding:10px 12px;font-weight:600;text-align:right">Total</td>
        <td style="padding:10px 12px;font-weight:600;text-align:right">NZD ${total_incl:,.2f}</td>
      </tr>
    </tbody>
  </table>

  {terms_section}
  {notes_section}
</div>
""".strip()


def generate_quote_pdf(quote_data: dict[str, Any], business_name: str) -> bytes:
    """Render a quote as a PDF using WeasyPrint and return raw bytes."""
    from weasyprint import HTML

    contact = quote_data.get("contact_name") or "Valued Customer"
    title = quote_data.get("title") or "Quote"
    items = quote_data.get("line_items") or []
    gst_registered = quote_data.get("gst_registered", False)
    expiry_days = int(quote_data.get("expiry_date_days", 30))
    expiry = (date.today() + timedelta(days=expiry_days)).strftime("%d %B %Y")
    terms = quote_data.get("terms") or ""
    notes = quote_data.get("notes") or ""

    total_excl = sum(
        float(i.get("unit_amount_excl_gst", 0)) * float(i.get("quantity", 1))
        for i in items
    )
    gst_amount = round(total_excl * 0.15, 2) if gst_registered else 0.0
    total_incl = round(total_excl + gst_amount, 2)

    rows = ""
    for item in items:
        qty = float(item.get("quantity", 1))
        unit = float(item.get("unit_amount_excl_gst", 0))
        line_total = round(qty * unit, 2)
        rows += (
            f"<tr>"
            f"<td>{item.get('description', '')}</td>"
            f"<td class='r'>{qty:g}</td>"
            f"<td class='r'>${unit:,.2f}</td>"
            f"<td class='r'>${line_total:,.2f}</td>"
            f"</tr>"
        )

    gst_row = (
        f"<tr class='sub'>"
        f"<td colspan='3' class='r muted'>GST (15%)</td>"
        f"<td class='r muted'>${gst_amount:,.2f}</td>"
        f"</tr>"
    ) if gst_registered else ""

    terms_block = f"<p class='terms'><strong>Terms:</strong> {terms}</p>" if terms else ""
    notes_block = f"<p class='notes'>{notes}</p>" if notes else ""
    today = date.today().strftime("%d %B %Y")

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 40px 50px; }}
body {{ font-family: Arial, Helvetica, sans-serif; color: #3D4452; font-size: 13px; margin: 0; }}
.hdr {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }}
h1 {{ font-size: 22px; color: #2C3240; margin: 0 0 4px 0; }}
.meta {{ color: #5C6475; margin: 0; font-size: 12px; }}
.biz {{ font-size: 17px; font-weight: bold; color: #5A4FD0; text-align: right; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 4px; }}
th {{ background: #F5F0E8; padding: 7px 10px; text-align: left; font-size: 11px; color: #5C6475; }}
th.r, td.r {{ text-align: right; }}
td {{ padding: 7px 10px; border-bottom: 1px solid #DED9D0; }}
tr.sub td {{ border-bottom: none; }}
tr.total td {{ background: #F5F0E8; font-weight: bold; }}
.muted {{ color: #5C6475; }}
.terms, .notes {{ margin-top: 18px; font-size: 12px; color: #5C6475; }}
.footer {{ margin-top: 36px; font-size: 11px; color: #8C93A4; }}
</style></head><body>
<div class="hdr">
  <div><h1>{title}</h1><p class="meta">Prepared for {contact} &nbsp;·&nbsp; Valid until {expiry}</p></div>
  <div class="biz">{business_name}</div>
</div>
<table>
  <thead><tr>
    <th>Description</th><th class="r">Qty</th><th class="r">Unit (excl. GST)</th><th class="r">Total</th>
  </tr></thead>
  <tbody>
    {rows}
    {gst_row}
    <tr class="total">
      <td colspan="3" class="r">Total (NZD)</td>
      <td class="r">${total_incl:,.2f}</td>
    </tr>
  </tbody>
</table>
{terms_block}
{notes_block}
<div class="footer">Prepared {today} by {business_name}.</div>
</body></html>"""

    return HTML(string=html).write_pdf()


class QuoteRequest(BaseModel):
    description: str  # Natural language, e.g. "Quote Sarah for a 60sqm deck rebuild, standard rates"


@router.post("")
@limiter.limit("30/minute")
async def create_quote_approval(
    request: Request,
    payload: QuoteRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Extract quote details from natural language and queue for approval.

    The quote is NOT sent until the owner approves it.
    """
    try:
        memory = get_memory_profile(business_id)
        business_context = {
            "business_name": memory.get("business_name") or "",
            "gst_registered": memory.get("gst_registered") or "false",
            "payment_terms": memory.get("payment_terms") or "",
        }

        ai = get_ai_provider()
        try:
            quote_data = ai.extract_quote_details(
                payload.description,
                business_context,
                business_id=business_id,
            )
        except ValueError as exc:
            logger.error("Quote extraction failed for %s: %s", business_id, exc)
            raise HTTPException(status_code=422, detail="Could not extract quote details from that description.") from exc

        business_name = business_context.get("business_name") or "Your Business"
        html_body = _format_quote_html(quote_data, business_name)
        quote_data["html_body"] = html_body

        summary = _quote_summary(quote_data)
        draft_content = json.dumps(quote_data)

        approval = create_approval(
            business_id=business_id,
            approval_type="send_quote",
            who=quote_data.get("contact_name") or "",
            what=summary,
            why="Quote ready to send — review before sending to client.",
            draft_content=draft_content,
        )
        if not approval:
            raise HTTPException(status_code=500, detail="Could not create quote approval.")

        log_activity(
            business_id,
            f"Quote approval queued: {summary}",
            activity_type="approval_created",
            metadata={
                "approval_id": approval.get("id"),
                "contact_name": quote_data.get("contact_name"),
                "type": "quote",
            },
        )

        return {
            "status": "pending_approval",
            "approval_id": approval.get("id"),
            "summary": summary,
            "quote_details": {k: v for k, v in quote_data.items() if k != "html_body"},
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error("Quote creation failed for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create quote approval.") from error
