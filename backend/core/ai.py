"""AI provider abstraction layer.

All LLM calls in the codebase go through AIProvider.complete(). This centralises
token tracking, cost logging, retry logic, and model configuration so the provider
can be swapped without touching individual features.

Usage:
    from core.ai import get_ai_provider

    ai = get_ai_provider()
    text = ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=20,
        operation="classify_email",
        business_id=business_id,
    )
"""

import logging
import os
import time
from typing import Any

from groq import Groq

logger = logging.getLogger("olivander")

# Active model — change here to swap for all features at once.
MODEL = "llama-3.3-70b-versatile"

# Groq pricing for llama-3.3-70b-versatile (USD per 1M tokens).
# Update when Groq pricing changes.
_COST_PER_1M_INPUT = 0.59
_COST_PER_1M_OUTPUT = 0.79

_provider: "AIProvider | None" = None


def get_ai_provider() -> "AIProvider":
    """Return the module-level AIProvider singleton."""
    global _provider
    if _provider is None:
        _provider = AIProvider()
    return _provider


class AIProvider:
    """Central abstraction for all LLM calls.

    Wraps the Groq client with:
    - Single model configuration point
    - Per-call token counting and cost estimation
    - Non-blocking usage logging to Supabase
    - One automatic retry on transient failure
    """

    def __init__(self) -> None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not set")
        self._client = Groq(api_key=api_key)

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 500,
        operation: str = "unknown",
        business_id: str | None = None,
    ) -> str:
        """Call the LLM and return the response text.

        Retries once on transient failure with a 500ms back-off.
        Logs token usage to ai_usage table (never raises on logging failure).

        Args:
            messages:     Chat messages in OpenAI format.
            temperature:  Sampling temperature.
            max_tokens:   Maximum tokens in the response.
            operation:    Label for cost tracking (e.g. "classify_email").
            business_id:  Optional — if provided, usage is attributed to this tenant.

        Returns:
            Stripped response text from the model.

        Raises:
            Exception: Re-raises the last exception if both attempts fail.
        """
        last_error: Exception | None = None

        for attempt in range(2):
            try:
                response = self._client.chat.completions.create(
                    model=MODEL,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                content = (response.choices[0].message.content or "").strip()

                usage = response.usage
                if usage:
                    self._log_usage(
                        business_id=business_id,
                        operation=operation,
                        input_tokens=usage.prompt_tokens,
                        output_tokens=usage.completion_tokens,
                    )

                return content

            except Exception as error:
                last_error = error
                if attempt == 0:
                    logger.warning(
                        "AIProvider attempt 1 failed for operation=%s: %s — retrying",
                        operation,
                        error,
                    )
                    time.sleep(0.5)

        raise last_error  # type: ignore[misc]

    def extract_invoice_details(
        self,
        description: str,
        business_context: dict[str, Any],
        business_id: str | None = None,
    ) -> dict[str, Any]:
        """Extract structured invoice details from a natural language instruction.

        Returns a dict with keys:
            contact_name, contact_email, line_items (list of
            {description, quantity, unit_amount_excl_gst}),
            gst_registered, due_date_days, notes.

        Raises ValueError if the AI returns unparseable JSON.
        """
        gst_registered = str(business_context.get("gst_registered", "")).lower() in (
            "true", "yes", "1"
        )
        business_name = business_context.get("business_name") or "this business"

        prompt = f"""You are extracting invoice details from a natural language instruction for {business_name}.
GST registered: {"yes — 15% NZ GST applies" if gst_registered else "no"}
Currency: NZD

Invoice instruction:
{description}

Return ONLY valid JSON (no markdown fences):
{{
  "contact_name": "string",
  "contact_email": "string or null",
  "line_items": [
    {{
      "description": "string",
      "quantity": 1.0,
      "unit_amount_excl_gst": 0.0
    }}
  ],
  "gst_registered": true,
  "due_date_days": 30,
  "notes": "string or null"
}}

Rules:
- unit_amount_excl_gst is the price BEFORE GST (15%)
- If amounts include GST (e.g. "$150 incl. GST"): divide by 1.15 and round to 2 decimal places
- If amounts exclude GST or GST status is unclear: use the number as stated
- due_date_days: number of days from today (default 30 if not specified)
- contact_email: extract if present in the instruction, otherwise null
- gst_registered: {str(gst_registered).lower()}""".strip()

        result_text = self.complete(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=400,
            operation="extract_invoice",
            business_id=business_id,
        )

        from agent.draft import extract_json_object  # lazy import
        data = extract_json_object(result_text)
        if not data:
            raise ValueError(f"AI returned invalid JSON for invoice extraction: {result_text[:200]}")
        return data

    def _log_usage(
        self,
        business_id: str | None,
        operation: str,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """Log token usage to Supabase. Never raises — logged failures are warnings only."""
        cost = (
            (input_tokens / 1_000_000) * _COST_PER_1M_INPUT
            + (output_tokens / 1_000_000) * _COST_PER_1M_OUTPUT
        )
        try:
            from db.supabase import log_ai_usage  # lazy import to avoid circular deps
            log_ai_usage(
                business_id=business_id,
                model=MODEL,
                operation=operation,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=round(cost, 8),
            )
        except Exception as error:
            logger.warning("Failed to log AI usage for operation=%s: %s", operation, error)
