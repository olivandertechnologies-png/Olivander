"""Xero implementation of AccountingProvider."""
from datetime import date, timedelta
from typing import Any

import requests
from fastapi import HTTPException

from providers.base import AccountingProvider

XERO_API_BASE = "https://api.xero.com/api.xro/2.0"
DEFAULT_SALES_ACCOUNT = "200"


def _headers(access_token: str, tenant_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Xero-tenant-id": tenant_id,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


class XeroProvider(AccountingProvider):
    """Wraps xero/client.py functions behind the AccountingProvider interface."""

    def create_invoice(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_id: str,
        line_items: list[dict[str, Any]],
        due_date_days: int = 30,
        gst_registered: bool = True,
        currency: str = "NZD",
        reference: str = "",
    ) -> str:
        from xero.client import create_invoice
        result = create_invoice(
            access_token,
            tenant_id,
            contact_id=contact_id,
            line_items=line_items,
            due_date_days=due_date_days,
            gst_registered=gst_registered,
            currency=currency,
            reference=reference,
        )
        return str(result.get("InvoiceID", ""))

    def get_payment_status(
        self, access_token: str, tenant_id: str, invoice_id: str
    ) -> str:
        from xero.client import get_invoice_status
        return get_invoice_status(access_token, tenant_id, invoice_id)

    def list_unpaid(
        self, access_token: str, tenant_id: str
    ) -> list[dict[str, Any]]:
        from xero.client import list_unpaid_invoices
        return list_unpaid_invoices(access_token, tenant_id)

    def list_overdue(
        self, access_token: str, tenant_id: str, days: int = 7
    ) -> list[dict[str, Any]]:
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        response = requests.get(
            f"{XERO_API_BASE}/Invoices",
            params={
                "where": f'Type=="ACCREC" AND Status=="AUTHORISED" AND DueDate<DateTime({cutoff.replace("-", ",")})',
                "order": "DueDate ASC",
            },
            headers=_headers(access_token, tenant_id),
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Xero list overdue failed with status {response.status_code}.",
            )
        return response.json().get("Invoices") or []

    def create_expense(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_name: str,
        amount: float,
        gst_amount: float,
        category: str,
        description: str,
        expense_date: str,
    ) -> str:
        body = {
            "Receipts": [
                {
                    "Date": expense_date,
                    "Contact": {"Name": contact_name},
                    "Lineitems": [
                        {
                            "Description": description,
                            "UnitAmount": round(amount - gst_amount, 2),
                            "TaxAmount": round(gst_amount, 2),
                            "TaxType": "INPUT2",
                            "AccountCode": "300",
                        }
                    ],
                    "Status": "DRAFT",
                }
            ]
        }
        response = requests.post(
            f"{XERO_API_BASE}/Receipts",
            json=body,
            headers=_headers(access_token, tenant_id),
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Xero create expense failed with status {response.status_code}.",
            )
        receipts = response.json().get("Receipts") or []
        if not receipts:
            raise HTTPException(status_code=502, detail="Xero returned no receipt after creation.")
        return str(receipts[0].get("ReceiptID", ""))

    def get_bank_balance(
        self, access_token: str, tenant_id: str
    ) -> float | None:
        response = requests.get(
            f"{XERO_API_BASE}/BankTransactions",
            params={"where": 'Type=="RECEIVE"', "order": "Date DESC"},
            headers=_headers(access_token, tenant_id),
            timeout=20,
        )
        if not response.ok:
            return None

        response2 = requests.get(
            f"{XERO_API_BASE}/Accounts",
            params={"where": 'Type=="BANK"'},
            headers=_headers(access_token, tenant_id),
            timeout=20,
        )
        if not response2.ok:
            return None
        accounts = response2.json().get("Accounts") or []
        if not accounts:
            return None
        return float(accounts[0].get("BankAccountNumber") or 0)

    def create_quote(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_id: str,
        line_items: list[dict[str, Any]],
        expiry_date_days: int = 30,
        gst_registered: bool = True,
        currency: str = "NZD",
        title: str = "",
        terms: str = "",
    ) -> str:
        expiry_date = (date.today() + timedelta(days=expiry_date_days)).isoformat()
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
            "Quotes": [
                {
                    "Contact": {"ContactID": contact_id},
                    "LineItems": xero_line_items,
                    "ExpiryDate": expiry_date,
                    "CurrencyCode": currency,
                    "Status": "DRAFT",
                    "Title": title or "Quote",
                    "Terms": terms,
                }
            ]
        }
        response = requests.post(
            f"{XERO_API_BASE}/Quotes",
            json=body,
            headers=_headers(access_token, tenant_id),
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Xero create quote failed with status {response.status_code}.",
            )
        quotes = response.json().get("Quotes") or []
        if not quotes:
            raise HTTPException(status_code=502, detail="Xero returned no quote after creation.")
        return str(quotes[0].get("QuoteID", ""))

    def get_contact(
        self,
        access_token: str,
        tenant_id: str,
        email_or_name: str,
    ) -> dict[str, Any] | None:
        from xero.client import find_contact
        if "@" in email_or_name:
            return find_contact(access_token, tenant_id, email=email_or_name)
        return find_contact(access_token, tenant_id, name=email_or_name)

    def find_or_create_contact(
        self,
        access_token: str,
        tenant_id: str,
        *,
        name: str,
        email: str | None = None,
    ) -> str:
        from xero.client import find_or_create_contact
        return find_or_create_contact(access_token, tenant_id, name=name, email=email)
