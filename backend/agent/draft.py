import json
import logging
from typing import Any

from agent.classify import classify_email
from groq_client import get_groq_client

logger = logging.getLogger("olivander")


_CLASSIFICATION_INSTRUCTIONS: dict[str, str] = {
    "booking_request": """
This is a BOOKING REQUEST. The customer wants to schedule a session or service.
Your job is to gather the specific information needed to confirm it.
Only ask about details NOT already provided in their email:
- What dates or timeframe works for them?
- How many people / group size?
- What type of session or service are they after?
- Any special requirements?
Do NOT say "we will check availability and get back to you".
Ask the questions directly so you can actually book them in.
Keep it warm and brief — a short greeting, then your questions.
""",
    "invoice_query": """
This is an INVOICE or PAYMENT QUESTION.
If the answer is in the business context, give it directly.
If not, tell them exactly what you need from them to resolve it.
Do not be vague about timelines. One clear paragraph maximum.
""",
    "complaint": """
This is a COMPLAINT. Acknowledge it directly — do not dismiss or deflect.
State clearly what you will do about it and when.
Do not over-apologise. Be concise and solution-focused.
""",
    "general_reply": """
This is a simple acknowledgement or general message.
Reply in one or two sentences only.
Do not add pricing, next steps, or anything not asked.
""",
    "new_lead": """
This is a NEW ENQUIRY from a potential customer.
Welcome them briefly, confirm what you offer, and ask one clear question
to understand what they need. Do not write a marketing pitch.
""",
}

_DEFAULT_INSTRUCTION = (
    "Reply helpfully and directly. "
    "Ask a clarifying question if key information is missing. "
    "Keep it brief — no more than 3 sentences unless asking multiple questions."
)


def draft_reply(
    subject: str,
    body: str,
    sender: str,
    classification: str,
    business_context: dict,
) -> str:
    business_name = business_context.get("business_name") or "Olivander"
    business_type = business_context.get("business_type") or "service business"
    tone = business_context.get("tone") or "warm, professional, brief"
    pricing_range = business_context.get("pricing_range") or ""
    payment_terms = business_context.get("payment_terms") or ""
    services = business_context.get("services") or ""
    nz_greeting = bool(business_context.get("nz_greeting"))
    greeting_instruction = (
        'You may use "Kia ora" naturally if it fits the message.'
        if nz_greeting
        else 'Do not use "Kia ora" unless the sender used it first. Open naturally.'
    )
    classification_guidance = _CLASSIFICATION_INSTRUCTIONS.get(
        classification, _DEFAULT_INSTRUCTION
    )

    context_lines = []
    if services:
        context_lines.append(f"- Services offered: {services}")
    if pricing_range:
        context_lines.append(f"- Pricing: {pricing_range}")
    if payment_terms:
        context_lines.append(f"- Payment terms: {payment_terms}")
    business_context_block = "\n".join(context_lines) if context_lines else "- No additional context provided"

    prompt = f"""
You are drafting a reply on behalf of {business_name}, a {business_type} in New Zealand.

Tone: {tone}. Human, warm, and direct. Use New Zealand English.
Never start with "I hope this email finds you well" or similar filler.
{greeting_instruction}
Sign off as: {business_name}

Email you are replying to:
From: {sender}
Subject: {subject}
Body: {body}

Classification: {classification}

What to do:
{classification_guidance.strip()}

Business context:
{business_context_block}

Write the reply body only. No subject line. No headers.
Maximum 5 sentences unless you are asking multiple clarifying questions.
Do not invent details not present in the email or business context.
""".strip()

    client = get_groq_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=400,
    )
    return (response.choices[0].message.content or "").strip()


def normalise_task_title(value: str) -> str:
    trimmed = " ".join((value or "").strip().split())

    if not trimmed:
        return "New task"

    title = trimmed[0].upper() + trimmed[1:]
    return f"{title[:41]}..." if len(title) > 44 else title


def create_plan_step(title: str, detail: str, tone: str = "queued") -> dict[str, str]:
    return {
        "title": title.strip(),
        "detail": detail.strip(),
        "tone": tone if tone in {"next", "queued", "review"} else "queued",
    }


