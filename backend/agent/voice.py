"""Owner voice calibration from recent sent mail.

The calibration stores a compact style profile only. Raw sent emails are used
for extraction and then discarded.
"""
from __future__ import annotations

import json
from typing import Any

from agent.draft import extract_json_object
from core.ai import get_ai_provider

MIN_VOICE_SAMPLE_COUNT = 3
MAX_VOICE_SAMPLE_COUNT = 50
MAX_SAMPLE_BODY_CHARS = 700


def _clean_body(value: str) -> str:
    lines = []
    for raw_line in (value or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()
        if line.startswith(">"):
            continue
        if lower.startswith("on ") and " wrote:" in lower:
            continue
        if lower.startswith(("sent from my", "confidentiality notice", "unsubscribe")):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def normalise_voice_samples(
    messages: list[dict[str, Any]],
    *,
    max_samples: int = MAX_VOICE_SAMPLE_COUNT,
) -> list[dict[str, str]]:
    """Return bounded sent-mail samples suitable for voice extraction."""
    samples: list[dict[str, str]] = []
    for message in messages:
        body = _clean_body(
            str(message.get("full_body") or message.get("body") or message.get("snippet") or "")
        )
        if len(body) < 40:
            continue
        lower_body = body.lower()
        if "do not reply" in lower_body or "no-reply" in lower_body:
            continue
        samples.append({
            "subject": str(message.get("subject") or "No subject")[:120],
            "body": body[:MAX_SAMPLE_BODY_CHARS],
        })
        if len(samples) >= max_samples:
            break
    return samples


def _confidence(source_count: int) -> str:
    if source_count >= 20:
        return "high"
    if source_count >= 8:
        return "medium"
    return "review"


def _fallback_profile(business_context: dict[str, Any], source_count: int) -> dict[str, Any]:
    tone = business_context.get("reply_tone") or business_context.get("tone") or "warm, professional, brief"
    return {
        "summary": f"Use the owner's stated tone: {tone}. Keep replies natural, concise, and direct.",
        "greeting_style": "Short, natural greeting.",
        "sign_off_style": f"Sign off as {business_context.get('business_name') or 'the business'}.",
        "typical_length": "Two to five short sentences.",
        "formality": tone,
        "directness": "Clear next step, no filler.",
        "local_phrasing": "Use New Zealand English.",
        "cta_style": "End with one practical next step or question.",
        "avoid": ["Do not invent details.", "Avoid generic corporate filler."],
        "confidence": _confidence(source_count),
    }


def _normalise_response(raw: dict[str, Any] | None, business_context: dict[str, Any], source_count: int) -> dict[str, Any]:
    fallback = _fallback_profile(business_context, source_count)
    data = raw or {}
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}

    normalised_profile = {
        **fallback,
        **{key: value for key, value in profile.items() if value not in (None, "", [])},
    }
    normalised_profile["confidence"] = str(
        data.get("confidence") or normalised_profile.get("confidence") or _confidence(source_count)
    )

    scenario = data.get("scenario") if isinstance(data.get("scenario"), dict) else {}
    classification = str(scenario.get("classification") or "new_lead")
    if classification not in {"new_lead", "booking_request", "quote_follow_up", "invoice", "reschedule"}:
        classification = "new_lead"

    return {
        "profile": normalised_profile,
        "scenario": {
            "classification": classification,
            "subject": str(scenario.get("subject") or "New enquiry")[:120],
            "body": str(scenario.get("body") or "Can you tell me more about availability and pricing?")[:500],
        },
        "example_draft": str(data.get("example_draft") or "").strip()[:1200],
        "source_count": source_count,
        "confidence": normalised_profile["confidence"],
    }


def calibrate_owner_voice(
    sent_messages: list[dict[str, Any]],
    business_context: dict[str, Any],
    *,
    business_id: str | None = None,
) -> dict[str, Any]:
    """Analyse recent sent messages and return a compact owner voice profile."""
    samples = normalise_voice_samples(sent_messages)
    source_count = len(samples)
    if source_count < MIN_VOICE_SAMPLE_COUNT:
        raise ValueError("Not enough sent emails to calibrate voice.")

    business_name = business_context.get("business_name") or "the business"
    business_type = business_context.get("business_type") or "service business"
    location = business_context.get("location") or "New Zealand"
    sample_block = "\n\n".join(
        f"Sample {index + 1}\nSubject: {sample['subject']}\nBody:\n{sample['body']}"
        for index, sample in enumerate(samples)
    )

    prompt = f"""You are calibrating the writing voice of a New Zealand business owner.

Business:
- Name: {business_name}
- Type: {business_type}
- Location: {location}

Recent sent emails from the owner:
{sample_block}

Return only valid JSON with this exact shape:
{{
  "profile": {{
    "summary": "2 sentence style summary",
    "greeting_style": "how they usually open",
    "sign_off_style": "how they usually sign off",
    "typical_length": "short description",
    "formality": "plain-language description",
    "directness": "plain-language description",
    "local_phrasing": "phrasing or spelling pattern",
    "cta_style": "how they ask for the next step",
    "avoid": ["style to avoid", "style to avoid"]
  }},
  "scenario": {{
    "classification": "new_lead | booking_request | quote_follow_up | invoice | reschedule",
    "subject": "realistic customer subject",
    "body": "realistic customer email body"
  }},
  "example_draft": "a reply in the owner's style",
  "confidence": "high | medium | review"
}}

Rules:
- Infer style only. Do not invent business facts.
- Do not include raw sent email text in the profile.
- Use New Zealand English.
- Keep example_draft under 5 sentences.
- If the sample is mixed, prefer the most common customer-facing style."""

    ai = get_ai_provider()
    response = ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=850,
        operation="voice_calibration",
        business_id=business_id,
    )
    normalised = _normalise_response(extract_json_object(response), business_context, source_count)
    if not normalised["example_draft"]:
        normalised["example_draft"] = (
            f"Hi there,\n\nThanks for getting in touch. I can help with that, but I need one more detail "
            f"before I can give you the right next step.\n\nThanks,\n{business_name}"
        )
    return normalised


def profile_to_memory_value(profile: dict[str, Any]) -> str:
    """Serialise the compact profile for memory storage."""
    return json.dumps(profile, ensure_ascii=False, separators=(",", ":"))
