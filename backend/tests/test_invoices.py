import os

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-supabase-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-supabase-service-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-api-key")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-value-with-32-chars")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")

import api.invoices as invoices_api
import main
from auth.google import create_session_token

client = TestClient(main.app)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {create_session_token('business-123', 'owner@example.com')}"}


def test_get_unpaid_invoices_returns_live_xero_rows(monkeypatch) -> None:
    monkeypatch.setattr(invoices_api, "get_valid_xero_token", lambda business_id: ("token", "tenant"))
    monkeypatch.setattr(
        invoices_api,
        "list_unpaid_invoices",
        lambda token, tenant: [
            {
                "invoice_id": "inv-1",
                "invoice_number": "INV-001",
                "contact_name": "Acme Ltd",
                "contact_email": "accounts@acme.test",
                "amount_due": 120.0,
                "currency_code": "NZD",
                "due_date": "2026-04-25",
                "days_overdue": 10,
                "status": "AUTHORISED",
            }
        ],
    )

    response = client.get("/api/invoices/unpaid", headers=_auth_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["total_due"] == 120.0
    assert payload["invoices"][0]["invoice_number"] == "INV-001"


def test_manual_invoice_reminder_queues_approval_from_live_xero(monkeypatch) -> None:
    captured = {}

    monkeypatch.setattr(invoices_api, "pending_invoice_reminder_approval_exists", lambda *args, **kwargs: False)
    monkeypatch.setattr(invoices_api, "pending_invoice_chaser_job_exists", lambda *args, **kwargs: False)
    monkeypatch.setattr(invoices_api, "get_valid_xero_token", lambda business_id: ("token", "tenant"))
    monkeypatch.setattr(
        invoices_api,
        "get_invoice",
        lambda token, tenant, invoice_id: {
            "InvoiceID": invoice_id,
            "InvoiceNumber": "INV-001",
            "Status": "AUTHORISED",
            "AmountDue": 150.5,
            "CurrencyCode": "NZD",
            "DueDateString": "2026-04-25",
            "Contact": {"Name": "Acme Ltd", "EmailAddress": "accounts@acme.test"},
        },
    )
    monkeypatch.setattr(invoices_api, "_draft_manual_reminder", lambda *args, **kwargs: "Hi, just checking in on this invoice.")
    monkeypatch.setattr(invoices_api, "log_activity", lambda *args, **kwargs: None)

    def fake_create_approval(**kwargs):
        captured.update(kwargs)
        return {"id": "approval-123"}

    monkeypatch.setattr(invoices_api, "create_approval", fake_create_approval)

    response = client.post("/api/invoices/inv-1/reminder", headers=_auth_headers(), json={})

    assert response.status_code == 200
    assert response.json()["approval_id"] == "approval-123"
    assert captured["approval_type"] == "email_reply"
    assert captured["who"] == "Acme Ltd <accounts@acme.test>"
    assert captured["what"] == "Invoice reminder - INV-001"
    assert captured["original_email_id"] == "xero_invoice:inv-1"
    assert captured["draft_content"] == "Hi, just checking in on this invoice."


def test_manual_invoice_reminder_warns_when_chaser_is_already_scheduled(monkeypatch) -> None:
    monkeypatch.setattr(invoices_api, "pending_invoice_reminder_approval_exists", lambda *args, **kwargs: False)
    monkeypatch.setattr(invoices_api, "pending_invoice_chaser_job_exists", lambda *args, **kwargs: True)

    response = client.post("/api/invoices/inv-1/reminder", headers=_auth_headers(), json={})

    assert response.status_code == 409
    assert "automated chaser" in response.json()["detail"]
