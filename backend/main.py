import datetime
import logging
import os
from email.utils import parseaddr
from logging.handlers import RotatingFileHandler
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from agent.classify import classify_email
from agent.draft import draft_reply, generate_agent_plan
from agent.execution_plan import build_execution_plan
from agent.rag import retrieve_context_chunks
from config import FRONTEND_ORIGIN as _FRONTEND_ORIGIN
from config import get_secret
from api.actions import router as actions_router
from api.calendar import router as calendar_router
from api.clients import router as clients_router
from api.email_actions import router as email_actions_router
from api.invoices import router as invoices_router
from api.leads import router as leads_router
from api.outcomes import router as outcomes_router
from api.quotes import router as quotes_router
from api.workspace import router as workspace_router
from auth.deps import get_current_business
from auth.google import router as google_auth_router
from auth.xero import router as xero_auth_router
from auth.tokens import clear_business_tokens, get_valid_token
from db.supabase import (
    create_approval,
    get_approvals_for_business,
    get_business_by_id,
    get_memory_profile,
    set_memory_value,
    set_onboarded,
    verify_supabase_connection,
)
from gmail.client import get_message as gmail_get_message
from gmail.client import list_recent_messages, send_message
from gmail.webhook import router as gmail_webhook_router
from jobs.queue import job_runner
from rate_limit import limiter

os.makedirs("logs", exist_ok=True)
handler = RotatingFileHandler("logs/app.log", maxBytes=5_000_000, backupCount=3)
logging.basicConfig(handlers=[handler, logging.StreamHandler()], level=logging.INFO)
logger = logging.getLogger("olivander")

IS_PRODUCTION = os.getenv("RAILWAY_ENVIRONMENT") is not None or os.getenv("RENDER") is not None

REQUIRED = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "GROQ_API_KEY",
    "JWT_SECRET",
    "ENCRYPTION_KEY",
    "WEBHOOK_SECRET",
]
if IS_PRODUCTION:
    REQUIRED.append("PUBSUB_TOPIC")

for variable in REQUIRED:
    if not get_secret(variable):
        raise RuntimeError(f"Missing required configuration: {variable}")

