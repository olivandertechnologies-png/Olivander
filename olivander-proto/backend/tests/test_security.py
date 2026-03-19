import os

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-client-secret")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-supabase-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-api-key")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-value-with-32-chars")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")

import main
from auth.deps import create_session_token

client = TestClient(main.app)


def test_protected_endpoint_requires_jwt() -> None:
    response = client.get("/api/memory")

    assert response.status_code == 401


def test_webhook_requires_secret() -> None:
    response = client.post("/webhook/gmail", json={"message": {}})

    assert response.status_code == 403


def test_oauth_callback_rejects_invalid_state() -> None:
    auth_response = client.get("/auth/google")

    assert auth_response.status_code == 200
    assert auth_response.cookies.get("olivander_oauth_state")

    callback_response = client.get(
        "/auth/google/callback",
        params={"state": "invalid-state", "code": "fake-code"},
        cookies={"olivander_oauth_state": auth_response.cookies.get("olivander_oauth_state")},
    )

    assert callback_response.status_code == 400
    assert callback_response.json()["detail"] == "Invalid OAuth state."


def test_connections_returns_google_state_for_valid_jwt(monkeypatch) -> None:
    monkeypatch.setattr(main, "get_valid_token", lambda business_id: "valid-token")

    response = client.get(
        "/api/connections",
        headers={"Authorization": f"Bearer {create_session_token('business-123', 'owner@example.com')}"},
    )

    assert response.status_code == 200
    assert response.json() == {"google": True}
