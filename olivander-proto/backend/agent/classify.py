import json
import logging
from typing import Any

from gemini_client import get_gemini_client

logger = logging.getLogger("olivander.app")
_client = get_gemini_client()
_VALID_LABELS = {
    "booking_request",
    "invoice_query",
    "reschedule",
    "general_reply",
    "ignore",
}


def _fallback_classification(email: dict[str, Any]) -> str:
    text = " ".join(
        str(email.get(key, "")).lower() for key in ("subject", "snippet", "body")
    )

    if "invoice" in text or "payment" in text:
        return "invoice_query"

    if "reschedule" in text or "move" in text or "another time" in text:
        return "reschedule"

    if "book" in text or "availability" in text or "appointment" in text:
        return "booking_request"

    if "unsubscribe" in text or "newsletter" in text:
        return "ignore"

    return "general_reply"


def classify_email(email: dict[str, Any], business_context: dict[str, Any] | None = None) -> str:
    if _client is None:
        return _fallback_classification(email)

    prompt = f"""
You classify inbound business emails into exactly one label.

Allowed labels:
- booking_request
- invoice_query
- reschedule
- general_reply
- ignore

Business context:
{json.dumps(business_context or {}, ensure_ascii=True)}

Email:
{json.dumps(email, ensure_ascii=True)}

Respond with JSON only in the format:
{{"label":"general_reply"}}
"""

    try:
        response_text = _client.generate_text(prompt, model="gemini-2.0-flash")
        payload = json.loads(response_text)
        label = str(payload.get("label", "")).strip()

        if label in _VALID_LABELS:
            return label
    except Exception as error:
        logger.error("Gemini classify error: %s", error, exc_info=True)

    return _fallback_classification(email)
