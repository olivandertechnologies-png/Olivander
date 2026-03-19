import logging
from typing import Any

from config import GEMINI_API_KEY

logger = logging.getLogger("olivander.app")
_MODE: str | None = None
_GENAI_MODULE: Any = None

try:
    from google import genai as _GENAI_MODULE  # type: ignore[assignment]

    _MODE = "google_genai"
except Exception:
    try:
        import google.generativeai as _GENAI_MODULE  # type: ignore[assignment]

        _MODE = "google_generativeai"
    except Exception:
        _MODE = None


class GeminiClient:
    def __init__(self, api_key: str | None):
        self.api_key = api_key

        if not api_key or _MODE is None:
            self._client = None
            return

        if _MODE == "google_genai":
            self._client = _GENAI_MODULE.Client(api_key=api_key)
            return

        _GENAI_MODULE.configure(api_key=api_key)
        self._client = _GENAI_MODULE.GenerativeModel("gemini-2.0-flash")

    def generate_text(self, prompt: str, *, model: str = "gemini-2.0-flash") -> str:
        if self._client is None:
            raise RuntimeError("Gemini client is not configured.")

        if _MODE == "google_genai":
            result = self._client.models.generate_content(model=model, contents=prompt)
            return (result.text or "").strip()

        result = self._client.generate_content(prompt)
        return (getattr(result, "text", "") or "").strip()


def get_gemini_client() -> GeminiClient | None:
    if not GEMINI_API_KEY:
        return None

    try:
        return GeminiClient(GEMINI_API_KEY)
    except Exception as error:
        logger.error("Gemini client setup error: %s", error, exc_info=True)
        return None
