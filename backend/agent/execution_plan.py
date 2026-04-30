"""Builds numbered execution plans with confidence levels for approval cards.

Every action queued for approval includes a plan showing: what will happen,
which system is affected, and confidence level (PRD §5.2):

  high   — relevant memory, clear classification, known client  → green
  medium — partial memory, first contact, ambiguous intent      → amber
  review — missing memory, high-value action, new workflow      → purple
"""

_FINANCIAL = {"invoice", "payment_confirmation"}
_HIGH_RISK = {"complaint"}


def _step(n: int, action: str, system: str, confidence: str) -> dict:
    return {"n": n, "action": action, "system": system, "confidence": confidence}


def build_execution_plan(
    classification: str,
    retrieved_context: list[dict[str, str]],
    has_xero: bool = False,
    is_known_client: bool = False,
) -> dict:
    """Return {steps: [...], confidence: str} for an email approval card."""
    steps = []
    n = 1

    ctx_keys = [c["key"] for c in retrieved_context] if retrieved_context else []
    ctx_label = ", ".join(ctx_keys[:4]) if ctx_keys else "none available"
    ctx_conf = (
        "high" if len(retrieved_context) >= 3
        else ("medium" if retrieved_context else "review")
    )

    steps.append(_step(
        n, f"Classify email as '{classification}' · generate 2-line summary",
        "Groq LLM", "high",
    ))
    n += 1

    steps.append(_step(
        n, f"Retrieve business context ({ctx_label})",
        "Business Memory", ctx_conf,
    ))
    n += 1

    if classification == "booking_request":
        steps.append(_step(n, "Check calendar availability · propose 2–3 open slots", "Google Calendar", "medium"))
        n += 1
        steps.append(_step(n, "Draft reply with available slot options", "Groq LLM", "medium"))
        n += 1

    elif classification in _FINANCIAL:
        if has_xero:
            steps.append(_step(n, "Verify invoice / payment status live from Xero", "Xero API", "review"))
            n += 1
        steps.append(_step(n, "Draft reply with correct payment details", "Groq LLM", "review"))
        n += 1

    elif classification == "complaint":
        steps.append(_step(n, "Draft acknowledgement — solution-focused, no over-apology", "Groq LLM", "review"))
        n += 1

    elif classification == "new_lead":
        steps.append(_step(n, "Draft welcome reply · confirm services · ask one qualifying question", "Groq LLM", "medium"))
        n += 1

    else:
        steps.append(_step(n, "Draft reply using retrieved context", "Groq LLM", "medium"))
        n += 1

    steps.append(_step(n, "Queue for owner approval (Tier 3 — held until approved)", "Approval Queue", "high"))

    if classification in _FINANCIAL or classification in _HIGH_RISK:
        overall = "review"
    elif is_known_client and len(retrieved_context) >= 3:
        overall = "high"
    elif len(retrieved_context) >= 2:
        overall = "medium"
    else:
        overall = "review"

    return {"steps": steps, "confidence": overall}
