import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from config import SUPABASE_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL

_supabase_client: Client | None = None
logger = logging.getLogger("olivander")


def _normalise_row(data: Any) -> dict[str, Any] | None:
    if not data:
        return None

    if isinstance(data, list):
        return data[0] if data else None

    if isinstance(data, dict):
        return data

    return None


def verify_supabase_connection() -> None:
    supabase = get_supabase_client()

    try:
        supabase.table("businesses").select("id").limit(1).execute()
    except Exception as error:
        raise RuntimeError("Supabase connection failed.") from error

    logger.info("Supabase connected")


def get_supabase_client() -> Client:
    global _supabase_client

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env."
        )

    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    return _supabase_client


def get_business_by_id(business_id: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .select("*")
        .eq("id", business_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def get_business_by_email(email: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def upsert_business(data: dict[str, Any]) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("businesses")
        .upsert(data, on_conflict="email")
        .execute()
    )
    return _normalise_row(response.data)


def update_tokens(
    business_id: str,
    access_token: str | None,
    refresh_token: str | None,
    expiry: str | None,
) -> None:
    (
        get_supabase_client()
        .table("businesses")
        .update(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_expiry": expiry,
            }
        )
        .eq("id", business_id)
        .execute()
    )


def get_memory_profile(business_id: str) -> dict[str, str]:
    response = (
        get_supabase_client()
        .table("memory")
        .select("key, value")
        .eq("business_id", business_id)
        .execute()
    )
    rows = response.data or []
    return {
        str(row.get("key")): str(row.get("value"))
        for row in rows
        if row.get("key") is not None and row.get("value") is not None
    }


def set_memory_value(business_id: str, key: str, value: str, source: str = "owner") -> None:
    """Write a memory key atomically using upsert on the (business_id, key) unique constraint.

    Requires migration 009_memory_unique_key.sql to be applied.
    """
    (
        get_supabase_client()
        .table("memory")
        .upsert(
            {"business_id": business_id, "key": key, "value": value, "source": source},
            on_conflict="business_id,key",
        )
        .execute()
    )


def create_approval(
    business_id: str,
    approval_type: str,
    who: str | None = None,
    what: str | None = None,
    why: str | None = None,
    original_email_id: str | None = None,
    draft_content: str | None = None,
    execution_plan: dict | None = None,
    retrieved_context: list | None = None,
) -> dict[str, Any] | None:
    """Create a pending approval in the approvals table."""
    row: dict[str, Any] = {
        "business_id": business_id,
        "status": "pending",
        "type": approval_type,
        "who": who,
        "what": what,
        "why": why,
        "original_email_id": original_email_id,
        "draft_content": draft_content,
        "when_ts": None,
    }
    if execution_plan is not None:
        row["execution_plan"] = execution_plan
    if retrieved_context is not None:
        row["retrieved_context"] = retrieved_context

    response = (
        get_supabase_client()
        .table("approvals")
        .insert(row)
        .execute()
    )
    return _normalise_row(response.data)


def get_approval_by_id(approval_id: str) -> dict[str, Any] | None:
    """Get an approval by ID."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("*")
        .eq("id", approval_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def approval_exists_for_message(business_id: str, gmail_message_id: str) -> bool:
    """Return True if any approval (pending or otherwise) already exists for this Gmail message ID."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("id")
        .eq("business_id", business_id)
        .eq("original_email_id", gmail_message_id)
        .limit(1)
        .execute()
    )
    return bool(response.data)


def missed_response_source_id(gmail_message_id: str) -> str:
    """Stable source ID for a missed-response action tied to an email."""
    return f"missed_response:{gmail_message_id}"


def get_approval_for_original_email(
    business_id: str,
    gmail_message_id: str,
) -> dict[str, Any] | None:
    """Return the latest approval linked to an original Gmail message."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("*")
        .eq("business_id", business_id)
        .eq("original_email_id", gmail_message_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def pending_missed_response_approval_exists(
    business_id: str,
    gmail_message_id: str,
) -> bool:
    """Return True if a missed-response action is already pending."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("id")
        .eq("business_id", business_id)
        .eq("status", "pending")
        .eq("original_email_id", missed_response_source_id(gmail_message_id))
        .limit(1)
        .execute()
    )
    return bool(response.data)


def invoice_source_id(invoice_id: str) -> str:
    """Stable source ID for approval deduplication around a Xero invoice."""
    return f"xero_invoice:{invoice_id}"


