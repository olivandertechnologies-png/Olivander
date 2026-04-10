# Testing Guide - Olivander Backend

## Pre-Flight Checklist

Before testing, verify:
- ✅ `.env` file configured in `/backend/.env`
- ✅ Supabase schema imported (`schema.sql`)
- ✅ Backend dependencies installed (`pip install -r requirements.txt`)
- ✅ Gmail OAuth client ID/secret valid
- ✅ Groq API key valid

---

## Phase 1: Local Setup & Auth

### 1.1 Start Backend
```bash
cd backend
python -m uvicorn main:app --reload
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
INFO:     Supabase connected
```

### 1.2 Test Health Check
```bash
curl http://localhost:8000/health
```

Expected:
```json
{"status": "ok"}
```

### 1.3 Test Google OAuth Flow
1. Open browser: `http://localhost:5173` (frontend)
2. Click "Connect Gmail"
3. You should be redirected to Google login
4. Grant permissions
5. Should redirect back to frontend
6. Check Supabase `businesses` table for your entry

✅ If successful:
- JWT token in localStorage
- Business record in Supabase
- OAuth tokens encrypted

❌ If fails:
- Check Google OAuth credentials in `.env`
- Verify redirect URI is `http://localhost:8000/auth/google/callback`
- Check logs for specific error

---

## Phase 2: Gmail Integration

### 2.1 Test Send Real Email
Send a test email to your Gmail inbox from another account:
```
To: your-gmail@gmail.com
Subject: Testing Olivander
Body: Hi, this is a test email for the workflow.
```

### 2.2 Manual Webhook Test (Local Dev)
Since Pub/Sub won't work locally, trigger webhook manually:

First, create base64 payload:
```bash
echo -n '{"emailAddress":"your-gmail@gmail.com","historyId":"12345"}' | base64
```

Then POST to webhook:
```bash
curl -X POST "http://localhost:8000/webhook/gmail?token=$(grep WEBHOOK_SECRET ../.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "YOUR_BASE64_FROM_ABOVE"
    }
  }'
```

Expected response:
```json
{"received": true, "message_id": null, "subscription": null}
```

Check logs for:
```
INFO: No recent messages for {business_id}
```

If email was there, should see:
```
INFO: Approval queued for email from sender@example.com
```

✅ Signs of success:
- Approval created in Supabase `approvals` table
- Activity logged in `activity` table
- Draft content generated

❌ Troubleshooting:
- Check `get_valid_token()` - ensure access token isn't expired
- Check Groq API key - classification may fail
- Check memory table - missing context will affect draft

---

## Phase 3: Approval Workflow

### 3.1 Get Your JWT Token
From frontend localStorage:
```javascript
localStorage.getItem('authToken')
```
Or from auth callback logs.

### 3.2 List Pending Approvals
```bash
TOKEN="your-jwt-token"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/approvals?status=pending
```

Expected:
```json
[
  {
    "id": "uuid",
    "status": "pending",
    "type": "email_reply",
    "who": "sender@example.com",
    "what": "Reply to: Subject",
    "why": "Classified as ...",
    "draft_content": "Email body...",
    "created_at": "2026-04-10T...",
    "when_ts": null
  }
]
```

✅ If you see approvals:
- Webhook processing worked
- Email classification worked
- Draft generation worked

❌ If empty:
- Check webhook was triggered
- Check Supabase `approvals` table directly
- Check logs for errors in `_process_gmail_notification`

### 3.3 Get Approval Details
```bash
APPROVAL_ID="the-uuid-from-above"
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/approvals/$APPROVAL_ID
```

### 3.4 Edit the Draft
```bash
curl -X PATCH "http://localhost:8000/api/approvals/$APPROVAL_ID/edit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "edit",
    "edited_content": "Thanks for reaching out! Here is my edited response..."
  }'
```

Expected:
```json
{
  "status": "edited",
  "approval_id": "...",
  "edited_at": "2026-04-10T...",
  "edited_content": "Thanks for reaching out!..."
}
```

✅ Check Supabase - approval.edited_content should be updated

### 3.5 Approve & Send Email
```bash
curl -X POST "http://localhost:8000/api/approvals/$APPROVAL_ID/approve" \
  -H "Authorization: Bearer $TOKEN"
```

Expected:
```json
{
  "status": "approved",
  "approval_id": "...",
  "sent_to": "original-sender@example.com",
  "sent_at": "2026-04-10T..."
}
```

✅ Verify:
- Check Gmail Sent folder - email should be there
- Check Supabase `approvals` - status should be "approved"
- Check `activity` table - should have entry type "approval_executed"

❌ If send fails:
- Check access_token is valid (may have expired)
- Check original_email_id is correct
- Check recipient email is valid

