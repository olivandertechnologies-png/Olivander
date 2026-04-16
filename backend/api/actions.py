import datetime
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth.deps import get_current_business
from auth.tokens import get_valid_token
from db.supabase import (
    get_approval_by_id,
    get_business_by_id,
    log_activity,
    update_approval_status,
)
from gmail.client import get_message, send_message
from rate_limit import limiter

router = APIRouter(prefix="/api/actions", tags=["actions"])
logger = logging.getLogger("olivander")


class ApprovalActionRequest(BaseModel):
    action: str  # "approve", "reject", "edit"
    edited_content: str | None = None
    rejection_reason: str | None = None


@router.post("/{approval_id}/approve")
@limiter.limit("60/minute")
async def approve_action(
    request: Request,
    approval_id: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Approve an action and send the email."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if approval.get("status") != "pending":
            return {
                "status": "already_handled",
                "current_status": approval.get("status"),
            }

        # Send the email
        business = get_business_by_id(business_id)
        access_token = get_valid_token(business_id)

        # Get original message details
        original_message_id = approval.get("original_email_id")
        if original_message_id:
            try:
                original = get_message(access_token, original_message_id)
                to_email = original.get("from", "unknown@example.com")
                subject = f"Re: {original.get('subject', 'No subject')}"
                thread_id = original.get("thread_id")
            except Exception as e:
                logger.error(f"Failed to get original message: {e}")
                to_email = approval.get("who", "unknown@example.com")
                subject = "Re: Your inquiry"
                thread_id = None
        else:
            to_email = approval.get("who", "unknown@example.com")
            subject = "Re: Your inquiry"
            thread_id = None

        draft_body = approval.get("draft_content", "")

        send_message(
            access_token,
            to_email=to_email,
            subject=subject,
            body=draft_body,
            thread_id=thread_id,
        )

        # Update approval status
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_approval_status(approval_id, "approved", when_ts=now)

        # Log activity
        log_activity(
            business_id,
            f"Approved and sent email to {to_email}",
            activity_type="approval_executed",
            metadata={
                "approval_id": approval_id,
                "to_email": to_email,
                "subject": subject,
            },
        )

        return {
            "status": "approved",
            "approval_id": approval_id,
            "sent_to": to_email,
            "sent_at": now,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to approve action {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to approve and send email",
        ) from error


@router.post("/{approval_id}/reject")
@limiter.limit("60/minute")
async def reject_action(
    request: Request,
    approval_id: str,
    payload: ApprovalActionRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Reject an action."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if approval.get("status") != "pending":
            return {
                "status": "already_handled",
                "current_status": approval.get("status"),
            }

        # Update approval status
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_approval_status(approval_id, "rejected", when_ts=now)

        # Log activity
        rejection_reason = payload.rejection_reason or "No reason provided"
        log_activity(
            business_id,
            f"Rejected action: {rejection_reason}",
            activity_type="approval_rejected",
            metadata={
                "approval_id": approval_id,
                "reason": rejection_reason,
            },
        )

        return {
            "status": "rejected",
            "approval_id": approval_id,
            "reason": rejection_reason,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to reject action {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to reject action",
        ) from error


@router.patch("/{approval_id}/edit")
@limiter.limit("60/minute")
async def edit_action(
    request: Request,
    approval_id: str,
    payload: ApprovalActionRequest,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Edit an approval (update draft content)."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        if approval.get("status") != "pending":
            return {
                "status": "already_handled",
                "current_status": approval.get("status"),
            }

        if not payload.edited_content:
            raise HTTPException(status_code=400, detail="edited_content is required")

        # Update approval with edited content
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_approval_status(
            approval_id,
            "pending",
            edited_content=payload.edited_content,
            when_ts=now,
        )

        # Log activity
        log_activity(
            business_id,
            "Edited approval content",
            activity_type="approval_edited",
            metadata={
                "approval_id": approval_id,
                "edited_at": now,
            },
        )

        return {
            "status": "edited",
            "approval_id": approval_id,
            "edited_at": now,
            "edited_content": payload.edited_content,
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to edit action {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to edit action",
        ) from error


@router.get("/{approval_id}")
@limiter.limit("60/minute")
async def get_approval_detail(
    request: Request,
    approval_id: str,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Get approval details."""
    try:
        approval = get_approval_by_id(approval_id)

        if not approval:
            raise HTTPException(status_code=404, detail="Approval not found")

        if approval.get("business_id") != business_id:
            raise HTTPException(status_code=403, detail="Unauthorized")

        return {
            "id": approval.get("id"),
            "status": approval.get("status"),
            "type": approval.get("type"),
            "who": approval.get("who"),
            "what": approval.get("what"),
            "why": approval.get("why"),
            "draft_content": approval.get("draft_content"),
            "edited_content": approval.get("edited_content"),
            "created_at": approval.get("created_at"),
            "when_ts": approval.get("when_ts"),
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Failed to get approval {approval_id}: {error}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve approval",
        ) from error
