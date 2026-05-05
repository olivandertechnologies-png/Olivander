import jobs.handlers as handlers


def test_missed_response_check_creates_non_sending_approval(monkeypatch) -> None:
    import db.supabase as supabase_db

    captured = {}

    monkeypatch.setattr(
        supabase_db,
        "get_approval_for_original_email",
        lambda business_id, message_id: {"id": "approval-1", "status": "pending"},
    )
    monkeypatch.setattr(
        supabase_db,
        "pending_missed_response_approval_exists",
        lambda business_id, message_id: False,
    )
    monkeypatch.setattr(supabase_db, "missed_response_source_id", lambda message_id: f"missed_response:{message_id}")

    def fake_create_approval(**kwargs):
        captured.update(kwargs)
        return {"id": "missed-approval-1"}

    monkeypatch.setattr(supabase_db, "create_approval", fake_create_approval)
    monkeypatch.setattr(supabase_db, "log_activity", lambda *args, **kwargs: None)

    handlers.handle_missed_response_check(
        {
            "id": "job-1",
            "payload": {
                "business_id": "business-123",
                "original_email_id": "msg-123",
                "sender_name": "Sam Taylor",
                "sender_email": "sam@example.co.nz",
                "subject": "Heat pump service",
                "original_body": "Can you service our heat pump this week?",
                "classification": "new_lead",
            },
        }
    )

    assert captured["approval_type"] == "missed_response"
    assert captured["who"] == "Sam Taylor <sam@example.co.nz>"
    assert captured["what"] == "Missed response - Heat pump service"
    assert captured["original_email_id"] == "missed_response:msg-123"
    assert "No approved reply recorded" in captured["why"]


def test_missed_response_check_skips_handled_original(monkeypatch) -> None:
    import db.supabase as supabase_db

    monkeypatch.setattr(
        supabase_db,
        "get_approval_for_original_email",
        lambda business_id, message_id: {"id": "approval-1", "status": "approved"},
    )
    monkeypatch.setattr(
        supabase_db,
        "pending_missed_response_approval_exists",
        lambda business_id, message_id: False,
    )

    called = {"create": False}

    def fake_create_approval(**kwargs):
        called["create"] = True
        return {"id": "missed-approval-1"}

    monkeypatch.setattr(supabase_db, "create_approval", fake_create_approval)

    handlers.handle_missed_response_check(
        {
            "id": "job-1",
            "payload": {
                "business_id": "business-123",
                "original_email_id": "msg-123",
                "subject": "Heat pump service",
            },
        }
    )

    assert called["create"] is False
