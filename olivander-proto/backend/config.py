import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("olivander.app")
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
BACKEND_ENV_PATH = BACKEND_DIR / ".env"
SECRETS_PATH = PROJECT_DIR / ".secrets" / "credentials.json"

load_dotenv(BACKEND_ENV_PATH)


def load_secrets() -> dict[str, str]:
    if not SECRETS_PATH.exists():
        return {}

    try:
        data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
        return {str(key): str(value) for key, value in data.items()}
    except Exception as error:
        logger.warning("Could not read secrets file %s: %s", SECRETS_PATH, error)
        return {}


SECRETS = load_secrets()


def get_secret(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = os.environ.get(name) or SECRETS.get(name) or default

    if required and not value:
        raise RuntimeError(f"Missing required secret: {name}")

    return value


FRONTEND_ORIGIN = get_secret("FRONTEND_ORIGIN", "http://localhost:5173") or "http://localhost:5173"
GOOGLE_CLIENT_ID = get_secret("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = get_secret("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = get_secret(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:8000/auth/google/callback",
) or "http://localhost:8000/auth/google/callback"
SUPABASE_URL = get_secret("SUPABASE_URL")
SUPABASE_KEY = get_secret("SUPABASE_KEY")
GEMINI_API_KEY = get_secret("GEMINI_API_KEY")
JWT_SECRET = get_secret("JWT_SECRET")
ENCRYPTION_KEY = get_secret("ENCRYPTION_KEY")
WEBHOOK_SECRET = get_secret("WEBHOOK_SECRET")

GOOGLE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.readonly",
]
