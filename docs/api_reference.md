# Olivander API Reference

## Base URL
- Local: `http://localhost:8000`
- Production: `https://olivander.onrender.com` (Render)

## Authentication
All endpoints require JWT token in header:
```
Authorization: Bearer {jwt_token}
```

Get JWT token from Google OAuth callback - stored in frontend localStorage.

---

## Approvals (New)

### List Approvals
```
GET /api/approvals?status=pending
```
**Query Parameters:**
- `status` (optional): `pending`, `approved`, `rejected`

**Response:**
```json
[
  {
    "id": "uuid",
    "status": "pending",
    "type": "email_reply",
    "who": "sender@example.com",
    "what": "Reply to: Subject line",
    "why": "Classified as new_client_enquiry",
    "draft_content": "Email body...",
    "edited_content": null,
    "created_at": "2026-04-10T10:30:00Z",
    "when_ts": null
  }
]
```

### Get Approval Details
```
GET /api/approvals/{approval_id}
```

**Response:** Same as above (single object)

### Approve & Send Email
```
POST /api/approvals/{approval_id}/approve
```

**Request:** (no body required)

**Response:**
```json
{
  "status": "approved",
  "approval_id": "uuid",
  "sent_to": "recipient@example.com",
  "sent_at": "2026-04-10T10:31:00Z"
}
```

**Status codes:**
- `200` - Successfully sent
- `404` - Approval not found
- `403` - Unauthorized (not your approval)
- `409` - Already handled (previously approved/rejected)

### Reject Approval
```
POST /api/approvals/{approval_id}/reject
Content-Type: application/json

{
  "action": "reject",
  "rejection_reason": "Need to update pricing info"
}
```

**Response:**
```json
{
  "status": "rejected",
  "approval_id": "uuid",
  "reason": "Need to update pricing info"
}
```

### Edit Draft
```
PATCH /api/approvals/{approval_id}/edit
Content-Type: application/json

{
  "action": "edit",
  "edited_content": "New email body..."
}
```

**Response:**
```json
{
  "status": "edited",
  "approval_id": "uuid",
  "edited_at": "2026-04-10T10:32:00Z",
  "edited_content": "New email body..."
}
```

### Missed Response Approvals

Delayed Gmail checks can create approvals with:

```json
{
  "type": "missed_response",
  "subject": "Missed response - Customer subject",
  "agentResponse": "Review the original pending draft...",
  "tier": "Tier 3 — owner approval required"
}
```

Approving a `missed_response` approval marks it handled and sends no email. Rejecting it dismisses the flag.

---

## Invoices

### List Unpaid Xero Invoices
```
GET /api/invoices/unpaid
```

Queries Xero live for authorised sales invoices with an outstanding balance.

**Response:**
```json
{
  "invoices": [
    {
      "invoice_id": "uuid",
      "invoice_number": "INV-001",
      "contact_name": "Customer Ltd",
      "contact_email": "accounts@example.co.nz",
      "amount_due": 240.0,
      "currency_code": "NZD",
      "due_date": "2026-05-01",
      "days_overdue": 4,
      "status": "AUTHORISED"
    }
  ],
  "count": 1,
  "total_due": 240.0,
  "currency_code": "NZD"
}
```

### Queue Manual Invoice Reminder
```
POST /api/invoices/{invoice_id}/reminder
Content-Type: application/json

{
  "note": "Optional owner instruction for the draft"
}
```

Fetches the invoice from Xero live, drafts a payment reminder, and queues it as an approval. Nothing is sent until the owner approves.

**Response:**
```json
{
  "status": "pending_approval",
  "approval_id": "uuid",
  "invoice": {
    "invoice_id": "uuid",
    "invoice_number": "INV-001",
    "contact_name": "Customer Ltd",
    "amount_due": 240.0
  }
}
```

**Status codes:**
- `200` - Reminder approval queued
- `401` - Xero is not connected
- `409` - Invoice has no outstanding balance, is not authorised, or a reminder/chaser is already pending
- `422` - Xero contact has no email address

---

## Leads

### List Leads
```
GET /api/leads?stage=new_enquiry
```

`stage` is optional. Valid stages: `new_enquiry`, `contacted`, `quote_sent`, `quote_accepted`, `won`, `lost`.

### Pipeline Summary
```
GET /api/leads/summary
```

Returns active lead counts for dashboard badges and summary panels.

### Create Lead
```
POST /api/leads
Content-Type: application/json

{
  "name": "Customer Ltd",
  "email": "hello@example.co.nz",
  "source": "manual",
  "enquiry_type": "service_enquiry",
  "thread_id": "gmail-thread-id"
}
```

Gmail webhook processing also creates or links leads automatically when an inbound email is classified as `new_lead`. Dedup order is Gmail `thread_id`, then sender email.

---

## Memory / Business Context

### Get Business Context
```
GET /api/memory
```

