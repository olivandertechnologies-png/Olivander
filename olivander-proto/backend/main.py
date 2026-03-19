import datetime
import json
import logging
import os
from logging.handlers import RotatingFileHandler
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from agent.classify import classify_email
from agent.draft import generate_draft_reply
from auth.deps import decode_session_token, get_current_business
from auth.google import router as google_auth_router
from auth.tokens import clear_business_tokens, get_business_by_id, get_valid_token
from db.supabase import verify_supabase_connection
from gemini_client import get_gemini_client
from gmail.client import get_message as gmail_get_message
from gmail.client import list_recent_messages, send_message
from gmail.webhook import router as gmail_webhook_router
from memory import get_profile, set_value
from rate_limit import limiter

os.makedirs("logs", exist_ok=True)
handler = RotatingFileHandler("logs/app.log", maxBytes=5_000_000, backupCount=3)
logging.basicConfig(handlers=[handler, logging.StreamHandler()], level=logging.INFO)
logger = logging.getLogger("olivander")

REQUIRED = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "GEMINI_API_KEY",
    "JWT_SECRET",
    "ENCRYPTION_KEY",
    "WEBHOOK_SECRET",
]
for v in REQUIRED:
    if not os.getenv(v):
        raise RuntimeError(f"Missing required env var: {v}")

client = get_gemini_client()

app = FastAPI(title="Olivander Proto Backend")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(google_auth_router)
app.include_router(gmail_webhook_router)


@app.on_event("startup")
async def startup_checks() -> None:
    verify_supabase_connection()


@app.exception_handler(HTTPException)
async def passthrough_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return await http_exception_handler(request, exc)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"Unhandled error on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again."},
    )


class EmailActionRequest(BaseModel):
    action: Literal["send", "optimise"]
    reply: str


class MemoryValueRequest(BaseModel):
    key: str
    value: str


class AgentPlanRequest(BaseModel):
    request: str
    source_email: dict[str, Any] | None = None
    review_feedback: str | None = None


def normalise_task_title(value: str) -> str:
    trimmed = " ".join((value or "").strip().split())

    if not trimmed:
        return "New task"

    title = trimmed[0].upper() + trimmed[1:]
    return f"{title[:41]}..." if len(title) > 44 else title


def create_plan_step(title: str, detail: str, tone: str = "queued") -> dict:
    return {
        "title": title.strip(),
        "detail": detail.strip(),
        "tone": tone if tone in {"next", "queued", "review"} else "queued",
    }


def build_fallback_agent_plan(
    request: str,
    source_email: dict[str, Any] | None = None,
    review_feedback: str | None = None,
) -> dict:
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
) -> dict:
    if not isinstance(raw_plan, dict):
        raise ValueError("Gemini returned an empty task plan.")

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
        raise ValueError("Gemini returned a task plan without usable steps.")

    if request_needs_draft_preview(request, source_email) and draft_preview is None:
        raise ValueError("Gemini returned a writing task without a draft preview.")

    return {
        "name": name,
        "steps": steps[:5],
        "draftPreview": draft_preview,
        "planSummary": plan_summary,
        "clarifyingQuestion": clarifying_question,
    }


def build_fallback_reply(sender_name: str) -> str:
    first_name = (sender_name or "there").strip().split()[0] or "there"
    sign_off = get_profile().get("sign_off") or "Olivander Technologies"
    return (
        f"Hi {first_name},\n\n"
        "Thanks for your email. I have your message and will come back to you shortly "
        "with the next step.\n\n"
        f"{sign_off}"
    )


def generate_reply(sender_name: str, sender_email: str, subject: str, body: str) -> str:
    if client is None:
        return build_fallback_reply(sender_name)

    profile = get_profile()
    business_context = f"""Business: {profile.get('business_name', 'this business')}
Type: {profile.get('business_type', '')}
Owner: {profile.get('owner_name', '')}
Location: {profile.get('location', '')}
Services: {profile.get('services', '')}
Tone: {profile.get('tone', '')}
Sign off as: {profile.get('sign_off', 'The Team')}"""

    prompt = (
        f"You are an AI operations assistant for the following business:\n{business_context}\n\n"
        + f"""You are an AI operations assistant for a small service business. A new email has arrived and you need to draft a professional, warm, and concise reply on behalf of the business owner.

Sender: {sender_name} ({sender_email})
Subject: {subject}
Email: {body}

Write only the reply email body. No subject line, no metadata. Start directly with the greeting. Sign off as 'Olivander Technologies'. Keep it under 100 words. Be specific to the email content — do not use generic filler."""
    )

    try:
        reply_text = client.generate_text(prompt, model="gemini-2.0-flash")

        if not reply_text:
            raise RuntimeError("Gemini returned an empty email reply.")

        return reply_text
    except Exception as error:
        logger.error("Gemini email generation failed: %s", error, exc_info=True)
        return build_fallback_reply(sender_name)


