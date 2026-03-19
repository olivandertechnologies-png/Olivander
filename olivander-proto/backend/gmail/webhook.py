import base64
import hmac
import json
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from rate_limit import limiter

router = APIRouter(tags=["gmail-webhook"])


def _decode_pubsub_message(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") or {}
    raw_data = message.get("data")

    if not raw_data:
        return {}

    try:
        decoded = base64.b64decode(raw_data)
        return json.loads(decoded.decode("utf-8"))
    except Exception:
        return {}


@router.post("/webhook/gmail")
@limiter.limit("100/minute")
async def gmail_push_webhook(request: Request, token: str = Query(default="")) -> dict[str, Any]:
    # Configure the Pub/Sub push subscription URL as /webhook/gmail?token=WEBHOOK_SECRET
    expected = os.getenv("WEBHOOK_SECRET")

    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    payload = await request.json()
    decoded = _decode_pubsub_message(payload)

    return {
        "received": True,
        "message_id": (payload.get("message") or {}).get("messageId"),
        "subscription": payload.get("subscription"),
        "decoded": decoded,
    }