**Response:**
```json
{
  "business_name": "Acme Tours",
  "owner_email": "owner@acme.com",
  "business_type": "Travel Agency",
  "pricing_range": "$500-$5000",
  "payment_terms": "30 days",
  "reply_tone": "Warm, friendly, professional",
  "gst_registered": "Yes",
  "services": "Tour packages, booking, consulting",
  "location": "Queenstown, NZ"
}
```

### Update Memory Value
```
POST /api/memory
Content-Type: application/json

{
  "key": "business_name",
  "value": "Acme Tours"
}
```

**Response:**
```json
{
  "success": true
}
```

**Common Keys:**
- `business_name`
- `business_type`
- `owner_email`
- `reply_tone`
- `pricing_range`
- `payment_terms`
- `services`
- `location`
- `gst_registered`

---

## Emails

### List Recent Emails
```
GET /api/emails?max_results=10
```

**Query Parameters:**
- `max_results` (optional, 1-25, default 10)

**Response:**
```json
[
  {
    "id": "gmail_message_id",
    "source": "gmail",
    "senderName": "John Smith",
    "senderEmail": "john@example.com",
    "subject": "Booking inquiry",
    "body": "Hi, I'd like to...",
    "snippet": "Hi, I'd like to...",
    "date": "2026-04-10T09:15:00Z",
    "classification": null,
    "requiresApproval": false,
    "suggestedReply": ""
  }
]
```

### Send Email (Manual)
```
POST /api/emails/{email_id}/action
Content-Type: application/json

{
  "action": "send",
  "reply": "Thanks for reaching out! Here's..."
}
```

**Response:**
```json
{
  "success": true,
  "email_id": "gmail_message_id",
  "sent_at": "2026-04-10T10:35:00Z",
  "gmail": {}
}
```

---

## Connections

### Get Connection Status
```
GET /api/connections
```

**Response:**
```json
{
  "google": true,
  "contact_name": "Owner Name",
  "business_name": "Acme Tours",
  "email": "owner@acme.com"
}
```

### Disconnect Google
```
POST /api/connections/google/disconnect
```

**Response:**
```json
{
  "success": true,
  "google": false
}
```

---

## Agent Planning

### Generate Task Plan
```
POST /api/agent/plan
Content-Type: application/json

{
  "request": "Write a follow-up email to a customer who booked a tour",
  "source_email": {
    "id": "message_id",
    "senderName": "John Smith",
    "senderEmail": "john@example.com",
    "subject": "Booking confirmation?",
    "body": "Hi, just following up...",
    "date": "2026-04-10T08:00:00Z"
  },
  "review_feedback": null
}
```

**Response:**
```json
{
  "name": "Write follow-up email",
  "steps": [
    {
      "title": "Confirm the context",
      "detail": "Review what happened in the booking and why they're following up.",
      "tone": "next"
    },
    {
      "title": "Draft the reply",
      "detail": "Write a warm, helpful response that addresses their concern.",
      "tone": "queued"
    },
    {
      "title": "Review for tone",
      "detail": "Make sure it sounds like the owner, not a template.",
      "tone": "review"
    }
  ],
  "draftPreview": {
    "label": "Writing email",
    "text": "Hi John,\n\nThanks for your follow-up. Here's..."
  },
  "planSummary": null,
  "clarifyingQuestion": null
}
```

---

## Webhooks

### Gmail Push Webhook
```
POST /webhook/gmail?token={WEBHOOK_SECRET}
Content-Type: application/json

{
  "message": {
    "messageId": "pub-sub-message-id",
    "data": "base64-encoded-json",
    "attributes": {}
  },
  "subscription": "pub-sub-subscription-name"
}
```

**Data (base64 decoded):**
```json
{
  "emailAddress": "owner@gmail.com",
  "historyId": "12345"
}
```

**Response:**
```json
{
  "received": true,
  "message_id": "pub-sub-message-id",
  "subscription": "pub-sub-subscription-name"
}
```

**Status codes:**
- `200` - Accepted (processing in background)
- `400` - Bad payload
- `403` - Invalid token

---

## Health Check

### Status
```
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "detail": "Error message here"
}
```

**Common Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad request (invalid data)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (not your resource)
- `404` - Not found
- `409` - Conflict (already handled)
- `500` - Server error
- `502` - Gmail API error
- `503` - Service unavailable

---

## Rate Limiting

- Default: 60 requests/minute per endpoint
- Webhooks: 100 requests/minute

Response header: `RateLimit-Remaining`

---

## Pagination

Currently no pagination. All list endpoints return full results.

Future: Limit to 100, with cursor-based pagination.

---

## Timestamps

All timestamps are ISO 8601 format in UTC:
```
2026-04-10T10:30:00Z
```

---

## Examples

### Full Approval Workflow

**1. Get list of pending approvals:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/approvals?status=pending
```

**2. View details:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/approvals/{id}
```

**3. Edit the draft:**
```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"edit","edited_content":"New body..."}' \
  http://localhost:8000/api/approvals/{id}/edit
```

**4. Approve and send:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/approvals/{id}/approve
```

---

**Last Updated**: April 10, 2026  
**Version**: 1.0 (MVP)
