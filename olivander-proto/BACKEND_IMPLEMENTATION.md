# Olivander Backend - PRD Implementation Guide

## Overview

The backend has been updated to fully support the Olivander MVP PRD. This document outlines what's been implemented and what's ready for testing.

## ✅ Implemented Features

### 1. Database Schema (`/db/schema.sql`)
- **5 core tables**: `businesses`, `approvals`, `memory`, `activity`, `oauth_states`
- **Row-level security (RLS)**: Enforced on all business-related tables
- **Indexes**: Optimized for common queries
- **Migration file**: `/db/migrations/001_initial_schema.sql` for reference

**Table Structure:**
- `businesses`: Core tenant data with Google OAuth tokens
- `approvals`: Email drafts pending owner approval (Tier 3)
- `memory`: Key-value context store (business name, pricing, tone, etc.)
- `activity`: Audit log of all actions and events
- `oauth_states`: Temporary OAuth flow state tokens

### 2. Gmail Integration (`/gmail/`)

#### client.py
- `get_message()`: Fetch a single message metadata
- `list_recent_messages()`: List recent/unread emails
- `get_thread()`: **NEW** - Fetch all messages in a thread
- `send_message()`: Send emails via Gmail API (with thread support)

#### webhook.py
- Receives Pub/Sub notifications from Gmail
- **NEW**: Classifies emails using Groq
- **NEW**: Drafts replies using business context
- **NEW**: Creates approval queue entries
- **NEW**: Logs all activity for audit trail
- Background processing: Async task scheduling

### 3. API Endpoints (`/main.py` + `/api/actions.py`)

#### Authentication & Memory
- `GET /api/memory` - Retrieve business context
- `POST /api/memory` - Update memory values
- `GET /api/connections` - Get connection status
- `POST /api/connections/google/disconnect` - Revoke Gmail access

#### Email Management
- `GET /gmail/recent` - List recent emails (10-25 results)
- `GET /api/emails` - List inbox/unread emails
- `POST /api/emails/{email_id}/action` - Send email reply (manual)

#### Approvals (NEW)
- `GET /api/approvals` - List all pending/approved/rejected approvals
- `GET /api/approvals/{approval_id}` - Get approval details
- `POST /api/approvals/{approval_id}/approve` - Approve and send email
- `POST /api/approvals/{approval_id}/reject` - Reject with reason
- `PATCH /api/approvals/{approval_id}/edit` - Edit draft before sending

#### Agent Planning
- `POST /api/agent/plan` - Generate task execution plan with drafts

### 4. Agent & AI (`/agent/`)

#### classify.py
- Email classification: `booking_request`, `invoice_query`, `general_reply`, `new_client_enquiry`, `ignore`
- Uses Groq LLM with low temperature (0.1) for consistency

#### draft.py
- Email reply drafting with business context
- Respects business tone, pricing, payment terms
- Generates task execution plans with steps
- Fallback to default plans if Groq fails

### 5. Database Functions (`/db/supabase.py`)

**New functions:**
- `create_approval()` - Create pending approval
- `get_approval_by_id()` - Fetch approval details
- `update_approval_status()` - Mark approved/rejected/edited
- `log_activity()` - Log actions to audit trail
- `get_approvals_for_business()` - List approvals with optional filtering
- `get_business_by_email()` - Used by webhook to find business by Gmail address

## 📋 Data Flow: Email to Approval

```
Gmail Inbox
    ↓
Google Pub/Sub Notification
    ↓
POST /webhook/gmail (verification token check)
    ↓
Background Task (_process_gmail_notification)
    ├→ Get business by email
    ├→ Fetch latest unread message
    ├→ Get full thread with get_thread()
    ├→ Classify email: classify_email()
    ├→ Skip if 'ignore', log activity
    ├→ Get business context from memory
    ├→ Draft reply: draft_reply()
    └→ Create approval in DB
    
Approval in DB
    ↓
Frontend fetches: GET /api/approvals
    ↓
Owner views draft, can approve/reject/edit
    ├→ APPROVE: POST /api/approvals/{id}/approve
    │   └→ Sends email, marks approved, logs activity
    ├→ REJECT: POST /api/approvals/{id}/reject
    │   └→ Marks rejected, logs reason
    └→ EDIT: PATCH /api/approvals/{id}/edit
        └→ Updates draft, keeps pending
```

## 🚀 Quick Start

### 1. Set up database in Supabase
Go to your Supabase dashboard → SQL Editor and run:

```sql
-- Paste entire contents of /backend/db/schema.sql
```

Or use the migration file:
```sql
-- Paste entire contents of /backend/db/migrations/001_initial_schema.sql
```

### 2. Configure environment variables (.env)
```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
FRONTEND_ORIGIN=http://localhost:5173
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-key
GROQ_API_KEY=your-groq-api-key
JWT_SECRET=generated-secret
ENCRYPTION_KEY=generated-key
WEBHOOK_SECRET=generated-secret
```

