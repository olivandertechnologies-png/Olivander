import datetime
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from agent.draft import generate_agent_plan
from auth.deps import get_current_business
from auth.google import router as google_auth_router
from auth.tokens import clear_business_tokens, get_valid_token
from config import FRONTEND_ORIGIN
from db.supabase import (
    get_business_by_id,
    get_memory_profile,
    set_memory_value,
    verify_supabase_connection,
)
from gmail.client import get_message as gmail_get_message
from gmail.client import list_recent_messages, send_message
from gmail.webhook import router as gmail_webhook_router
from rate_limit import limiter

os.makedirs("logs", exist_ok=True)
handler = RotatingFileHandler("logs/app.log", maxBytes=5_000_000, backupCount=3)
logging.basicConfig(handlers=[handler, logging.StreamHandler()], level=logging.INFO)
logger = logging.getLogger("olivander")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST_DIR = PROJECT_ROOT / "frontend" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"

REQUIRED = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "GROQ_API_KEY",
    "JWT_SECRET",
    "ENCRYPTION_KEY",
    "WEBHOOK_SECRET",
]
for variable in REQUIRED:
    if not os.getenv(variable):
        raise RuntimeError(f"Missing required env var: {variable}")

app = FastAPI(title="Olivander Proto Backend")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin
        for origin in [FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000"]
        if origin
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(google_auth_router)
app.include_router(gmail_webhook_router)

if FRONTEND_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="frontend-assets")


@app.on_event("startup")
async def startup_checks() -> None:
    verify_supabase_connection()


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

    return {
        "google": google_connected,
        "contact_name": business.get("contact_name") or business.get("first_name"),
        "business_name": business.get("business_name"),
        "email": business.get("email"),
    }


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


@app.get("/health", include_in_schema=False)
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def serve_frontend_root() -> FileResponse:
    index_path = FRONTEND_DIST_DIR / "index.html"

    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    return FileResponse(index_path)


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend_app(full_path: str) -> FileResponse:
    if full_path.startswith(("api", "auth", "gmail", "webhook", "docs", "redoc", "openapi.json")):
        raise HTTPException(status_code=404, detail="Not found.")

    requested_path = FRONTEND_DIST_DIR / full_path
    if full_path and requested_path.exists() and requested_path.is_file():
        return FileResponse(requested_path)

    index_path = FRONTEND_DIST_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    return FileResponse(index_path)
