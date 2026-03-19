import json
import logging
from typing import Any

from gemini_client import get_gemini_client

logger = logging.getLogger("olivander.app")
_client = get_gemini_client()


def _fallback_draft(email: dict[str, Any], business_context: dict[str, Any] | None = None) -> str:
    sender_name = email.get("from_name") or email.get("senderName") or "there"
    business_name = (business_context or {}).get("business_name") or "the team"
    sign_off = (business_context or {}).get("sign_off") or f"Best,\n{business_name}"
    return (
        f"Hi {sender_name},\n\n"
        "Thanks for your note. I have reviewed the details and I am pulling together the next step now. "
        "I will keep the response clear and concise.\n\n"
        f"{sign_off}"
    )


def generate_draft_reply(
    email: dict[str, Any],
    business_context: dict[str, Any] | None = None,
) -> str:
    if _client is None:
        return _fallback_draft(email, business_context)

    prompt = f"""
You are drafting a concise business email reply.

Business context:
{json.dumps(business_context or {}, ensure_ascii=True)}

Incoming email:
{json.dumps(email, ensure_ascii=True)}

Instructions:
- Reply in plain text only.
- Be concise, warm, and practical.
- If key details are missing, acknowledge and ask for them.
- Do not invent commitments or dates.
"""

    try:
        response_text = _client.generate_text(prompt, model="gemini-2.0-flash")

        if response_text:
            return response_text
    except Exception as error:
        logger.error("Gemini draft error: %s", error, exc_info=True)

    return _fallback_draft(email, business_context)
