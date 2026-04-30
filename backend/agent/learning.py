"""Edit pattern learning — extracts preferences from owner draft edits.

Flow:
  1. Owner edits an AI draft before approving
  2. extract_edit_pattern() classifies what changed (tone, length, content, etc.)
  3. apply_edit_to_memory() stores the pattern and increments the edit counter
  4. After 3 consistent edits of the same type for a classification, the
     learned instruction is promoted to a dedicated memory key
  5. rag.retrieve_context_chunks() returns that key on the next similar email
  6. draft.draft_reply() injects it as a tone override in the prompt

Nothing blocks the approve response — callers run this in a thread.
"""

import json
import logging
from difflib import SequenceMatcher
from typing import Any

from core.ai import get_ai_provider
from db.supabase import get_memory_profile, set_memory_value

logger = logging.getLogger("olivander")

_MIN_CHANGE_RATIO = 0.08  # skip if fewer than 8% of characters changed


def _change_ratio(a: str, b: str) -> float:
    """Edit distance ratio between a and b (handles insertions and deletions correctly)."""
    a, b = (a or "").strip(), (b or "").strip()
    if not a and not b:
        return 0.0
    return 1.0 - SequenceMatcher(None, a, b).ratio()


def extract_edit_pattern(
    original: str,
    edited: str,
    classification: str,
    business_id: str | None = None,
) -> dict[str, Any] | None:
    """Compare original vs edited draft and classify what the owner changed.

    Returns a pattern dict, or None if the edit is trivial.
    """
    if not original or not edited or original.strip() == edited.strip():
        return None

    if _change_ratio(original, edited) < _MIN_CHANGE_RATIO:
        return None

    prompt = f"""You are analysing how a business owner edited an AI-drafted email reply.

Original AI draft:
{original[:800]}

Owner's edited version:
{edited[:800]}

Email classification: {classification}

Return a JSON object only (no markdown fences):
{{
  "change_type": "tone" | "length" | "content" | "style" | "factual" | "multiple",
  "direction": "more_formal" | "less_formal" | "shorter" | "longer" | "corrected" | "personalised" | "other",
  "summary": "one sentence describing what changed and why it matters",
  "tone_instruction": "a brief instruction to apply to future drafts of this type, e.g. 'Always sign off with first name only. Keep replies under 3 sentences.'"
}}

Rules:
- tone_instruction must be actionable and specific, max 30 words
- summary must be max 15 words
- If the only change is fixing a typo or swapping one word, return: null

Return null or a valid JSON object. Nothing else."""

    try:
        ai = get_ai_provider()
        text = ai.complete(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=220,
            operation="extract_edit_pattern",
            business_id=business_id,
        )
        text = (text or "").strip()

        if not text or text.lower() == "null":
            return None

        if text.startswith("```"):
            first_line_end = text.find("\n")
            text = text[first_line_end + 1:] if first_line_end != -1 else text[3:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3]
            text = text.strip()

        data = json.loads(text)
        if not isinstance(data, dict):
            return None

        tone_instruction = str(data.get("tone_instruction") or "").strip()
        if not tone_instruction:
            return None

        return {
            "classification": classification,
            "change_type": str(data.get("change_type") or "other"),
            "direction": str(data.get("direction") or "other"),
            "summary": str(data.get("summary") or "")[:100],
            "tone_instruction": tone_instruction[:200],
        }

    except Exception as err:
        logger.warning("extract_edit_pattern failed: %s", err)
        return None


def apply_edit_to_memory(business_id: str, pattern: dict[str, Any]) -> None:
    """Persist an edit pattern and promote to a learned tone key if consistent.

    Stores patterns under edit_patterns_{classification} (JSON array, last 10).
    After 3+ patterns share the same change_type + direction for a classification,
    the most recent tone_instruction is written to learned_tone_{classification}
    so RAG includes it in future drafts.
    """
    classification = pattern.get("classification") or "email_reply"
    tone_instruction = pattern.get("tone_instruction", "").strip()
    if not tone_instruction:
        return

    memory = get_memory_profile(business_id)

    # Increment edit counter
    edit_count = int(memory.get("reply_tone_edits") or "0") + 1
    set_memory_value(business_id, "reply_tone_edits", str(edit_count), source="system")

    # Append to the rolling pattern log for this classification
    patterns_key = f"edit_patterns_{classification}"
    try:
        existing: list = json.loads(memory.get(patterns_key) or "[]")
        if not isinstance(existing, list):
            existing = []
    except (json.JSONDecodeError, ValueError):
        existing = []

    existing.append({
        "change_type": pattern.get("change_type"),
        "direction": pattern.get("direction"),
        "summary": pattern.get("summary"),
        "tone_instruction": tone_instruction,
    })
    existing = existing[-10:]
    set_memory_value(business_id, patterns_key, json.dumps(existing), source="system")

    # Promote to a dedicated learned tone key after 3 consistent edits of the same type
    same = [
        p for p in existing
        if p.get("change_type") == pattern.get("change_type")
        and p.get("direction") == pattern.get("direction")
    ]
    if len(same) >= 3:
        learned_key = f"learned_tone_{classification}"
        current = memory.get(learned_key, "")
        if current != tone_instruction:
            set_memory_value(business_id, learned_key, tone_instruction, source="learned")
            logger.info(
                "Learned tone updated for %s [%s]: %s",
                business_id, classification, tone_instruction,
            )


def maybe_learn_from_edit(
    business_id: str,
    original: str,
    edited: str,
    classification: str,
) -> None:
    """Top-level entry point — safe to call from a background thread."""
    if not original or not edited or original.strip() == edited.strip():
        return
    try:
        pattern = extract_edit_pattern(original, edited, classification, business_id)
        if pattern:
            apply_edit_to_memory(business_id, pattern)
    except Exception as err:
        logger.warning("maybe_learn_from_edit failed for %s: %s", business_id, err)
