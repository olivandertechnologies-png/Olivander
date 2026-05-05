"""Email-based approval action endpoints.

These endpoints are opened from tap-target links in approval notification emails.
They use HMAC-signed tokens (no JWT) so owners can act directly from their
mobile email client without being logged into the dashboard.

Endpoints:
    GET /api/email-action?token=<signed_token>
        - token encodes: approval_id, action (approve|reject), business_id, exp
        - Validates signature + expiry
        - Executes the action using the same logic as the dashboard
        - Returns a simple HTML confirmation page

Security:
    - HMAC-SHA256 signature over the full payload (WEBHOOK_SECRET key)
    - 24-hour expiry enforced server-side
    - Idempotent: double-tapping approve/reject is safe (already_handled path)
    - business_id in token is validated against the approval's business_id
"""

import datetime
import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import WEBHOOK_SECRET
from db.supabase import (
    claim_approval,
    get_approval_by_id,
    log_activity,
)
from auth.tokens import get_valid_token
from gmail.client import get_message, send_message
from notifications.email_sender import verify_action_token
from rate_limit import limiter

router = APIRouter(tags=["email-actions"])
logger = logging.getLogger("olivander")

_STYLE = (
    "font-family:'DM Sans',Helvetica,Arial,sans-serif;"
    "background:#F5F0E8;min-height:100vh;display:flex;"
    "align-items:center;justify-content:center;margin:0;padding:24px;"
)
_CARD = (
    "background:#FDFAF4;border-radius:12px;padding:40px 32px;"
    "max-width:480px;width:100%;text-align:center;"
)


def _html_page(title: str, body: str, colour: str = "#2C3240") -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
</head>
<body style="{_STYLE}">
  <div style="{_CARD}">
    <p style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#2C3240;margin:0 0 20px;">
      <span style="color:#5A4FD0;">O</span>livander
    </p>
    <p style="font-size:18px;font-weight:600;color:{colour};margin:0 0 12px;">{title}</p>
    <p style="font-size:15px;color:#5C6475;margin:0;">{body}</p>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html)


@router.get("/api/email-action")
@limiter.limit("30/minute")
async def handle_email_action(request: Request, token: str = "") -> HTMLResponse:
    """Validate a signed action token and execute approve or reject."""
    if not token:
        return _html_page("Invalid link", "This link is missing its security token.", "#C42B2B")

    if not WEBHOOK_SECRET:
        logger.error("WEBHOOK_SECRET is not configured — cannot verify email action token")
        return _html_page("Configuration error", "Please contact support.", "#C42B2B")

    # Verify token
    try:
        payload = verify_action_token(token, WEBHOOK_SECRET)
    except ValueError as exc:
        logger.warning("Invalid email action token: %s", exc)
        return _html_page(
            "Link expired or invalid",
            "This link has expired or has already been used. Open the Olivander app to take action.",
            "#C42B2B",
        )

    approval_id = payload.get("approval_id")
    action = payload.get("action")
    token_business_id = payload.get("business_id")

    if not approval_id or action not in ("approve", "reject"):
        return _html_page("Invalid link", "This link is not valid.", "#C42B2B")

    # Load approval
    approval = get_approval_by_id(approval_id)
    if not approval:
        return _html_page("Not found", "This approval no longer exists.", "#C42B2B")

    # Verify business ownership (belt-and-suspenders check)
    if approval.get("business_id") != token_business_id:
        logger.warning(
            "Email action token business_id mismatch for approval %s", approval_id
        )
        return _html_page("Invalid link", "This link is not valid.", "#C42B2B")

    business_id = token_business_id

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    new_status = "approved" if action == "approve" else "rejected"

    # Atomic claim — only succeeds if status is currently 'pending'.
    # Prevents duplicate actions from concurrent email-tap requests.
    claimed = claim_approval(approval_id, new_status, now)
    if not claimed:
        status = approval.get("status", "handled")
        return _html_page(
            "Already handled",
            f"This action was already {status}. No changes were made.",
            "#8C93A4",
        )

    if action == "approve":
        if approval.get("type") == "missed_response":
            log_activity(
                business_id,
                "Missed response marked handled via email tap",
                activity_type="missed_response_handled",
                metadata={"approval_id": approval_id, "via": "email_tap"},
            )
            return _html_page(
                "Marked handled",
                "This missed response has been marked handled. No email was sent.",
                "#2E7D52",
            )

        try:
            access_token = get_valid_token(business_id)
            original_email_id = approval.get("original_email_id")

            if original_email_id:
                original = get_message(access_token, original_email_id)
                to_email = original.get("from", "unknown@example.com")
                subject = f"Re: {original.get('subject', 'Your inquiry')}"
                thread_id = original.get("thread_id")
            else:
                to_email = approval.get("who", "unknown@example.com")
                subject = "Re: Your inquiry"
                thread_id = None

            draft_body = approval.get("edited_content") or approval.get("draft_content") or ""
            send_message(
                access_token,
                to_email=to_email,
                subject=subject,
                body=draft_body,
                thread_id=thread_id,
            )
            log_activity(
                business_id,
                f"Approved and sent email to {to_email} (via email tap)",
                activity_type="approval_executed",
                metadata={"approval_id": approval_id, "to_email": to_email, "via": "email_tap"},
            )
            return _html_page(
                "Reply sent",
                f"Your reply to {to_email} has been sent.",
                "#2E7D52",
            )

        except Exception as error:
            logger.error("Email-tap approve failed for %s: %s", approval_id, error, exc_info=True)
            # Status is already "approved" in DB — log the send failure
            log_activity(
                business_id,
                "Approval claimed via email tap but send failed",
                activity_type="approval_send_failed",
                metadata={"approval_id": approval_id, "error": str(error)},
            )
            return _html_page(
                "Something went wrong",
                "Your approval was recorded but the email could not be sent. Please open the app and retry.",
                "#C42B2B",
            )

    else:  # reject — already claimed above
        log_activity(
            business_id,
            "Rejected action via email tap",
            activity_type="approval_rejected",
            metadata={"approval_id": approval_id, "via": "email_tap"},
        )
        return _html_page(
            "Rejected",
            "This action has been rejected. No email was sent.",
            "#8C93A4",
        )