### 3. Start the backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Backend runs on `http://localhost:8000`

### 4. Test the workflow

#### Step 1: Authenticate
```bash
# Browser: http://localhost:8000/auth/google/login
# Redirects to Google OAuth, then back to frontend
```

#### Step 2: Send a test email to your Gmail
Send an email to the Gmail inbox connected via OAuth

#### Step 3: Trigger webhook (local testing)
For local dev without Pub/Sub, manually POST to webhook:
```bash
curl -X POST "http://localhost:8000/webhook/gmail?token=YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbEFkZHJlc3MiOiJ5b3VyQGdtYWlsLmNvbSIsImhpc3RvcnlJZCI6IjEyMzQ1In0="
    }
  }'
```

The base64 payload decodes to:
```json
{"emailAddress": "your@gmail.com", "historyId": "12345"}
```

#### Step 4: Check approvals
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:8000/api/approvals
```

#### Step 5: Approve an email
```bash
curl -X POST "http://localhost:8000/api/approvals/{approval_id}/approve" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🔧 Configuration

### Business Context Memory Keys
Store these in the `memory` table to customize behavior:

```
business_name        → Used in drafts and business context
business_type        → Industry (e.g., "travel agency", "consulting")
owner_email          → For sending approvals (auto-filled from businesses table)
reply_tone           → How to write emails (e.g., "warm, professional, brief")
pricing_range        → Include in email drafts
payment_terms        → Payment policy (e.g., "Due on receipt")
services             → List of services offered
location             → Business location (NZ default)
gst_registered       → For NZ tax details
reschedule_policy    → How to handle reschedules
no_show_handling     → How to handle no-shows
notification_frequency → realtime | morning_digest | weekly (future feature)
```

### Email Classifications
The agent will classify emails as:
- `new_client_enquiry` - First contact from potential customer
- `booking_request` - Schedule/reschedule/cancel appointment
- `invoice_query` - Question about payment, pricing, or invoices
- `general_reply` - Needs response but no specific workflow
- `ignore` - Spam, newsletter, or no response needed

## 📊 Activity Log
All actions are logged to the `activity` table with metadata:

```
activity_type: string
  - email_skipped
  - approval_created
  - approval_executed
  - approval_rejected
  - approval_edited

metadata: JSONB
  - gmail_message_id
  - approval_id
  - classification
  - to_email
  - reason (for rejection)
```

## 🧪 Testing Checklist (PRD Definition of Done)

- [ ] `classify_email()` returns valid classification for real emails
- [ ] `draft_reply()` generates human-like replies
- [ ] `get_thread()` returns full conversation history
- [ ] Webhook receiver decodes Pub/Sub messages correctly
- [ ] Dedup: Same message ID doesn't create duplicate approvals
- [ ] GET /api/approvals lists all pending approvals
- [ ] POST .../approve sends email and marks approved
- [ ] POST .../reject stores reason and marks rejected
- [ ] PATCH .../edit updates draft content
- [ ] Activity log tracks all events
- [ ] Error handling: Invalid tokens return 403/401
- [ ] Unknown Gmail addresses log and return 200 (not error)

## 🔐 Security

- **RLS Enabled**: Businesses can only see their own data
- **JWT Auth**: All business endpoints require valid token
- **Webhook Verification**: HMAC-SHA256 token check on POST /webhook/gmail
- **Token Encryption**: OAuth tokens encrypted before storage
- **Rate Limiting**: 60 req/min for most endpoints, 100/min for webhooks

## 📝 Notes

1. **Background Processing**: Email classification and drafting happens async in the webhook handler. The webhook returns immediately (200 OK).

2. **Tier 3 Approval System**: All email approvals default to tier=3, meaning explicit owner sign-off required before sending.

3. **Email Threading**: The `get_thread()` function fetches full conversation history. Replies are sent with `threadId` to keep conversations in the same thread.

4. **Groq Model**: Uses `llama-3.3-70b-versatile` for both classification (temperature=0.1) and drafting (temperature=0.4).

5. **Database Migrations**: New migrations should be added to `/db/migrations/` with sequential numbering (001_, 002_, etc.).

## 🐛 Troubleshooting

### Webhook not processing emails
1. Check `WEBHOOK_SECRET` matches in POST query param
2. Verify Gmail address exists in `businesses` table
3. Check logs for `_process_gmail_notification` errors
4. Ensure Groq API key is valid

### Approvals not visible
1. Check business_id JWT claim matches
2. Verify RLS policies are enabled on approvals table
3. Check approvals were created in activity log

### Email send fails
1. Verify access_token is valid (not expired/revoked)
2. Check original_email_id still exists in Gmail
3. Verify to_email is valid

---

**Last Updated**: April 2026  
**Backend Status**: ✅ PRD Complete - Ready for end-to-end testing
