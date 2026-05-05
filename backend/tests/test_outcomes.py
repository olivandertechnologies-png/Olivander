import os
from datetime import datetime, timedelta, timezone

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

import api.outcomes as outcomes_api
import main
from auth.google import create_session_token
from db.supabase import build_outcomes_summary

client = TestClient(main.app)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {create_session_token('business-123', 'owner@example.com')}"}


def test_build_outcomes_summary_counts_rolling_window_records() -> None:
    now = datetime(2026, 5, 5, 12, 0, tzinfo=timezone.utc)
    since = now - timedelta(days=30)
    approved_at = now - timedelta(hours=2)
    created_at = approved_at - timedelta(hours=3)

    summary = build_outcomes_summary(
        approvals=[
            {
                "status": "approved",
                "type": "email_reply",
                "original_email_id": "gmail-1",
                "created_at": created_at.isoformat(),
                "when_ts": approved_at.isoformat(),
            },
            {
                "status": "approved",
                "type": "send_quote",
                "created_at": created_at.isoformat(),
                "when_ts": approved_at.isoformat(),
            },
            {
                "status": "approved",
                "type": "email_reply",
                "original_email_id": "xero_invoice:inv-1",
                "created_at": created_at.isoformat(),
                "when_ts": approved_at.isoformat(),
            },
            {
                "status": "approved",
                "type": "email_reply",
                "original_email_id": "gmail-old",
                "created_at": (since - timedelta(days=2)).isoformat(),
                "when_ts": (since - timedelta(hours=1)).isoformat(),
            },
        ],
        jobs=[
            {"status": "completed", "job_type": "follow_up_email", "updated_at": approved_at.isoformat()},
            {"status": "completed", "job_type": "chase_invoice", "updated_at": approved_at.isoformat()},
            {"status": "pending", "job_type": "follow_up_email", "updated_at": approved_at.isoformat()},
        ],
        leads=[
            {"source": "email", "created_at": approved_at.isoformat()},
            {"source": "manual", "created_at": approved_at.isoformat()},
        ],
        since=since,
        now=now,
    )

    assert summary["emails_triaged"] == 1
    assert summary["follow_ups_sent"] == 1
    assert summary["invoices_chased"] == 1
    assert summary["quotes_sent"] == 1
    assert summary["leads_created"] == 1
    assert summary["avg_response_time_hours"] == 3.0
    assert summary["total_admin_tasks"] == 5


def test_outcomes_summary_endpoint_returns_business_summary(monkeypatch) -> None:
    monkeypatch.setattr(
        outcomes_api,
        "get_outcomes_summary",
        lambda business_id: {
            "window_days": 30,
            "total_admin_tasks": 7,
            "emails_triaged": 2,
            "follow_ups_sent": 1,
            "invoices_chased": 1,
            "quotes_sent": 1,
            "avg_response_time_hours": 1.5,
            "leads_created": 2,
        },
    )

    response = client.get("/api/outcomes/summary", headers=_auth_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_admin_tasks"] == 7
    assert payload["avg_response_time_hours"] == 1.5