def build_fallback_agent_plan(
    request: str,
    source_email: dict[str, Any] | None = None,
    review_feedback: str | None = None,
) -> dict[str, Any]:
    lower_request = request.lower()
    draft_preview = None
    steps = [
        create_plan_step(
            "Confirm the outcome",
            "Pull the objective, delivery format, and any dates or names from the request.",
            "next",
        ),
        create_plan_step(
            "Gather the context",
            "Collect the information, prior threads, and business details needed to complete it.",
        ),
        create_plan_step(
            "Draft the work",
            "Prepare the next output so the task can move forward without losing momentum.",
        ),
        create_plan_step(
            "Check for approval points",
            "Flag anything sensitive, client-facing, or financial before it goes out.",
            "review",
        ),
    ]

    if source_email or any(
        keyword in lower_request
        for keyword in ["email", "reply", "follow up", "follow-up", "meeting", "quote", "invoice"]
    ):
        draft_preview = {
            "label": "Writing draft",
            "text": (
                "Hi [name],\n\n"
                "Thanks for your note. I am pulling together the next step now and will keep the key "
                "details clear and concise.\n\n"
                "Best,"
            ),
        }

    if any(keyword in lower_request for keyword in ["meeting", "calendar", "invite", "book"]):
        steps = [
            create_plan_step(
                "Confirm the participants and timing",
                "Pull the names, preferred windows, and duration from the request.",
                "next",
            ),
            create_plan_step(
                "Check the schedule",
                "Compare the likely windows and remove any obvious clashes.",
            ),
            create_plan_step(
                "Prepare the booking details",
                "Draft the invite details, agenda, and any note that should accompany it.",
            ),
            create_plan_step(
                "Release or hold for review",
                "Send it forward or pause if the wording or timing needs approval.",
                "review",
            ),
        ]
    elif any(keyword in lower_request for keyword in ["invoice", "payment", "quote", "pricing"]):
        steps = [
            create_plan_step(
                "Verify the commercial details",
                "Check the figures, dates, and any context that affects the response.",
                "next",
            ),
            create_plan_step(
                "Pull the supporting record",
                "Gather the invoice, quote, or payment history behind the request.",
            ),
            create_plan_step(
                "Draft the reply",
                "Prepare the follow-up with the correct details and tone.",
            ),
            create_plan_step(
                "Check the final risk",
                "Pause if it changes pricing, fees, or a client-facing commitment.",
                "review",
            ),
        ]
    elif source_email or any(
        keyword in lower_request for keyword in ["email", "reply", "follow up", "follow-up"]
    ):
        steps = [
            create_plan_step(
                "Review the thread and objective",
                "Identify what needs to be said and the outcome the message should drive.",
                "next",
            ),
            create_plan_step(
                "Draft the message",
                "Write the reply in the right business tone with the key details in place.",
            ),
            create_plan_step(
                "Check facts and phrasing",
                "Make sure the names, commitments, and wording are correct.",
            ),
            create_plan_step(
                "Queue for send or approval",
                "Move it forward or hold it if the draft needs a final check.",
                "review",
            ),
        ]
        draft_preview = {
            "label": "Writing email",
            "text": (
                "Hi [recipient],\n\n"
                "Thanks for your message. I am drafting the reply now and making sure it covers "
                "the main points clearly.\n\n"
                "Best,"
            ),
        }
    elif any(keyword in lower_request for keyword in ["summary", "summaris", "inbox"]):
        steps = [
            create_plan_step(
                "Collect the source material",
                "Gather the messages, notes, or threads that belong in the summary.",
                "next",
            ),
            create_plan_step(
                "Group the main themes",
                "Pull out actions, blockers, deadlines, and notable context.",
            ),
            create_plan_step(
                "Draft the summary",
                "Write the concise update with the right order and recommendations.",
            ),
            create_plan_step(
                "Flag anything needing follow-up",
                "Surface missing information or approval points before it is shared.",
                "review",
            ),
        ]
        draft_preview = {
            "label": "Drafting summary",
            "text": "Summary\n\n- Key update\n- Follow-up needed\n- Important deadline",
        }

    if review_feedback:
        steps[-1] = create_plan_step(
            "Apply the review feedback",
            "Update the draft so it reflects the requested changes before it is rechecked.",
            "review",
        )

    return {
        "name": normalise_task_title(request),
        "steps": steps,
        "draftPreview": draft_preview,
        "planSummary": None,
        "clarifyingQuestion": None,
    }


def request_needs_draft_preview(
    request: str,
    source_email: dict[str, Any] | None = None,
) -> bool:
    lower_request = (request or "").lower()
    return bool(source_email) or any(
        keyword in lower_request
        for keyword in [
            "email",
            "reply",
            "follow up",
            "follow-up",
            "summary",
            "summaris",
            "quote",
            "proposal",
            "meeting note",
            "meeting-notes",
        ]
    )


