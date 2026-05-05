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

import agent.voice as voice
import main
from auth.google import create_session_token

client = TestClient(main.app)


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {create_session_token('business-123', 'owner@example.com')}"}


def test_normalise_voice_samples_filters_short_and_quoted_content() -> None:
    samples = voice.normalise_voice_samples([
        {"subject": "Too short", "full_body": "Thanks"},
        {
            "subject": "Good sample",
            "full_body": "Hi Sam,\n\nThanks for getting in touch. I can come by Thursday and send the quote after that.\n\n> quoted old message",
        },
    ])

    assert len(samples) == 1
    assert samples[0]["subject"] == "Good sample"
    assert "quoted old message" not in samples[0]["body"]


def test_calibrate_owner_voice_returns_normalised_profile(monkeypatch) -> None:
    class FakeAI:
        def complete(self, **kwargs):
            return """
            {
              "profile": {
                "summary": "Short, direct, warm replies.",
                "greeting_style": "Uses Hi plus first name.",
                "sign_off_style": "Thanks plus business name.",
                "typical_length": "Two or three sentences.",
                "formality": "Professional but plain.",
                "directness": "Gets to the next step quickly.",
                "local_phrasing": "New Zealand English.",
                "cta_style": "Asks one clear question.",
                "avoid": ["Corporate filler"]
              },
              "scenario": {
                "classification": "new_lead",
                "subject": "Heat pump quote",
                "body": "Can you quote a heat pump install?"
              },
              "example_draft": "Hi Sam, thanks for getting in touch. I can help with that.",
              "confidence": "medium"
            }
            """

    monkeypatch.setattr(voice, "get_ai_provider", lambda: FakeAI())

    result = voice.calibrate_owner_voice(
        [
            {"subject": "A", "full_body": "Hi Sam, thanks for getting in touch. I can come by Thursday and quote it then."},
            {"subject": "B", "full_body": "Hi Jo, yes that works. I'll send the details through this afternoon."},
            {"subject": "C", "full_body": "Hi Lee, thanks. Please send the address and I will confirm timing."},
        ],
        {"business_name": "Olivander Electrical", "business_type": "electrical"},
        business_id="business-123",
    )

    assert result["source_count"] == 3
    assert result["profile"]["summary"] == "Short, direct, warm replies."
    assert result["scenario"]["classification"] == "new_lead"
    assert result["example_draft"].startswith("Hi Sam")


def test_voice_calibration_endpoint_stores_profile(monkeypatch) -> None:
    writes = []
    result = {
        "profile": {"summary": "Short and direct.", "confidence": "medium"},
        "scenario": {"classification": "new_lead", "subject": "Quote", "body": "Can you quote this?"},
        "example_draft": "Hi there, yes I can help.",
        "source_count": 8,
        "confidence": "medium",
    }

    monkeypatch.setattr(main, "get_valid_token", lambda business_id: "token")
    monkeypatch.setattr(main, "list_sent_messages", lambda token, max_results=50: [{"id": "msg-1"}])
    monkeypatch.setattr(main, "get_business_context", lambda business_id: {"business_name": "Olivander"})
    monkeypatch.setattr(main, "calibrate_owner_voice", lambda *args, **kwargs: result)
    def fake_set_memory_value(business_id, key, value, source="owner"):
        writes.append((business_id, key, value, source))

    monkeypatch.setattr(main, "set_memory_value", fake_set_memory_value)

    response = client.post("/api/onboarding/voice-calibration", headers=_auth_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_count"] == 8
    assert payload["example_draft"] == "Hi there, yes I can help."
    keys = {item[1] for item in writes}
    assert {"owner_voice_profile", "owner_voice_calibrated_at", "owner_voice_source_count"} <= keys
