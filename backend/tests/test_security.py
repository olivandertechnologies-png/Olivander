import os

from cryptography.fernet import Fernet
from fastapi import HTTPException
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

import auth.google as google_auth
import main
from auth.google import create_session_token

client = TestClient(main.app)


def test_protected_endpoint_requires_jwt() -> None:
    response = client.get("/api/memory")

    assert response.status_code == 401


def test_webhook_requires_secret() -> None:
    response = client.post("/webhook/gmail", json={"message": {}})

    assert response.status_code == 403


def test_oauth_callback_rejects_invalid_state(monkeypatch) -> None:
    monkeypatch.setattr(google_auth, "store_oauth_state", lambda state, code_verifier: None)

    def raise_invalid_state(state: str) -> None:
        raise HTTPException(status_code=400, detail="Invalid OAuth state.")

    monkeypatch.setattr(google_auth, "consume_oauth_state", raise_invalid_state)

    auth_response = client.get("/auth/google")

    assert auth_response.status_code == 200
    assert auth_response.json()["url"]

    callback_response = client.get(
        "/auth/google/callback",
        params={"state": "invalid-state", "code": "fake-code"},
        cookies={"olivander_oauth_state": auth_response.cookies.get("olivander_oauth_state")},
    )

    assert callback_response.status_code == 400
    assert callback_response.json()["detail"] == "Invalid OAuth state."


def test_auth_google_sets_origin_cookie(monkeypatch) -> None:
    monkeypatch.setattr(google_auth, "store_oauth_state", lambda state, code_verifier: None)

    response = client.get("/auth/google", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    assert response.cookies.get(google_auth.OAUTH_ORIGIN_COOKIE, "").strip('"') == "http://localhost:5173"


def test_oauth_callback_posts_back_to_origin_cookie(monkeypatch) -> None:
    class FakeCredentials:
        token = "access-token"
        refresh_token = "refresh-token"
        expiry = None

    class FakeFlow:
        credentials = FakeCredentials()

        def fetch_token(self, authorization_response: str, code_verifier: str | None = None) -> None:
            return None

    monkeypatch.setattr(google_auth, "consume_oauth_state", lambda state: None)
    monkeypatch.setattr(google_auth, "PUBSUB_TOPIC", None)
    monkeypatch.setattr(google_auth, "create_google_flow", lambda state=None: FakeFlow())
    monkeypatch.setattr(
        google_auth,
        "fetch_google_userinfo",
        lambda access_token: {
            "email": "owner@example.com",
            "name": "Test Business",
            "given_name": "Ollie",
        },
    )
    monkeypatch.setattr(
        google_auth,
        "upsert_business_tokens",
        lambda **kwargs: {
            "id": "business-123",
            "contact_name": "Ollie",
        },
    )

    response = client.get(
        "/auth/google/callback",
        params={"state": "valid-state", "code": "fake-code"},
        cookies={google_auth.OAUTH_ORIGIN_COOKIE: "http://localhost:5173"},
    )

    assert response.status_code == 200
    assert 'const targets = ["http://localhost:5173"' in response.text
    assert google_auth.OAUTH_ORIGIN_COOKIE in response.headers.get("set-cookie", "")


def test_oauth_callback_registers_gmail_watch_when_topic_configured(monkeypatch) -> None:
    calls = {}

    class FakeCredentials:
        token = "access-token"
        refresh_token = "refresh-token"
        expiry = None

    class FakeFlow:
        credentials = FakeCredentials()

        def fetch_token(self, authorization_response: str, code_verifier: str | None = None) -> None:
            calls["code_verifier"] = code_verifier

    monkeypatch.setattr(google_auth, "consume_oauth_state", lambda state: "pkce-verifier")
    monkeypatch.setattr(google_auth, "PUBSUB_TOPIC", "projects/test/topics/gmail-watch")
    monkeypatch.setattr(google_auth, "create_google_flow", lambda state=None: FakeFlow())
    monkeypatch.setattr(
        google_auth,
        "fetch_google_userinfo",
        lambda access_token: {
            "email": "owner@example.com",
            "name": "Test Business",
            "given_name": "Ollie",
        },
    )
    monkeypatch.setattr(
        google_auth,
        "upsert_business_tokens",
        lambda **kwargs: {
            "id": "business-123",
            "contact_name": "Ollie",
        },
    )
    monkeypatch.setattr(
        google_auth,
        "setup_gmail_watch",
        lambda access_token, topic: calls.update({"access_token": access_token, "topic": topic}),
    )

    import jobs.queue as job_queue

    monkeypatch.setattr(
        job_queue,
        "enqueue_job",
        lambda **kwargs: calls.update({"job": kwargs}),
    )

    response = client.get(
        "/auth/google/callback",
        params={"state": "valid-state", "code": "fake-code"},
    )

    assert response.status_code == 200
    assert calls["code_verifier"] == "pkce-verifier"
    assert calls["access_token"] == "access-token"
    assert calls["topic"] == "projects/test/topics/gmail-watch"
    assert calls["job"]["job_type"] == "renew_gmail_watch"
    assert calls["job"]["business_id"] == "business-123"


def test_connections_returns_google_state_for_valid_jwt(monkeypatch) -> None:
    monkeypatch.setattr(main, "get_valid_token", lambda business_id: "valid-token")
    monkeypatch.setattr(
        main,
        "get_business_by_id",
        lambda business_id: {
            "business_name": "Test Business",
            "contact_name": "Ollie",
            "email": "owner@example.com",
        },
    )

    response = client.get(
        "/api/connections",
        headers={"Authorization": f"Bearer {create_session_token('business-123', 'owner@example.com')}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "google": True,
        "xero": False,
        "contact_name": "Ollie",
        "business_name": "Test Business",
        "email": "owner@example.com",
        "onboarded": True,
    }