def extract_json_object(text: str) -> dict[str, Any] | None:
    payload = (text or "").strip()

    if not payload:
        return None

    if payload.startswith("```"):
        payload = payload.removeprefix("```json").removeprefix("```JSON").removeprefix("```")
        if payload.endswith("```"):
            payload = payload[:-3]
        payload = payload.strip()

    try:
        parsed = json.loads(payload)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = payload.find("{")
        end = payload.rfind("}")

        if start == -1 or end == -1 or end <= start:
            return None

        try:
            parsed = json.loads(payload[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def sanitise_agent_plan(
    raw_plan: dict[str, Any] | None,
    request: str,
    source_email: dict[str, Any] | None = None,
    review_feedback: str | None = None,
) -> dict[str, Any]:
    if not isinstance(raw_plan, dict):
        raise ValueError("Groq returned an empty task plan.")

    steps = []
    for item in raw_plan.get("steps", []):
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        detail = str(item.get("detail", "")).strip()
        tone = str(item.get("tone", "queued")).strip().lower()

        if not title or not detail:
            continue

        steps.append(create_plan_step(title, detail, tone))

    draft_preview = raw_plan.get("draftPreview")
    if isinstance(draft_preview, dict):
        label = str(draft_preview.get("label", "")).strip()
        text = str(draft_preview.get("text", "")).strip()
        draft_preview = {"label": label, "text": text} if label and text else None
    else:
        draft_preview = None

    plan_summary = str(raw_plan.get("planSummary", "")).strip() or None
    clarifying_question = str(raw_plan.get("clarifyingQuestion", "")).strip() or None
    name = normalise_task_title(str(raw_plan.get("name", "")).strip() or request)

    if not steps:
        raise ValueError("Groq returned a task plan without usable steps.")

    if request_needs_draft_preview(request, source_email) and draft_preview is None:
        raise ValueError("Groq returned a writing task without a draft preview.")

    if review_feedback:
        clarifying_question = None

    return {
        "name": name,
        "steps": steps[:5],
        "draftPreview": draft_preview,
        "planSummary": plan_summary,
        "clarifyingQuestion": clarifying_question,
    }


def generate_agent_plan(
    request: str,
    business_context: dict[str, Any] | None = None,
    source_email: dict[str, Any] | None = None,
    review_feedback: str | None = None,
) -> dict[str, Any]:
    context = business_context or {}
    business_name = context.get("business_name") or "this business"
    business_type = context.get("business_type") or "service business"
    contact_name = context.get("contact_name") or ""
    location = context.get("location") or "New Zealand"
    services = context.get("services") or ""
    tone = context.get("tone") or "warm, professional, brief"
    pricing_range = context.get("pricing_range") or "Not provided"
    payment_terms = context.get("payment_terms") or "Not provided"

    source_email_context = ""
    if source_email:
        email_classification = classify_email(
            str(source_email.get("subject", "")),
            str(source_email.get("body", "")),
            str(source_email.get("senderEmail", "")),
        )
        source_email_context = f"""

Source email:
- Sender: {source_email.get('senderName', '')} <{source_email.get('senderEmail', '')}>
- Subject: {source_email.get('subject', '')}
- Body: {source_email.get('body', '')}
- Classification: {email_classification}"""

    review_feedback_context = ""
    if review_feedback:
        review_feedback_context = f"""

Review feedback to apply:
{review_feedback}"""

    prompt = f"""You are Olivander, an AI operations assistant for a New Zealand business.

Business context:
- Business name: {business_name}
- Business type: {business_type}
- Contact name: {contact_name}
- Location: {location}
- Services: {services}
- Tone: {tone}
- Pricing: {pricing_range}
- Payment terms: {payment_terms}

Create a concise execution plan for this request:
{request}{source_email_context}{review_feedback_context}

Return only valid JSON with this exact shape:
{{
  "name": "short task title",
  "steps": [
    {{"title": "string", "detail": "string", "tone": "next|queued|review"}}
  ],
  "draftPreview": {{"label": "string", "text": "string"}} or null,
  "planSummary": "optional short summary" or null,
  "clarifyingQuestion": "optional question if essential" or null
}}

Rules:
- 3 to 5 steps.
- Make the task title short, natural, and action-oriented.
- Keep each step specific and operational.
- Use "review" only when something truly needs checking before release.
- Include a draftPreview when the task needs written output like an email, summary, quote, meeting note, or reply.
- If review feedback is provided, incorporate it into the steps and the draftPreview.
- Do not wrap the JSON in markdown fences."""

    try:
        client = get_groq_client()
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=900,
        )
        response_text = (response.choices[0].message.content or "").strip()
        raw_plan = extract_json_object(response_text)
        if raw_plan is None:
            raise ValueError("Groq returned invalid JSON for the task plan.")
        return sanitise_agent_plan(raw_plan, request, source_email, review_feedback)
    except Exception as error:
        logger.error("Groq task planning failed: %s", error, exc_info=True)
        return build_fallback_agent_plan(request, source_email, review_feedback)