def pending_invoice_reminder_approval_exists(business_id: str, invoice_id: str) -> bool:
    """Return True if a reminder for this invoice is already awaiting approval."""
    response = (
        get_supabase_client()
        .table("approvals")
        .select("id")
        .eq("business_id", business_id)
        .eq("status", "pending")
        .eq("original_email_id", invoice_source_id(invoice_id))
        .limit(1)
        .execute()
    )
    return bool(response.data)


def pending_invoice_chaser_job_exists(
    business_id: str,
    invoice_id: str,
    *,
    within_hours: int = 48,
) -> bool:
    """Return True if a scheduled invoice chaser is already due soon."""
    window_end = (datetime.now(timezone.utc) + timedelta(hours=within_hours)).isoformat()
    response = (
        get_supabase_client()
        .table("job_queue")
        .select("id")
        .eq("business_id", business_id)
        .eq("job_type", "chase_invoice")
        .eq("status", "pending")
        .lte("run_at", window_end)
        .contains("payload", {"xero_invoice_id": invoice_id})
        .limit(1)
        .execute()
    )
    return bool(response.data)


def update_approval_status(
    approval_id: str,
    status: str,
    edited_content: str | None = None,
    when_ts: str | None = None,
) -> None:
    """Update approval status (pending -> approved/rejected/edited)."""
    update_data = {"status": status}
    if edited_content:
        update_data["edited_content"] = edited_content
    if when_ts:
        update_data["when_ts"] = when_ts

    (
        get_supabase_client()
        .table("approvals")
        .update(update_data)
        .eq("id", approval_id)
        .execute()
    )