### 3.6 Test Rejection
```bash
curl -X POST "http://localhost:8000/api/approvals/$APPROVAL_ID/reject" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "reject",
    "rejection_reason": "Need to verify pricing first"
  }'
```

Expected:
```json
{
  "status": "rejected",
  "approval_id": "...",
  "reason": "Need to verify pricing first"
}
```

✅ Verify:
- Approval status changed to "rejected"
- Activity logged with reason

---

## Phase 4: Context & Personalization

### 4.1 Get Current Memory
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/memory
```

### 4.2 Set Business Context
```bash
curl -X POST "http://localhost:8000/api/memory" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "business_type",
    "value": "Travel Agency"
  }'
```

Set multiple values:
```bash
for key in "business_name:Acme Tours" \
           "pricing_range:\$500-\$5000" \
           "payment_terms:30 days" \
           "reply_tone:Warm and professional"
do
  k=${key%:*}
  v=${key#*:}
  curl -X POST "http://localhost:8000/api/memory" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$k\",\"value\":\"$v\"}"
done
```

### 4.3 Send Another Email & Check Draft
Send a new test email, trigger webhook again, and verify the draft uses your context:
- Should mention business name
- Should use correct tone
- Should reference pricing/payment terms if relevant

---

## Phase 5: Error Cases

### 5.1 Test Invalid Token
```bash
curl -H "Authorization: Bearer invalid-token" \
  http://localhost:8000/api/approvals
```

Expected: `401 Unauthorized`

### 5.2 Test Other User's Approval
1. Create approval as User A
2. Switch to User B token
3. Try to access approval

Expected: `403 Forbidden`

### 5.3 Test Double Approval
```bash
# First approval
curl -X POST "http://localhost:8000/api/approvals/$APPROVAL_ID/approve" \
  -H "Authorization: Bearer $TOKEN"

# Second approval (should fail gracefully)
curl -X POST "http://localhost:8000/api/approvals/$APPROVAL_ID/approve" \
  -H "Authorization: Bearer $TOKEN"
```

Expected (second): 
```json
{
  "status": "already_handled",
  "current_status": "approved"
}
```

### 5.4 Test Webhook Token Validation
```bash
# Wrong token
curl -X POST "http://localhost:8000/webhook/gmail?token=wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":"eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGdtYWlsLmNvbSIsImhpc3RvcnlJZCI6IjEyMzQ1In0="}}'
```

Expected: `403 Forbidden`

---

## Phase 6: Database Inspection

### 6.1 Check Approvals Table
In Supabase SQL Editor:
```sql
SELECT * FROM approvals ORDER BY created_at DESC LIMIT 10;
```

Verify:
- ✅ Multiple approval records
- ✅ Status values: pending, approved, rejected
- ✅ draft_content populated
- ✅ when_ts populated for approved/rejected

### 6.2 Check Activity Log
```sql
SELECT * FROM activity ORDER BY created_at DESC LIMIT 20;
```

Verify:
- ✅ Different activity types logged
- ✅ Metadata contains relevant IDs
- ✅ Timeline matches your test actions

### 6.3 Check Memory
```sql
SELECT * FROM memory WHERE business_id = 'your-uuid';
```

Verify:
- ✅ All memory values you set are there
- ✅ Can be updated and retrieved

---

## Troubleshooting Checklist

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Backend won't start | Check Python version, imports | `python -m py_compile backend/main.py` |
| 401 Unauthorized | Invalid JWT | Get fresh token from OAuth flow |
| 403 Forbidden | Wrong business_id | Check JWT payload matches approval.business_id |
| Approval not created | Webhook didn't run | Check webhook logs, trigger manually |
| Draft is generic | Missing context | Add memory values with business context |
| Email send fails | Token expired | Reconnect Gmail or get new token |
| Webhook returns 403 | Wrong token | Verify token matches WEBHOOK_SECRET in .env |
| Groq fails | API key invalid | Check GROQ_API_KEY in .env |
| Pub/Sub not working | GCP not configured | Use manual webhook testing for local dev |

---

## Success Criteria

You've successfully implemented the backend when:

- ✅ Backend starts without errors
- ✅ Health check returns 200
- ✅ Google OAuth flow completes
- ✅ Approval is created from real email
- ✅ Draft content is personalized
- ✅ Can approve and email is sent
- ✅ Can reject with reason
- ✅ Can edit draft before approval
- ✅ Activity log tracks all actions
- ✅ Error cases handled gracefully

---

## Next Steps

Once all tests pass:

1. **Frontend Integration**: Add approvals UI
2. **Pub/Sub Setup**: Configure Google Cloud Pub/Sub for production
3. **Production Deployment**: Deploy to Railway (backend) + Vercel (frontend)
4. **Monitoring**: Set up error alerts and activity logging
5. **Scale**: Test with real users, high email volume

---

**Last Updated**: April 10, 2026  
**Test Duration**: ~15-30 minutes for full workflow
