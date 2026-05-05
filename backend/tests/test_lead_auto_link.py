import os

from cryptography.fernet import Fernet

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-supabase-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-supabase-service-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-api-key")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-value-with-32-chars")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")

import db.supabase as supabase_db
import gmail.client as gmail_client
import gmail.webhook as gmail_webhook


def test_create_or_link_lead_from_email_creates_when_missing(monkeypatch) -> None:
    captured = {}

    monkeypatch.setattr(supabase_db, "get_lead_by_thread_id", lambda *args, **kwargs: None)
    monkeypatch.setattr(supabase_db, "get_lead_by_email", lambda *args, **kwargs: None)

    def fake_create_lead(business_id: str, **kwargs):
        captured["business_id"] = business_id
        captured.update(kwargs)
        return {"id": "lead-123", **kwargs}

    monkeypatch.setattr(supabase_db, "create_lead", fake_create_lead)

    lead, created = supabase_db.create_or_link_lead_from_email(
        "business-123",
        name="Sam Taylor",
        email="sam@example.co.nz",
        thread_id="thread-123",
        approval_id="approval-123",
        subject="Heat pump service",
        snippet="Can you service our heat pump this week?",
    )

    assert created is True
    assert lead["id"] == "lead-123"
    assert captured["email"] == "sam@example.co.nz"
    assert captured["thread_id"] == "thread-123"
    assert captured["approval_id"] == "approval-123"
    assert captured["source"] == "email"
    assert captured["enquiry_type"] == "new_lead"


def test_create_or_link_lead_from_email_links_existing_by_email(monkeypatch) -> None:
    updates = {}
    existing = {
        "id": "lead-123",
        "name": "Sam Taylor",
        "email": "sam@example.co.nz",
        "thread_id": None,
        "approval_id": None,
    }

    monkeypatch.setattr(supabase_db, "get_lead_by_thread_id", lambda *args, **kwargs: None)
    monkeypatch.setattr(supabase_db, "get_lead_by_email", lambda *args, **kwargs: existing)

    def fake_update_lead(business_id: str, lead_id: str, payload: dict):
        updates["business_id"] = business_id
        updates["lead_id"] = lead_id
        updates["payload"] = payload
        return {**existing, **payload}

    monkeypatch.setattr(supabase_db, "update_lead", fake_update_lead)

    lead, created = supabase_db.create_or_link_lead_from_email(
        "business-123",
        name="Sam Taylor",
        email="sam@example.co.nz",
        thread_id="thread-123",
        approval_id="approval-123",
        subject="Heat pump service",
        snippet="Can you service our heat pump this week?",
    )

    assert created is False
    assert lead["id"] == "lead-123"
    assert updates["lead_id"] == "lead-123"
    assert updates["payload"] == {
        "thread_id": "thread-123",
        "approval_id": "approval-123",
    }


def test_gmail_new_lead_processing_creates_or_links_pipeline_lead(monkeypatch) -> None:
    captured = {}

    monkeypatch.setattr(
        gmail_webhook,
        "get_business_by_email",
        lambda email: {"id": "business-123", "email": email, "business_name": "Test Business"},
    )
    monkeypatch.setattr(gmail_webhook, "get_valid_token", lambda business_id: "google-token")
    monkeypatch.setattr(
        gmail_client,
        "list_recent_messages",
        lambda access_token, max_results=1, label_ids=None: [
            {
                "id": "msg-123",
                "thread_id": "thread-123",
                "from": "Sam Taylor <sam@example.co.nz>",
                "from_name": "Sam Taylor",
                "subject": "Heat pump service",
                "snippet": "Can you service our heat pump this week?",
                "date": "Tue, 5 May 2026 10:00:00 +1200",
            }
        ],
    )
    monkeypatch.setattr(gmail_webhook, "approval_exists_for_message", lambda *args, **kwargs: False)
    monkeypatch.setattr(
        gmail_webhook,
        "get_thread",
        lambda *args, **kwargs: [
            {
                "from": "Sam Taylor <sam@example.co.nz>",
                "subject": "Heat pump service",
                "date": "Tue, 5 May 2026 10:00:00 +1200",
                "body": "Can you service our heat pump this week?",
            }
        ],
    )
    monkeypatch.setattr(gmail_webhook, "classify_email", lambda **kwargs: "new_lead")
    monkeypatch.setattr(gmail_webhook, "get_business_by_id", lambda business_id: {"email": "owner@example.com"})
    monkeypatch.setattr(gmail_webhook, "get_memory_profile", lambda business_id: {})
    monkeypatch.setattr(gmail_webhook, "retrieve_context_chunks", lambda *args, **kwargs: [])
    monkeypatch.setattr(gmail_webhook, "draft_reply", lambda **kwargs: "Draft reply")
    monkeypatch.setattr(gmail_webhook, "build_execution_plan", lambda **kwargs: {"steps": []})
    monkeypatch.setattr(gmail_webhook, "create_approval", lambda **kwargs: {"id": "approval-123"})
    monkeypatch.setattr(gmail_webhook, "log_activity", lambda *args, **kwargs: None)
    monkeypatch.setattr(gmail_webhook, "send_approval_notification", lambda **kwargs: None)
    monkeypatch.setattr(gmail_webhook, "_enqueue_missed_response_check", lambda **kwargs: None)
    monkeypatch.setattr(gmail_webhook, "_enqueue_new_lead_follow_ups", lambda **kwargs: None)

    def fake_create_or_link_lead(business_id: str, **kwargs):
        captured["business_id"] = business_id
        captured.update(kwargs)
        return {"id": "lead-123", "name": kwargs["name"]}, True

    monkeypatch.setattr(gmail_webhook, "create_or_link_lead_from_email", fake_create_or_link_lead)

    gmail_webhook._process_gmail_notification("owner@example.com", "history-123")

    assert captured["business_id"] == "business-123"
    assert captured["name"] == "Sam Taylor"
    assert captured["email"] == "sam@example.co.nz"
    assert captured["thread_id"] == "thread-123"
    assert captured["approval_id"] == "approval-123"
    assert captured["subject"] == "Heat pump service"