def log_activity(
    business_id: str,
    description: str,
    activity_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Log an activity/action to the activity table."""
    (
        get_supabase_client()
        .table("activity")
        .insert({
            "business_id": business_id,
            "description": description,
            "type": activity_type,
            "metadata": metadata or {},
        })
        .execute()
    )


def claim_approval(approval_id: str, new_status: str, when_ts: str) -> bool:
    """Atomically claim a pending approval by setting its status.

    Only succeeds if the current status is 'pending'. Returns True if the
    claim succeeded (row was updated), False if it was already handled.
    This prevents duplicate actions from concurrent email-tap requests.
    """
    response = (
        get_supabase_client()
        .table("approvals")
        .update({"status": new_status, "when_ts": when_ts})
        .eq("id", approval_id)
        .eq("status", "pending")
        .execute()
    )
    return bool(response.data)


def update_xero_tokens(
    business_id: str,
    access_token: str | None,
    refresh_token: str | None,
    expiry: str | None,
    tenant_id: str | None,
) -> None:
    """Store encrypted Xero tokens on the business row."""
    (
        get_supabase_client()
        .table("businesses")
        .update(
            {
                "xero_access_token": access_token,
                "xero_refresh_token": refresh_token,
                "xero_token_expiry": expiry,
                "xero_tenant_id": tenant_id,
            }
        )
        .eq("id", business_id)
        .execute()
    )


def set_onboarded(business_id: str) -> None:
    """Mark a business as having completed onboarding."""
    (
        get_supabase_client()
        .table("businesses")
        .update({"onboarded": True})
        .eq("id", business_id)
        .execute()
    )


def log_ai_usage(
    business_id: str | None,
    model: str,
    operation: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
) -> None:
    """Log an AI model call to the ai_usage table for cost tracking."""
    (
        get_supabase_client()
        .table("ai_usage")
        .insert({
            "business_id": business_id,
            "model": model,
            "operation": operation,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        })
        .execute()
    )


def get_approvals_for_business(
    business_id: str,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Get approvals for a business, optionally filtered by status."""
    query = (
        get_supabase_client()
        .table("approvals")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
    )

    if status:
        query = query.eq("status", status)

    response = query.execute()
    return response.data or []


# ---------------------------------------------------------------------------
# Job queue
# ---------------------------------------------------------------------------

def enqueue_job(
    job_type: str,
    payload: dict[str, Any],
    run_at: str,
    business_id: str | None = None,
    max_attempts: int = 3,
) -> dict[str, Any] | None:
    """Insert a job into the job_queue table."""
    row: dict[str, Any] = {
        "job_type": job_type,
        "payload": payload,
        "run_at": run_at,
        "status": "pending",
        "attempts": 0,
        "max_attempts": max_attempts,
    }
    if business_id:
        row["business_id"] = business_id

    response = (
        get_supabase_client()
        .table("job_queue")
        .insert(row)
        .execute()
    )
    return _normalise_row(response.data)


def claim_job(job_id: str) -> bool:
    """Atomically set a pending job to running. Returns True if claimed."""
    response = (
        get_supabase_client()
        .table("job_queue")
        .update({"status": "running"})
        .eq("id", job_id)
        .eq("status", "pending")
        .execute()
    )
    return bool(response.data)


def complete_job(job_id: str) -> None:
    """Mark a job as completed."""
    (
        get_supabase_client()
        .table("job_queue")
        .update({"status": "completed"})
        .eq("id", job_id)
        .execute()
    )


def fail_job(job_id: str, error: str, attempts: int, max_attempts: int) -> None:
    """Mark a job as failed or return it to pending for retry."""
    new_status = "failed" if attempts >= max_attempts else "pending"
    (
        get_supabase_client()
        .table("job_queue")
        .update({"status": new_status, "attempts": attempts, "error": error[:2000]})
        .eq("id", job_id)
        .execute()
    )


def get_due_jobs(limit: int = 20) -> list[dict[str, Any]]:
    """Fetch pending jobs that are due to run, ordered by run_at."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    response = (
        get_supabase_client()
        .table("job_queue")
        .select("*")
        .eq("status", "pending")
        .lte("run_at", now)
        .order("run_at")
        .limit(limit)
        .execute()
    )
    return response.data or []


# ── Lead Pipeline ──────────────────────────────────────────────────────────────

def create_lead(
    business_id: str,
    *,
    name: str,
    email: str | None = None,
    phone: str | None = None,
    stage: str = "new_enquiry",
    source: str = "email",
    enquiry_type: str | None = None,
    notes: str | None = None,
    thread_id: str | None = None,
    approval_id: str | None = None,
    follow_up_due_at: str | None = None,
) -> dict[str, Any] | None:
    data: dict[str, Any] = {
        "business_id": business_id,
        "name": name,
        "stage": stage,
        "source": source,
    }
    if email:
        data["email"] = email
    if phone:
        data["phone"] = phone
    if enquiry_type:
        data["enquiry_type"] = enquiry_type
    if notes:
        data["notes"] = notes
    if thread_id:
        data["thread_id"] = thread_id
    if approval_id:
        data["approval_id"] = approval_id
    if follow_up_due_at:
        data["follow_up_due_at"] = follow_up_due_at

    response = (
        get_supabase_client()
        .table("lead_pipeline")
        .insert(data)
        .execute()
    )
    return _normalise_row(response.data)


def get_leads(
    business_id: str,
    *,
    stage: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_client()
        .table("lead_pipeline")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if stage:
        query = query.eq("stage", stage)
    return query.execute().data or []


def get_lead(business_id: str, lead_id: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("lead_pipeline")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", lead_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def get_lead_by_thread_id(business_id: str, thread_id: str) -> dict[str, Any] | None:
    """Return a lead linked to a Gmail thread ID."""
    response = (
        get_supabase_client()
        .table("lead_pipeline")
        .select("*")
        .eq("business_id", business_id)
        .eq("thread_id", thread_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def get_lead_by_email(business_id: str, email: str) -> dict[str, Any] | None:
    """Return the latest lead for an email address, case-insensitively."""
    response = (
        get_supabase_client()
        .table("lead_pipeline")
        .select("*")
        .eq("business_id", business_id)
        .ilike("email", email)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def update_lead(
    business_id: str,
    lead_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("lead_pipeline")
        .update(updates)
        .eq("business_id", business_id)
        .eq("id", lead_id)
        .execute()
    )
    return _normalise_row(response.data)


def create_or_link_lead_from_email(
    business_id: str,
    *,
    name: str,
    email: str | None,
    thread_id: str | None,
    approval_id: str | None,
    subject: str,
    snippet: str,
) -> tuple[dict[str, Any] | None, bool]:
    """Create a lead for a new-lead email, or link the email to an existing lead.

    Returns (lead, created). Existing leads are matched by Gmail thread first,
    then sender email. This keeps repeated webhook deliveries and follow-up
    replies from creating duplicate pipeline cards.
    """
    clean_email = (email or "").strip()
    clean_thread_id = (thread_id or "").strip()

    existing = None
    if clean_thread_id:
        existing = get_lead_by_thread_id(business_id, clean_thread_id)
    if not existing and clean_email:
        existing = get_lead_by_email(business_id, clean_email)

    if existing:
        updates: dict[str, Any] = {}
        if clean_thread_id and not existing.get("thread_id"):
            updates["thread_id"] = clean_thread_id
        if approval_id and not existing.get("approval_id"):
            updates["approval_id"] = approval_id
        if clean_email and not existing.get("email"):
            updates["email"] = clean_email
        if updates:
            return update_lead(business_id, str(existing["id"]), updates), False
        return existing, False

    notes = f"Auto-created from Gmail new lead: {subject}"
    if snippet:
        notes = f"{notes}\n\n{snippet[:500]}"

    lead = create_lead(
        business_id,
        name=name or clean_email or "New lead",
        email=clean_email or None,
        source="email",
        enquiry_type="new_lead",
        notes=notes,
        thread_id=clean_thread_id or None,
        approval_id=approval_id,
    )
    return lead, True


def get_lead_pipeline_summary(business_id: str) -> dict[str, Any]:
    """Return counts per stage plus narrative data for the Home screen."""
    from datetime import datetime, timezone, timedelta

    leads = get_leads(business_id, limit=500)
    now = datetime.now(timezone.utc)

    active_stages = [l for l in leads if l.get("stage") not in ("won", "lost")]
    stage_counts: dict[str, int] = {}
    for lead in active_stages:
        s = lead.get("stage", "new_enquiry")
        stage_counts[s] = stage_counts.get(s, 0) + 1

    # Stale quotes: quote_sent leads created more than 5 days ago
    stale_quotes = sum(
        1 for l in leads
        if l.get("stage") == "quote_sent"
        and l.get("created_at")
        and (now - datetime.fromisoformat(l["created_at"].replace("Z", "+00:00"))).days > 5
    )

    # Unreplied enquiries: new_enquiry leads older than 24 hours
    unreplied_enquiries = sum(
        1 for l in leads
        if l.get("stage") == "new_enquiry"
        and l.get("created_at")
        and (now - datetime.fromisoformat(l["created_at"].replace("Z", "+00:00"))).total_seconds() > 86400
    )

    # Conversion this month: won / (won + lost) for leads created this calendar month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_leads = [
        l for l in leads
        if l.get("created_at")
        and datetime.fromisoformat(l["created_at"].replace("Z", "+00:00")) >= month_start
    ]
    won_this_month = sum(1 for l in month_leads if l.get("stage") == "won")
    closed_this_month = sum(1 for l in month_leads if l.get("stage") in ("won", "lost"))

    return {
        "total_active": len(active_stages),
        "by_stage": stage_counts,
        "new_enquiries": stage_counts.get("new_enquiry", 0),
        "quotes_pending": stage_counts.get("quote_sent", 0),
        "stale_quotes": stale_quotes,
        "unreplied_enquiries": unreplied_enquiries,
        "won_this_month": won_this_month,
        "closed_this_month": closed_this_month,
    }


# ── Outcomes Summary ─────────────────────────────────────────────────────────

def _parse_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_customer_email_approval(row: dict[str, Any]) -> bool:
    approval_type = str(row.get("type") or "")
    original_email_id = str(row.get("original_email_id") or "")
    if approval_type not in {"email_reply", "booking_reply"}:
        return False
    return not original_email_id.startswith(("xero_invoice:", "missed_response:"))


def build_outcomes_summary(
    *,
    approvals: list[dict[str, Any]],
    jobs: list[dict[str, Any]],
    leads: list[dict[str, Any]],
    since: datetime,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build rolling proof-of-value metrics from existing persisted records."""
    until = now or datetime.now(timezone.utc)
    since_utc = since.astimezone(timezone.utc) if since.tzinfo else since.replace(tzinfo=timezone.utc)
    until_utc = until.astimezone(timezone.utc) if until.tzinfo else until.replace(tzinfo=timezone.utc)

    approved_email_actions = 0
    quotes_sent = 0
    response_hours: list[float] = []

    for approval in approvals:
        if str(approval.get("status") or "") != "approved":
            continue
        approved_at = _parse_utc_datetime(approval.get("when_ts"))
        if not approved_at or approved_at < since_utc:
            continue

        approval_type = str(approval.get("type") or "")
        if _is_customer_email_approval(approval):
            approved_email_actions += 1
            created_at = _parse_utc_datetime(approval.get("created_at"))
            if created_at and approved_at >= created_at:
                response_hours.append((approved_at - created_at).total_seconds() / 3600)

        if approval_type == "send_quote":
            quotes_sent += 1

    completed_jobs = []
    for job in jobs:
        completed_at = _parse_utc_datetime(job.get("updated_at")) or _parse_utc_datetime(job.get("created_at"))
        if str(job.get("status") or "") == "completed" and completed_at and completed_at >= since_utc:
            completed_jobs.append(job)
    follow_ups_sent = sum(1 for job in completed_jobs if job.get("job_type") == "follow_up_email")
    invoices_chased = sum(1 for job in completed_jobs if job.get("job_type") == "chase_invoice")

    leads_created = 0
    for lead in leads:
        created_at = _parse_utc_datetime(lead.get("created_at"))
        if str(lead.get("source") or "") == "email" and created_at and created_at >= since_utc:
            leads_created += 1

    avg_response_time_hours = round(sum(response_hours) / len(response_hours), 1) if response_hours else 0.0
    total_admin_tasks = (
        approved_email_actions
        + follow_ups_sent
        + invoices_chased
        + quotes_sent
        + leads_created
    )

    return {
        "window_days": max(1, (until_utc.date() - since_utc.date()).days),
        "since": since_utc.isoformat(),
        "until": until_utc.isoformat(),
        "total_admin_tasks": total_admin_tasks,
        "emails_triaged": approved_email_actions,
        "follow_ups_sent": follow_ups_sent,
        "invoices_chased": invoices_chased,
        "quotes_sent": quotes_sent,
        "avg_response_time_hours": avg_response_time_hours,
        "leads_created": leads_created,
    }


def get_outcomes_summary(business_id: str, *, window_days: int = 30) -> dict[str, Any]:
    """Return rolling outcome metrics for the authenticated business."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=window_days)
    since_iso = since.isoformat()
    supabase = get_supabase_client()

    approvals = (
        supabase
        .table("approvals")
        .select("id,type,status,original_email_id,created_at,when_ts")
        .eq("business_id", business_id)
        .eq("status", "approved")
        .gte("when_ts", since_iso)
        .execute()
        .data
        or []
    )
    jobs = (
        supabase
        .table("job_queue")
        .select("id,job_type,status,created_at,updated_at")
        .eq("business_id", business_id)
        .eq("status", "completed")
        .gte("updated_at", since_iso)
        .execute()
        .data
        or []
    )
    leads = (
        supabase
        .table("lead_pipeline")
        .select("id,source,created_at")
        .eq("business_id", business_id)
        .eq("source", "email")
        .gte("created_at", since_iso)
        .execute()
        .data
        or []
    )

    return build_outcomes_summary(
        approvals=approvals,
        jobs=jobs,
        leads=leads,
        since=since,
        now=now,
    )


# ── First-customer workspace records ─────────────────────────────────────────

def get_workspace_jobs(business_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_client()
        .table("workspace_jobs")
        .select("*")
        .eq("business_id", business_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return response.data or []


def get_workspace_job(business_id: str, job_id: str) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("workspace_jobs")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", job_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def create_workspace_job(business_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    row = {"business_id": business_id, **data}
    response = get_supabase_client().table("workspace_jobs").insert(row).execute()
    return _normalise_row(response.data)


def update_workspace_job(
    business_id: str,
    job_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("workspace_jobs")
        .update(updates)
        .eq("business_id", business_id)
        .eq("id", job_id)
        .execute()
    )
    return _normalise_row(response.data)


def get_workspace_messages(business_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_client()
        .table("workspace_messages")
        .select("*")
        .eq("business_id", business_id)
        .eq("status", "active")
        .order("updated_at", desc=True)
        .execute()
    )
    return response.data or []


def create_workspace_message(business_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    row = {"business_id": business_id, **data}
    response = get_supabase_client().table("workspace_messages").insert(row).execute()
    return _normalise_row(response.data)


def get_workspace_message_by_source_email(
    business_id: str,
    source_email_id: str,
) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("workspace_messages")
        .select("*")
        .eq("business_id", business_id)
        .eq("source_email_id", source_email_id)
        .limit(1)
        .execute()
    )
    return _normalise_row(response.data)


def update_workspace_message(
    business_id: str,
    message_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("workspace_messages")
        .update(updates)
        .eq("business_id", business_id)
        .eq("id", message_id)
        .execute()
    )
    return _normalise_row(response.data)


def get_workspace_actions(business_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_client()
        .table("workspace_actions")
        .select("*")
        .eq("business_id", business_id)
        .neq("status", "archived")
        .order("updated_at", desc=True)
        .execute()
    )
    return response.data or []


def create_workspace_action(business_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    row = {"business_id": business_id, **data}
    response = get_supabase_client().table("workspace_actions").insert(row).execute()
    return _normalise_row(response.data)


def update_workspace_action(
    business_id: str,
    action_id: str,
    updates: dict[str, Any],
) -> dict[str, Any] | None:
    response = (
        get_supabase_client()
        .table("workspace_actions")
        .update(updates)
        .eq("business_id", business_id)
        .eq("id", action_id)
        .execute()
    )
    return _normalise_row(response.data)