def generate_agent_plan(
    request: str,
    source_email: dict[str, Any] | None = None,
    review_feedback: str | None = None,
) -> dict:
    if client is None:
        return build_fallback_agent_plan(request, source_email, review_feedback)

    profile = get_profile()
    business_context = f"""Business: {profile.get('business_name', 'this business')}
Type: {profile.get('business_type', '')}
Owner: {profile.get('owner_name', '')}
Location: {profile.get('location', '')}
Services: {profile.get('services', '')}
Tone: {profile.get('tone', '')}
Sign off as: {profile.get('sign_off', 'The Team')}"""

    source_email_context = ""
    if source_email:
        source_email_context = f"""

Source email:
- Sender: {source_email.get('senderName', '')} <{source_email.get('senderEmail', '')}>
- Subject: {source_email.get('subject', '')}
- Body: {source_email.get('body', '')}"""

    review_feedback_context = ""
    if review_feedback:
        review_feedback_context = f"""

Review feedback to apply:
{review_feedback}"""

    prompt = f"""You are Olivander, an AI operations assistant for the following business:
{business_context}

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
        response_text = client.generate_text(prompt, model="gemini-2.0-flash")
        raw_plan = extract_json_object(response_text)
        if raw_plan is None:
            raise ValueError("Gemini returned invalid JSON for the task plan.")
        return sanitise_agent_plan(raw_plan, request, source_email, review_feedback)
    except Exception as error:
        logger.error("Gemini task planning failed: %s", error, exc_info=True)
        return build_fallback_agent_plan(request, source_email, review_feedback)


def get_business_context() -> dict[str, Any]:
    return get_profile()


def build_recent_email_payload(
    *,
    business_id: str,
    max_results: int = 10,
    label_ids: list[str] | None = None,
    include_ai_metadata: bool = False,
    include_drafts: bool = False,
) -> list[dict[str, Any]]:
    access_token = get_valid_token(business_id)
    recent_messages = list_recent_messages(
        access_token,
        max_results=max_results,
        label_ids=label_ids,
    )
    business_context = get_business_context()
    emails: list[dict[str, Any]] = []

    for message in recent_messages:
        sender_name = message.get("from_name") or message.get("from") or "Unknown Sender"
        sender_email = message.get("from") or "unknown@example.com"
        subject = message.get("subject") or "Untitled Email"
        body = message.get("snippet") or ""
        classification = None
        suggested_reply = ""

        if include_ai_metadata:
            classification = classify_email(message, business_context)

        if include_drafts:
            if classification is None:
                classification = classify_email(message, business_context)

        if include_drafts and classification != "ignore":
            suggested_reply = generate_draft_reply(
                {
                    "from_name": sender_name,
                    "from": sender_email,
                    "subject": subject,
                    "snippet": body,
                },
                business_context,
            )

        emails.append(
            {
                "id": message["id"],
                "source": "gmail",
                "senderName": sender_name,
                "senderEmail": sender_email,
                "subject": subject,
                "body": body,
                "snippet": body,
                "date": message.get("date"),
                "classification": classification,
                "requiresApproval": bool(suggested_reply),
                "suggestedReply": suggested_reply,
            }
        )

    return emails


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=4401)
        return

    try:
        decode_session_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return


@app.post("/api/agent/plan")
@limiter.limit("60/minute")
async def plan_agent_task(
    request: Request,
    payload: AgentPlanRequest,
    business_id: str = Depends(get_current_business),
) -> dict:
    try:
        return generate_agent_plan(
            payload.request,
            payload.source_email,
            payload.review_feedback,
        )
    except HTTPException:
        raise
    except Exception as error:
        logger.error("Agent planning failed for business %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not generate a task plan right now.") from error


@app.get("/api/connections")
@limiter.limit("60/minute")
async def get_connections(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict:
    try:
        get_valid_token(business_id)
        return {"google": True}
    except HTTPException:
        return {"google": False}


@app.post("/api/connections/google/disconnect")
@limiter.limit("60/minute")
async def disconnect_google_connection(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict:
    business = get_business_by_id(business_id)

    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")

    clear_business_tokens(business_id)
    return {"success": True, "google": False}


@app.get("/api/memory")
@limiter.limit("60/minute")
async def get_memory(request: Request, business_id: str = Depends(get_current_business)) -> dict:
    return get_profile()


@app.post("/api/memory")
@limiter.limit("60/minute")
async def update_memory(
    request: Request,
    payload: MemoryValueRequest,
    business_id: str = Depends(get_current_business),
) -> dict:
    set_value(payload.key, payload.value)
    return {"success": True}


@app.get("/gmail/recent")
@limiter.limit("60/minute")
async def gmail_recent(
    request: Request,
    max_results: int = Query(default=10, ge=1, le=25),
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    return build_recent_email_payload(
        business_id=business_id,
        max_results=max_results,
        include_drafts=False,
    )


@app.get("/api/emails")
@limiter.limit("60/minute")
async def get_emails(
    request: Request,
    max_results: int = Query(default=10, ge=1, le=25),
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    return build_recent_email_payload(
        business_id=business_id,
        max_results=max_results,
        label_ids=["INBOX", "UNREAD"],
        include_drafts=False,
    )


@app.post("/api/emails/{email_id}/action")
@limiter.limit("60/minute")
async def action_email(
    request: Request,
    email_id: str,
    payload: EmailActionRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    access_token = get_valid_token(business_id)
    source_message = gmail_get_message(access_token, email_id)

    if payload.action == "optimise":
        improved_reply = generate_reply(
            source_message.get("from_name", "there"),
            source_message.get("from", "unknown@example.com"),
            source_message.get("subject", ""),
            source_message.get("snippet", ""),
        )
        return {"success": True, "reply": improved_reply}

    send_response = send_message(
        access_token,
        to_email=source_message.get("from", "unknown@example.com"),
        subject=f"Re: {source_message.get('subject', '')}",
        body=payload.reply,
        thread_id=source_message.get("thread_id"),
    )

    return {
        "success": True,
        "email_id": email_id,
        "sent_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "gmail": send_response,
    }
