"""Xero API client.

Wraps the Xero accounting API (v2) for invoice and contact operations.
Same REST pattern as gmail/client.py — plain requests, caller supplies tokens,
FastAPI HTTPExceptions on errors.

Xero API docs: https://developer.xero.com/documentation/api/accounting/overview
"""
import logging
import re
from datetime import date, timedelta
from typing import Any

import requests
from fastapi import HTTPException

logger = logging.getLogger("olivander")

XERO_API_BASE = "https://api.xero.com/api.xro/2.0"

# Default NZ Xero account code for sales.
# Businesses can configure their own in memory if different.
DEFAULT_SALES_ACCOUNT = "200"

# NZ GST rate
NZ_GST_RATE = 0.15

_XERO_DOTNET_DATE_RE = re.compile(r"/Date\((?P<millis>-?\d+)")


def _xero_headers(access_token: str, tenant_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Xero-tenant-id": tenant_id,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


# ── Contacts ───────────────────────────────────────────────────────────────────

def find_contact(
    access_token: str,
    tenant_id: str,
    *,
    name: str | None = None,
    email: str | None = None,
) -> dict[str, Any] | None:
    """Search for an existing Xero contact by email (preferred) or name.

    Returns the first matching contact dict, or None if not found.
    """
    if email:
        where = f'EmailAddress="{email}"'
        response = requests.get(
            f"{XERO_API_BASE}/Contacts",
            params={"where": where},
            headers=_xero_headers(access_token, tenant_id),
            timeout=20,
        )
        if response.ok:
            contacts = response.json().get("Contacts") or []
            if contacts:
                return contacts[0]

    if name:
        # Contains search — URL-encode the where clause
        where = f'Name.Contains("{name}")'
        response = requests.get(
            f"{XERO_API_BASE}/Contacts",
            params={"where": where},
            headers=_xero_headers(access_token, tenant_id),
            timeout=20,
        )
        if response.ok:
            contacts = response.json().get("Contacts") or []
            if contacts:
                return contacts[0]

    return None


def create_contact(
    access_token: str,
    tenant_id: str,
    *,
    name: str,
    email: str | None = None,
) -> dict[str, Any]:
    """Create a Xero contact and return the created resource."""
    body: dict[str, Any] = {"Name": name}
    if email:
        body["EmailAddress"] = email

    response = requests.post(
        f"{XERO_API_BASE}/Contacts",
        json={"Contacts": [body]},
        headers=_xero_headers(access_token, tenant_id),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Xero create contact failed with status {response.status_code}.",
        )

    contacts = response.json().get("Contacts") or []
    if not contacts:
        raise HTTPException(status_code=502, detail="Xero returned no contact after creation.")
    return contacts[0]


def find_or_create_contact(
    access_token: str,
    tenant_id: str,
    *,
    name: str,
    email: str | None = None,
) -> str:
    """Return the ContactID for name/email, creating if necessary."""
    existing = find_contact(access_token, tenant_id, name=name, email=email)
    if existing:
        return str(existing["ContactID"])
    created = create_contact(access_token, tenant_id, name=name, email=email)
    return str(created["ContactID"])


# ── Invoices ───────────────────────────────────────────────────────────────────

def create_invoice(
    access_token: str,
    tenant_id: str,
    *,
    contact_id: str,
    line_items: list[dict[str, Any]],
    due_date_days: int = 30,
    gst_registered: bool = True,
    currency: str = "NZD",
    reference: str = "",
) -> dict[str, Any]:
    """Create a DRAFT sales invoice in Xero.

    line_items: list of dicts with keys 'description', 'quantity', 'unit_amount_excl_gst'.
    Returns the created Invoice resource.
    """
    due_date = (date.today() + timedelta(days=due_date_days)).isoformat()
    tax_type = "OUTPUT2" if gst_registered else "NONE"

    xero_line_items = [
        {
            "Description": item.get("description", "Service"),
            "Quantity": float(item.get("quantity", 1)),
            "UnitAmount": round(float(item.get("unit_amount_excl_gst", 0)), 2),
            "AccountCode": DEFAULT_SALES_ACCOUNT,
            "TaxType": tax_type,
        }
        for item in line_items
    ]

    body = {
        "Invoices": [
            {
                "Type": "ACCREC",
                "Contact": {"ContactID": contact_id},
                "LineItems": xero_line_items,
                "Status": "DRAFT",
                "DueDate": due_date,
                "CurrencyCode": currency,
                "Reference": reference,
            }
        ]
    }

    response = requests.post(
        f"{XERO_API_BASE}/Invoices",
        json=body,
        headers=_xero_headers(access_token, tenant_id),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Xero create invoice failed with status {response.status_code}.",
        )

    invoices = response.json().get("Invoices") or []
    if not invoices:
        raise HTTPException(status_code=502, detail="Xero returned no invoice after creation.")
    return invoices[0]


def _parse_xero_date(value: Any) -> date | None:
    """Parse the date formats Xero may return for invoice dates."""
    if not value:
        return None

    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    dotnet_match = _XERO_DOTNET_DATE_RE.match(text)
    if dotnet_match:
        millis = int(dotnet_match.group("millis"))
        return date.fromtimestamp(millis / 1000)

    normalised = text.replace("Z", "+00:00")
    try:
        return date.fromisoformat(normalised[:10])
    except ValueError:
        return None


def normalise_invoice_summary(invoice: dict[str, Any]) -> dict[str, Any]:
    """Return the unpaid-invoice shape used by the API and dashboard."""
    contact = invoice.get("Contact") or {}
    due = _parse_xero_date(
        invoice.get("DueDateString")
        or invoice.get("DueDate")
        or invoice.get("dueDate")
    )
    amount_due = float(invoice.get("AmountDue") or invoice.get("amount_due") or 0)
    days_overdue = max((date.today() - due).days, 0) if due else 0

    return {
        "invoice_id": str(invoice.get("InvoiceID") or invoice.get("invoiceID") or invoice.get("id") or ""),
        "invoice_number": str(invoice.get("InvoiceNumber") or invoice.get("invoiceNumber") or ""),
        "contact_name": str(contact.get("Name") or invoice.get("contact_name") or "Unknown contact"),
        "contact_email": str(contact.get("EmailAddress") or invoice.get("contact_email") or ""),
        "amount_due": round(amount_due, 2),
        "currency_code": str(invoice.get("CurrencyCode") or invoice.get("currency_code") or "NZD"),
        "due_date": due.isoformat() if due else None,
        "days_overdue": days_overdue,
        "status": str(invoice.get("Status") or invoice.get("status") or "UNKNOWN"),
    }


def list_unpaid_invoices(
    access_token: str,
    tenant_id: str,
) -> list[dict[str, Any]]:
    """Fetch authorised unpaid sales invoices from Xero, oldest due date first."""
    response = requests.get(
        f"{XERO_API_BASE}/Invoices",
        params={
            "where": 'Type=="ACCREC" AND Status=="AUTHORISED"',
            "order": "DueDate ASC",
        },
        headers=_xero_headers(access_token, tenant_id),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Xero list unpaid invoices failed with status {response.status_code}.",
        )

    invoices = response.json().get("Invoices") or []
    summaries = [
        normalise_invoice_summary(invoice)
        for invoice in invoices
        if float(invoice.get("AmountDue") or 0) > 0
    ]
    return sorted(summaries, key=lambda row: row.get("due_date") or "9999-12-31")


def get_invoice(
    access_token: str,
    tenant_id: str,
    invoice_id: str,
) -> dict[str, Any]:
    """Fetch a single Xero invoice by ID."""
    response = requests.get(
        f"{XERO_API_BASE}/Invoices/{invoice_id}",
        headers=_xero_headers(access_token, tenant_id),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Xero get invoice failed with status {response.status_code}.",
        )

    invoices = response.json().get("Invoices") or []
    if not invoices:
        raise HTTPException(status_code=502, detail="Xero invoice not found.")
    return invoices[0]


def get_invoice_status(
    access_token: str,
    tenant_id: str,
    invoice_id: str,
) -> str:
    """Return the current status string of a Xero invoice (e.g. 'DRAFT', 'PAID')."""
    invoice = get_invoice(access_token, tenant_id, invoice_id)
    return str(invoice.get("Status", "UNKNOWN"))
