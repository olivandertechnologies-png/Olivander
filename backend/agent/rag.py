"""Classification-aware context retrieval from the business memory store.

Returns structured chunks (key, value, source) for the most relevant memory
items given an email classification. Structured to be replaced by pgvector
cosine-similarity retrieval — the caller interface is identical.
"""

from db.supabase import get_memory_profile

_PRIORITY_KEYS: dict[str, list[str]] = {
    "booking_request": [
        "learned_tone_booking_request",  # owner-edited preferences, highest priority
        "services",
        "business_hours_start",
        "business_hours_end",
        "booking_buffer_minutes",
        "reschedule_policy",
        "no_show_handling",
        "pricing_range",
    ],
    "invoice": [
        "learned_tone_invoice",
        "pricing_range",
        "payment_terms",
        "gst_registered",
        "services",
    ],
    "payment_confirmation": [
        "learned_tone_payment_confirmation",
        "payment_terms",
        "pricing_range",
    ],
    "new_lead": [
        "learned_tone_new_lead",
        "services",
        "pricing_range",
        "reply_tone",
        "business_type",
        "location",
    ],
    "complaint": [
        "learned_tone_complaint",
        "reply_tone",
        "no_show_handling",
        "reschedule_policy",
    ],
    "existing_client": [
        "learned_tone_existing_client",
        "services",
        "reply_tone",
        "payment_terms",
        "pricing_range",
    ],
    "fyi": [],
    "spam": [],
}

_BASE_KEYS = ["business_name", "business_type", "location"]


def retrieve_context_chunks(
    business_id: str,
    classification: str,
    max_chunks: int = 5,
) -> list[dict[str, str]]:
    """Return relevant memory items for this email classification.

    Each chunk: {"key": str, "value": str, "source": "memory"}.

    Learned tone instructions (learned_tone_* keys) are fetched first and
    prepended outside the max_chunks cap — they must never displace regular
    context items since draft.py strips and promotes them separately.
    """
    memory = get_memory_profile(business_id)
    priority = _PRIORITY_KEYS.get(classification, [])

    # Collect learned tone keys first (not subject to the regular cap)
    learned: list[dict[str, str]] = []
    regular_keys: list[str] = []
    for key in priority:
        if key.startswith("learned_tone_"):
            value = (memory.get(key) or "").strip()
            if value:
                learned.append({"key": key, "value": value, "source": "memory"})
        else:
            regular_keys.append(key)

    # Collect regular context keys up to max_chunks
    ordered = list(dict.fromkeys(_BASE_KEYS + regular_keys))
    chunks: list[dict[str, str]] = []
    for key in ordered:
        value = (memory.get(key) or "").strip()
        if value:
            chunks.append({"key": key, "value": value, "source": "memory"})
        if len(chunks) >= max_chunks:
            break

    return learned + chunks
