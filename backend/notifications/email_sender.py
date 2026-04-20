"""Approval notification emails.

Sends an HTML email to the business owner when a new approval is queued.
The email contains WHO/WHAT/WHY/WHEN context and three tap-target action links:
  - Approve  → GET /api/email-action?token=<signed_approve_token>
  - Reject   → GET /api/email-action?token=<signed_reject_token>
  - Edit in App → direct link to frontend approvals panel

Tokens are HMAC-SHA256 signed with WEBHOOK_SECRET and expire after 24 hours.
Single-use semantics are enforced by the existing approval status check
(approve/reject are idempotent on a non-pending approval).
"""

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any

logger = logging.getLogger("olivander")


# ── Token helpers ──────────────────────────────────────────────────────────────

def generate_action_token(
    approval_id: str,
    action: str,
    business_id: str,
    secret: str,
    ttl_seconds: int = 86400,
) -> str:
    """Return a signed token encoding the approval action.

    Format: base64url(payload_json).hex_hmac_sha256
    """
    payload = {
        "approval_id": approval_id,
        "action": action,
        "business_id": business_id,
        "exp": int(time.time()) + ttl_seconds,
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_action_token(token: str, secret: str) -> dict[str, Any]:
    """Verify token signature and expiry. Raises ValueError on failure."""
    try:
        payload_b64, sig = token.rsplit(".", 1)
    except ValueError as exc:
        raise ValueError("Malformed token") from exc

    expected_sig = hmac.new(
        secret.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid token signature")

    padding = "=" * (-len(payload_b64) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + padding).decode())
    except Exception as exc:
        raise ValueError("Could not decode token payload") from exc

    if payload.get("exp", 0) < time.time():
        raise ValueError("Token has expired")

    return payload


# ── HTML email builder ─────────────────────────────────────────────────────────

def _button(label: str, url: str, bg: str, fg: str = "#FFFFFF") -> str:
    return (
        f'<a href="{url}" target="_blank" '
        f'style="display:inline-block;padding:14px 28px;background:{bg};color:{fg};'
        f'font-family:\'DM Sans\',Helvetica,Arial,sans-serif;font-size:15px;'
        f'font-weight:600;text-decoration:none;border-radius:8px;'
        f'mso-padding-alt:0;line-height:1.2;">{label}</a>'
    )


def build_approval_email_html(
    approval: dict[str, Any],
    approve_url: str,
    reject_url: str,
    edit_url: str,
) -> tuple[str, str]:
    """Return (html_body, text_body) for the approval notification email."""
    who = approval.get("who") or "Unknown sender"
    what = approval.get("what") or "Action required"
    why = approval.get("why") or ""
    draft = (approval.get("draft_content") or "").strip()

    # Plain-text version for email clients that don't render HTML
    text_body = (
        f"NEW APPROVAL REQUIRED\n\n"
        f"Who:  {who}\n"
        f"What: {what}\n"
        f"Why:  {why}\n\n"
        f"Draft reply:\n{draft}\n\n"
        f"Approve: {approve_url}\n"
        f"Reject:  {reject_url}\n"
        f"Edit in app: {edit_url}\n"
    )

    draft_html = draft.replace("\n", "<br>") if draft else "(No draft)"

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Olivander — Approval Required</title>
</head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0" border="0">

        <!-- Header -->
        <tr>
          <td style="padding-bottom:20px;">
            <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#2C3240;">
              <span style="color:#5A4FD0;">O</span>livander
            </span>
            <span style="font-size:13px;color:#8C93A4;margin-left:8px;">Action required</span>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#FDFAF4;border-radius:12px;padding:28px 28px 24px;">

            <!-- WHO/WHAT/WHY -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
              <tr>
                <td style="padding:6px 0;border-bottom:1px solid #DED9D0;">
                  <span style="font-size:11px;font-weight:600;color:#8C93A4;text-transform:uppercase;letter-spacing:.05em;">Who</span><br>
                  <span style="font-size:15px;color:#2C3240;">{who}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;border-bottom:1px solid #DED9D0;">
                  <span style="font-size:11px;font-weight:600;color:#8C93A4;text-transform:uppercase;letter-spacing:.05em;">What</span><br>
                  <span style="font-size:15px;color:#2C3240;">{what}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:11px;font-weight:600;color:#8C93A4;text-transform:uppercase;letter-spacing:.05em;">Why</span><br>
                  <span style="font-size:15px;color:#3D4452;">{why}</span>
                </td>
              </tr>
            </table>

            <!-- Draft -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#EDE6D8;border-radius:8px;padding:14px 16px;">
                  <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;color:#8C93A4;text-transform:uppercase;letter-spacing:.05em;">Draft reply</p>
                  <p style="margin:0;font-size:14px;color:#3D4452;line-height:1.55;">{draft_html}</p>
                </td>
              </tr>
            </table>

            <!-- Action buttons -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding-bottom:12px;">
                  {_button("Approve &amp; Send", approve_url, "#2E7D52")}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-bottom:12px;">
                  {_button("Edit in App", edit_url, "#5A4FD0")}
                </td>
              </tr>
              <tr>
                <td align="center">
                  {_button("Reject", reject_url, "#EDE6D8", "#C42B2B")}
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:16px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8C93A4;">
              Olivander · Queenstown, New Zealand
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>"""

    return html_body, text_body


# ── Public send function ───────────────────────────────────────────────────────

def send_approval_notification(
    business_id: str,
    approval_id: str,
    approval: dict[str, Any],
    owner_email: str,
    access_token: str,
    frontend_origin: str,
    backend_origin: str,
    webhook_secret: str,
) -> bool:
    """Send the HTML approval notification email to the owner.

    Returns True on success, False on any failure (non-fatal — caller should log).
    """
    try:
        approve_token = generate_action_token(approval_id, "approve", business_id, webhook_secret)
        reject_token = generate_action_token(approval_id, "reject", business_id, webhook_secret)

        approve_url = f"{backend_origin}/api/email-action?token={approve_token}"
        reject_url = f"{backend_origin}/api/email-action?token={reject_token}"
        edit_url = f"{frontend_origin}/#approvals"

        html_body, text_body = build_approval_email_html(
            approval, approve_url, reject_url, edit_url
        )

        from gmail.client import send_html_message  # lazy import to avoid circular deps
        send_html_message(
            access_token,
            to_email=owner_email,
            subject=f"Action required: {approval.get('what', 'New approval')}",
            html_body=html_body,
            text_body=text_body,
        )
        return True

    except Exception as error:
        logger.warning(
            "Failed to send approval notification for approval %s: %s",
            approval_id,
            error,
        )
        return False