app = FastAPI(
    title="Olivander Backend",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_CORS_ORIGINS = list({
    "http://localhost:5173",
    "https://olivander.vercel.app",
    "https://olivander.onrender.com",
    _FRONTEND_ORIGIN,
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response

app.include_router(google_auth_router)
app.include_router(xero_auth_router)
app.include_router(gmail_webhook_router)
app.include_router(actions_router)
app.include_router(calendar_router)
app.include_router(clients_router)
app.include_router(invoices_router)
app.include_router(leads_router)
app.include_router(outcomes_router)
app.include_router(quotes_router)
app.include_router(workspace_router)
app.include_router(email_actions_router)


@app.on_event("startup")
async def startup_checks() -> None:
    verify_supabase_connection()
    await job_runner.start()


@app.on_event("shutdown")
async def shutdown_jobs() -> None:
    await job_runner.stop()


@app.exception_handler(HTTPException)
async def passthrough_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return await http_exception_handler(request, exc)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s: %s", request.url, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again."},
    )


class EmailActionRequest(BaseModel):
    action: Literal["send"]
    reply: str


class MemoryValueRequest(BaseModel):
    key: str
    value: str


class AgentPlanRequest(BaseModel):
    request: str
    source_email: dict[str, Any] | None = None
    review_feedback: str | None = None


def get_business_context(business_id: str) -> dict[str, Any]:
    business = get_business_by_id(business_id) or {}
    memory = get_memory_profile(business_id)

    return {
        "business_name": memory.get("business_name") or business.get("business_name") or "",
        "owner_email": memory.get("owner_email") or business.get("email") or "",
        "business_type": memory.get("business_type") or "",
        "pricing_range": memory.get("pricing_range") or "",
        "payment_terms": memory.get("payment_terms") or "",
        "gst_registered": memory.get("gst_registered") or "",
        "reply_tone": memory.get("reply_tone") or "",
        "reply_tone_edits": memory.get("reply_tone_edits") or "0",
        "reschedule_policy": memory.get("reschedule_policy") or "",
        "no_show_handling": memory.get("no_show_handling") or "",
        "tone": memory.get("reply_tone") or memory.get("tone") or "",
        "contact_name": business.get("contact_name") or "",
        "email": business.get("email") or "",
        "location": memory.get("location") or "",
        "services": memory.get("services") or "",
        "blocked_sender_patterns": memory.get("blocked_sender_patterns") or "noreply,no-reply,do-not-reply,notifications@,mailer-daemon,newsletter,unsubscribe",
        "active_categories": memory.get("active_categories") or "new_lead,existing_client,booking_request,complaint,invoice,payment_confirmation",
        "plan": memory.get("plan") or "starter",
    }


def build_recent_email_payload(
    *,
    business_id: str,
    max_results: int = 10,
    label_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    access_token = get_valid_token(business_id)
    recent_messages = list_recent_messages(
        access_token,
        max_results=max_results,
        label_ids=label_ids,
    )
    emails: list[dict[str, Any]] = []

    for message in recent_messages:
        sender_name = message.get("from_name") or message.get("from") or "Unknown Sender"
        sender_email = message.get("from") or "unknown@example.com"
        subject = message.get("subject") or "Untitled Email"
        body = message.get("snippet") or ""

        emails.append(
            {
                "id": message["id"],
                "source": "gmail",
                "senderName": sender_name,
                "senderEmail": sender_email,
                "subject": subject,
                "body": body,
                "snippet": body,
                "full_body": message.get("full_body") or body,
                "date": message.get("date"),
                "classification": None,
                "requiresApproval": False,
                "suggestedReply": "",
            }
        )

    return emails


@app.post("/api/agent/plan")
@limiter.limit("60/minute")
async def plan_agent_task(
    request: Request,
    payload: AgentPlanRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    try:
        return generate_agent_plan(
            payload.request,
            get_business_context(business_id),
            payload.source_email,
            payload.review_feedback,
            business_id=business_id,
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
) -> dict[str, Any]:
    business = get_business_by_id(business_id) or {}

    try:
        get_valid_token(business_id)
        google_connected = True
    except HTTPException:
        google_connected = False

    xero_connected = bool(business.get("xero_access_token") and business.get("xero_tenant_id"))

    return {
        "google": google_connected,
        "xero": xero_connected,
        "contact_name": business.get("contact_name") or business.get("first_name"),
        "business_name": business.get("business_name"),
        "email": business.get("email"),
        "onboarded": bool(business.get("onboarded", True)),  # default True for existing businesses
    }


@app.patch("/api/business/onboard")
@limiter.limit("30/minute")
async def complete_onboarding(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Mark the business as having completed onboarding."""
    business = get_business_by_id(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    set_onboarded(business_id)
    return {"success": True, "onboarded": True}


@app.post("/api/connections/google/disconnect")
@limiter.limit("60/minute")
async def disconnect_google_connection(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    business = get_business_by_id(business_id)

    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")

    clear_business_tokens(business_id)
    return {"success": True, "google": False}


@app.get("/api/memory")
@limiter.limit("60/minute")
async def get_memory(request: Request, business_id: str = Depends(get_current_business)) -> dict[str, Any]:
    return get_business_context(business_id)


@app.post("/api/memory")
@limiter.limit("60/minute")
async def update_memory(
    request: Request,
    payload: MemoryValueRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    set_memory_value(business_id, payload.key, payload.value)
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


_APPROVAL_STATUSES = {"pending", "approved", "rejected"}


class CreateApprovalRequest(BaseModel):
    sourceEmailId: str | None = None
    senderName: str = ""
    senderEmail: str = ""
    subject: str = ""
    agentResponse: str = ""
    tier: str = "Tier 3"
    why: str = ""


def _normalise_approval_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map a Supabase approval row to the shape the frontend expects."""
    who = row.get("who") or ""
    sender_name, sender_email = parseaddr(who)
    if not sender_email:
        sender_email = who
        sender_name = who

    created_at_raw = row.get("created_at")
    created_at_ms: int | None = None
    if created_at_raw:
        try:
            dt = datetime.datetime.fromisoformat(str(created_at_raw).replace("Z", "+00:00"))
            created_at_ms = int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            pass

    return {
        "id": str(row.get("id", "")),
        "type": row.get("type") or "email_reply",
        "senderName": sender_name or "Unknown sender",
        "senderEmail": sender_email or "unknown@example.com",
        "subject": row.get("what") or "Untitled",
        "createdAt": created_at_ms,
        "tier": f"Tier {row.get('tier', 3)} — owner approval required",
        "why": row.get("why") or "",
        "agentResponse": row.get("edited_content") or row.get("draft_content") or "",
        "status": "edited" if row.get("edited_content") else "review",
        "sourceEmailId": row.get("original_email_id"),
        "executionPlan": row.get("execution_plan"),
        "retrievedContext": row.get("retrieved_context"),
        "taskId": None,
    }


@app.get("/api/approvals")
@limiter.limit("60/minute")
async def get_approvals(
    request: Request,
    status: str | None = None,
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    """Get all approvals for the current business."""
    if status is not None and status not in _APPROVAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(_APPROVAL_STATUSES)}")
    rows = get_approvals_for_business(business_id, status=status)
    return [_normalise_approval_row(row) for row in rows]


@app.post("/api/approvals")
@limiter.limit("60/minute")
async def create_approval_endpoint(
    request: Request,
    payload: CreateApprovalRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Persist a frontend approval to Supabase."""
    who = (
        f"{payload.senderName} <{payload.senderEmail}>"
        if payload.senderName
        else payload.senderEmail
    )
    row = create_approval(
        business_id=business_id,
        approval_type="email_reply",
        who=who,
        what=payload.subject,
        why=payload.why or "This message changes a customer-facing action and should be reviewed before sending.",
        original_email_id=payload.sourceEmailId,
        draft_content=payload.agentResponse,
    )
    if not row:
        raise HTTPException(status_code=500, detail="Could not create approval.")
    return _normalise_approval_row(row)


@app.post("/api/onboarding/dry-run")
@limiter.limit("10/minute")
async def onboarding_dry_run(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> list[dict[str, Any]]:
    """Classify and draft 2-3 recent real emails without saving anything.

    Used in onboarding Step 3 so the owner sees what the agent would do
    with their inbox before going live. Nothing is queued or sent.
    """
    import asyncio

    def _run_dry_run() -> list[dict[str, Any]]:
        try:
            emails = build_recent_email_payload(business_id=business_id, max_results=10)
        except Exception as err:
            logger.warning("Dry-run: could not fetch emails for %s: %s", business_id, err)
            raise HTTPException(status_code=502, detail="Could not read your inbox. Check that Gmail is connected.")

        context = get_business_context(business_id)
        business = get_business_by_id(business_id) or {}
        has_xero = bool(business.get("xero_access_token") and business.get("xero_tenant_id"))

        proposals: list[dict[str, Any]] = []
        skipped = 0

        for email in emails:
            if len(proposals) >= 3:
                break
            try:
                classification = classify_email(
                    subject=email["subject"],
                    body=email["body"],
                    sender=email["senderEmail"],
                    business_id=business_id,
                )
                if classification in ("spam", "fyi"):
                    continue

                retrieved = retrieve_context_chunks(business_id, classification)
                draft = draft_reply(
                    subject=email["subject"],
                    body=email["body"],
                    sender=email["senderEmail"],
                    classification=classification,
                    business_context=context,
                    business_id=business_id,
                    retrieved_context=retrieved,
                )
                plan = build_execution_plan(
                    classification=classification,
                    retrieved_context=retrieved,
                    has_xero=has_xero,
                    is_known_client=(classification == "existing_client"),
                )
                proposals.append({
                    "senderName": email["senderName"],
                    "senderEmail": email["senderEmail"],
                    "subject": email["subject"],
                    "classification": classification,
                    "draft": draft,
                    "executionPlan": plan,
                    "retrievedContext": retrieved,
                })
            except Exception as err:
                logger.warning("Dry-run: could not process email for %s: %s", business_id, err)
                skipped += 1

        if skipped > 0 and not proposals:
            raise HTTPException(status_code=502, detail="Could not generate any draft proposals. Please try again.")

        return proposals

    return await asyncio.get_running_loop().run_in_executor(None, _run_dry_run)


@app.get("/health", include_in_schema=False)
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def root() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "olivander-api"})
