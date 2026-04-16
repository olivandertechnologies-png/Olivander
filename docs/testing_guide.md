# Phase 1 Testing Guide — Email MVP
## Complete Validation Checklist
**April 2026**

---

## Overview

This guide walks through comprehensive testing of Olivander's email system. Goal: Validate that the approval-first workflow works end-to-end with real Gmail and real user interactions.

**Estimated Time**: 4-6 hours spread across 1-2 sessions

**Prerequisites**:
- Backend running locally: `python -m uvicorn main:app --reload`
- Frontend running locally: `npm run dev` (port 5173)
- Supabase database connected and schema deployed
- Real Gmail account connected (not a test account)
- Chrome extension installed and connected (for browser testing)

---

## Phase 1: Pre-Flight Checks (30 min)

### 1.1 Backend Health

```bash
# Terminal 1: Start backend
cd backend
python -m uvicorn main:app --reload

# Terminal 2: Check health endpoint
curl http://localhost:8000/health
# Expected: 200 OK
```

✅ **Checklist**:
- [ ] Backend starts without errors
- [ ] `/health` returns 200
- [ ] No console errors in FastAPI terminal
- [ ] Port 8000 is accessible

### 1.2 Database Connection

```bash
# Check Supabase connection
curl -X GET "http://localhost:8000/api/health/db" \
  -H "Authorization: Bearer <your-jwt-token>"
```

✅ **Checklist**:
- [ ] Can connect to Supabase
- [ ] Tables exist (businesses, approvals, memory, activity, etc.)
- [ ] RLS policies are active (query returns only user's data)
- [ ] No connection timeouts

### 1.3 Environment Variables

```bash
# Verify all required env vars are set
echo $GOOGLE_CLIENT_ID
echo $SUPABASE_URL
echo $GROQ_API_KEY
echo $JWT_SECRET
```

✅ **Checklist**:
- [ ] All vars from `backend/.env` are populated
- [ ] No "undefined" or empty values
- [ ] OAuth credentials are valid (test with Google login)
- [ ] API keys are active (will test in workflow)

### 1.4 Frontend Build

```bash
cd frontend
npm run build
# Expected: zero errors, dist/ folder created
```

✅ **Checklist**:
- [ ] Frontend builds without errors
- [ ] No TypeScript errors
- [ ] Dist folder contains index.html and assets
- [ ] Dev server runs: `npm run dev`

---

## Phase 2: Auth Flow Testing (45 min)

### 2.1 Google OAuth Connection

**Steps**:
1. Open `http://localhost:5173` in browser
2. Click "Connect Gmail"
3. Complete Google OAuth flow
4. Verify redirect back to dashboard

✅ **Checklist**:
- [ ] OAuth prompt appears (Google login)
- [ ] Can authenticate with Gmail account
- [ ] Redirects back to dashboard
- [ ] Dashboard shows "Gmail Connected"
- [ ] JWT token stored in localStorage
- [ ] Token is valid (check with: `console.log(localStorage.getItem('authToken'))`)

### 2.2 Token Storage & Refresh

**Steps**:
1. In browser console: `console.log(localStorage)`
2. Verify `authToken` is present
3. Refresh page
4. Verify still authenticated (no OAuth prompt)
5. Check token in Supabase: `SELECT * FROM oauth_tokens WHERE provider='google'`

✅ **Checklist**:
- [ ] Token persists after page refresh
- [ ] Token is encrypted in database (not plaintext)
- [ ] Token refresh works (if > 1 hour old)
- [ ] User can logout and re-authenticate

### 2.3 Business Memory Setup

**Steps**:
1. On dashboard, fill in Business Profile:
   - Business name: e.g., "Acme Consulting"
   - Business type: "consulting" / "ecommerce" / etc.
   - Services: "Strategy, branding, digital marketing"
   - Tone: "Professional but friendly, direct, conversational"
   - Pricing range: "$500-$5000 per project"
   - Payment terms: "NET 30"
2. Click Save
3. Verify data persists (refresh page)

✅ **Checklist**:
- [ ] Can save business profile
- [ ] All fields save without errors
- [ ] Data persists after refresh
- [ ] Memory appears in Supabase: `SELECT * FROM memory WHERE business_id='...'`
- [ ] Tone field is used in email drafts (test later)

---

## Phase 3: Email Webhook Setup (30 min)

### 3.1 Gmail Webhook Configuration (Local Testing)

For local dev, we'll manually trigger the webhook instead of using Google Pub/Sub.

**Steps**:
1. Get your business_id from dashboard or database:
   ```sql
   SELECT id FROM businesses WHERE email='your-email@gmail.com';
   ```
2. Send a test email TO your Gmail address
3. Manually call the webhook endpoint:
   ```bash
   curl -X POST http://localhost:8000/api/gmail/webhook \
     -H "Content-Type: application/json" \
     -H "X-Goog-Signature: test-sig" \
     -d '{
       "message": {
         "data": "base64-encoded-pubsub-message"
       }
     }'
   ```

**OR** (easier for testing):
Create a test endpoint that simulates receiving an email:

```bash
curl -X POST http://localhost:8000/api/email/process \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "thread-id-from-gmail",
    "sender": "customer@example.com",
    "subject": "Booking request for next week",
    "body": "Hi, I'd like to book a consultation..."
  }'
```

✅ **Checklist**:
- [ ] Webhook endpoint is accessible
- [ ] Returns 200 OK
- [ ] No auth errors (verify JWT works)
- [ ] Backend logs show email received

### 3.2 Email Classification

**Steps**:
1. Send test email to yourself with clear subject:
   - "Booking request" (should classify as booking_request)
   - "Invoice for project X" (should classify as invoice_received)
   - "Can you help?" (should classify as new_lead)
2. Trigger webhook
3. Check Supabase: `SELECT * FROM approvals ORDER BY created_at DESC LIMIT 1`

✅ **Checklist**:
- [ ] Approval record created in database
- [ ] Classification is correct (check `classification` field)
- [ ] Summary is generated (2 sentences max)
- [ ] Urgency assigned (high/normal/low)
- [ ] `sender_is_known` is correct

### 3.3 Context Retrieval (RAG)

**Check the approval record**:
```sql
SELECT 
  id, 
  classification, 
  draft, 
  created_at 
FROM approvals 
WHERE business_id='your-id' 
ORDER BY created_at DESC LIMIT 1;
```

✅ **Checklist**:
- [ ] Draft exists (not NULL)
- [ ] Draft references business context (tone, services, etc.)
- [ ] Draft is 3-6 sentences
- [ ] Draft sounds like business owner (personalized tone)
- [ ] If missing context, includes `[OWNER INPUT NEEDED: ...]`

---

## Phase 4: Approval Workflow (1 hour)

### 4.1 View Pending Approvals (UI)

**Steps**:
1. Go to dashboard
2. Click "Approvals" or "Pending Emails" section
3. See list of pending approvals

✅ **Checklist**:
- [ ] Approval appears in UI
- [ ] Shows: sender, subject, draft text
- [ ] Shows classification tag
- [ ] Shows urgency indicator
- [ ] Shows timestamp
- [ ] Can click to expand and see full thread

### 4.2 Approval Modal/Details

**Steps**:
1. Click on approval to see details
2. Verify you see:
   - Full email thread (newest message first)
   - Classification rationale
   - Draft reply
   - Approve / Reject / Edit buttons

✅ **Checklist**:
- [ ] Modal/page opens without errors
- [ ] Full thread history visible
- [ ] Classification shown with reasoning
- [ ] Draft is readable and makes sense
- [ ] Buttons are clickable (test one by one below)

### 4.3 Edit Draft

**Steps**:
1. Click "Edit" button
2. Modify the draft (change a word, rephrase sentence)
3. Click "Save" or "Update"
4. Return to approval detail
5. Verify changes saved

✅ **Checklist**:
- [ ] Can edit draft text
- [ ] Changes persist
- [ ] Can still approve edited version
- [ ] Original draft not overwritten (audit trail)

### 4.4 Approve & Send Email

**Steps**:
1. Click "Approve" button
2. Verify confirmation dialog
3. Click "Send"
4. Wait for success message

**Then verify email was sent**:
1. Go to Gmail (real account)
2. Check Sent folder
3. Verify reply appears with correct subject (Re: Original Subject)
4. Open reply and verify it's the drafted message

✅ **Checklist**:
- [ ] Approval returns success (200 OK)
- [ ] Approval record marked as `status='approved'`
- [ ] Email appears in Gmail Sent folder
- [ ] Subject line is correct (Re: ...)
- [ ] Body matches draft
- [ ] Thread is maintained (conversation visible in Gmail)
- [ ] Activity log created: `SELECT * FROM activity WHERE approval_id='...'`

### 4.5 Reject & Reason

**Steps**:
1. Send another test email (different subject)
2. Create approval
3. Click "Reject"
4. Enter rejection reason: "Needs more context from owner"
5. Click Confirm

✅ **Checklist**:
- [ ] Approval marked as `status='rejected'`
- [ ] Reason stored in database
- [ ] Activity log shows rejection with reason
- [ ] No email sent to customer (verify Sent folder)
- [ ] Can still re-approve with edited draft

### 4.6 Approval Audit Trail

**Steps**:
```sql
SELECT * FROM activity 
WHERE business_id='your-id' 
ORDER BY created_at DESC LIMIT 10;
```

✅ **Checklist**:
- [ ] All actions logged (classify, draft, approve, reject, send)
- [ ] Timestamps accurate
- [ ] Metadata captured (classification result, draft used, etc.)
- [ ] Can trace approval journey from receipt to send

---

## Phase 5: Edge Cases & Error Handling (45 min)

### 5.1 Email with Missing Context

**Steps**:
1. Send email that requires info not in business profile
   - Example: "Can you do a custom quote for $X?"
   - But your profile doesn't specify how pricing works
2. Trigger webhook
3. Check draft for `[OWNER INPUT NEEDED: ...]` markers

✅ **Checklist**:
- [ ] Draft includes markers for missing info
- [ ] Markers are specific and actionable
- [ ] Owner can edit and add the missing info
- [ ] Email doesn't send with markers (safeguard)

### 5.2 Email from Unknown Sender

**Steps**:
1. Send email from new email address not in your customer list
2. Should classify as "new_lead"
3. Check draft personalization

✅ **Checklist**:
- [ ] Classified as new_lead
- [ ] Draft is appropriate for cold contact
- [ ] Doesn't assume prior relationship
- [ ] Includes business intro/CTA

### 5.3 Very Long Thread

**Steps**:
1. Find/create email with 10+ messages in thread
2. Trigger webhook
3. Verify system retrieves full thread

✅ **Checklist**:
- [ ] Full thread retrieved (no truncation)
- [ ] UI handles long threads gracefully
- [ ] Performance acceptable (< 2s to load)
- [ ] Draft considers full context, not just last message

### 5.4 High-Urgency Spam

**Steps**:
1. Send obvious spam/scam email
2. Check classification

✅ **Checklist**:
- [ ] Classified as "spam" or "ignore"
- [ ] No draft generated for spam
- [ ] Logged but not in approval queue
- [ ] Owner has option to review if needed

### 5.5 Rapid Sequential Emails

**Steps**:
1. Send 5 emails in quick succession
2. All trigger webhooks nearly simultaneously

✅ **Checklist**:
- [ ] All approvals created (no lost emails)
- [ ] No duplicate approvals
- [ ] Classification/drafting works correctly for all
- [ ] No rate limiting errors

### 5.6 Character Encoding & Special Characters

**Steps**:
1. Send email with:
   - Emoji in subject: "Booking request 🎯"
   - Special chars: "café, naïve, résumé"
   - Non-ASCII: Japanese, Arabic, emoji
2. Verify draft handles these correctly

✅ **Checklist**:
- [ ] Special characters preserved in subject
- [ ] Emoji rendered correctly
- [ ] Non-ASCII languages handled
- [ ] No mojibake (garbled text)

### 5.7 Very Long Message

**Steps**:
1. Send email with 5000+ word body (e.g., paste long document)
2. Trigger classification

✅ **Checklist**:
- [ ] Processed without timeout
- [ ] Classification still accurate (LLM ignores irrelevant noise)
- [ ] Draft is concise (not just echoing long text)
- [ ] No token limits hit

---

## Phase 6: Security & Compliance (30 min)

### 6.1 JWT Token Validation

**Steps**:
1. Make request with invalid/expired token:
   ```bash
   curl http://localhost:8000/api/approvals \
     -H "Authorization: Bearer invalid-token"
   ```
2. Should return 401 Unauthorized

✅ **Checklist**:
- [ ] Invalid token rejected (401)
- [ ] No data leakage in error message
- [ ] Valid token accepted
- [ ] Can't access other user's data with valid token

### 6.2 RLS Policies

**Steps**:
1. In Supabase console, query another user's data directly
2. Should return nothing (RLS blocks it)
3. Try to update another user's approval:
   ```sql
   UPDATE approvals SET status='approved' 
   WHERE business_id != 'your-id';
   -- Should return "new row violates row-level security policy"
   ```

✅ **Checklist**:
- [ ] Can't read other user's approvals
- [ ] Can't modify other user's data
- [ ] Can't see other user's memory/activity
- [ ] RLS policies enforced at database level

### 6.3 Webhook Signature Verification

**Steps**:
1. Send webhook with wrong signature:
   ```bash
   curl -X POST http://localhost:8000/api/gmail/webhook \
     -H "X-Goog-Signature: wrong-signature" \
     -d '{...}'
   ```
2. Should return 403 Forbidden

✅ **Checklist**:
- [ ] Invalid signature rejected (403)
- [ ] Valid signature accepted (200)
- [ ] Signature verification can't be bypassed
- [ ] Webhook can't be spoofed

### 6.4 Token Encryption

**Steps**:
```sql
SELECT access_token_encrypted, refresh_token_encrypted 
FROM oauth_tokens 
WHERE business_id='your-id';
```

Decrypt locally (should fail without key):
```python
from core.encryption import decrypt
# This should only work in your Python environment with correct key
```

✅ **Checklist**:
- [ ] Tokens are encrypted in database (not plaintext)
- [ ] Can't decrypt without ENCRYPTION_KEY env var
- [ ] No tokens in logs or error messages
- [ ] Frontend never sees refresh token

### 6.5 CORS Restrictions

**Steps**:
1. Open a page on different origin
2. Try to call API:
   ```javascript
   fetch('http://localhost:8000/api/approvals')
   ```
3. Should get CORS error

✅ **Checklist**:
- [ ] CORS only allows localhost:5173 (or your dev domain)
- [ ] Production domain configured in CORS
- [ ] Wildcard CORS not enabled
- [ ] Credentials only sent over HTTPS (production)

---

## Phase 7: UI/UX Visual Walkthrough (1 hour)

### 7.1 Dashboard Overview

**Open `http://localhost:5173`**

✅ **Visual Checklist**:
- [ ] Page loads without errors
- [ ] Layout is clean and organized
- [ ] Navigation is intuitive
- [ ] Color scheme matches brand (check CLAUDE.md)
- [ ] Responsive (test on mobile width: 375px)
- [ ] No broken images or missing fonts
- [ ] Performance acceptable (< 2s load time)

### 7.2 Business Profile Setup

**Path**: Dashboard → Settings/Profile

✅ **Visual Checklist**:
- [ ] Form fields are clear and labeled
- [ ] Help text explains each field
- [ ] Can edit existing profile
- [ ] Save button clear and prominent
- [ ] Success/error messages are visible
- [ ] No data loss if accidentally navigate away

### 7.3 Gmail Connection

**Path**: Dashboard → Gmail Settings

✅ **Visual Checklist**:
- [ ] "Connect Gmail" button is prominent
- [ ] Status shows "Connected" after OAuth
- [ ] Disconnect button available
- [ ] Shows which Gmail account connected
- [ ] Clear instructions for re-connecting

### 7.4 Approvals List

**Path**: Dashboard → Approvals / Pending

✅ **Visual Checklist**:
- [ ] List displays all pending approvals
- [ ] Each item shows: sender, subject, timestamp
- [ ] Classification tag visible (color-coded)
- [ ] Urgency indicator visible
- [ ] Count badge shows number pending
- [ ] Can scroll if many approvals
- [ ] Empty state message if no approvals
- [ ] Refresh button works
- [ ] List updates after approval/rejection

### 7.5 Approval Detail Modal

**Click on an approval from list**

✅ **Visual Checklist**:
- [ ] Modal/detail page opens smoothly
- [ ] Back button or close (X) button present
- [ ] Email thread displays clearly
  - [ ] Messages indented and separated
  - [ ] Newest message first
  - [ ] Sender name/email visible
  - [ ] Timestamp for each message
  - [ ] Body text readable (font size, contrast)
- [ ] Classification section shows result
- [ ] Draft section shows proposed reply
- [ ] Action buttons clearly visible:
  - [ ] Edit Draft (clear secondary button)
  - [ ] Reject (red/warning color)
  - [ ] Approve (green/primary color)
- [ ] No overlapping text or UI

### 7.6 Edit Draft

**Click Edit Draft button**

✅ **Visual Checklist**:
- [ ] Switches to edit mode (or opens editor modal)
- [ ] Draft text is in editable textarea
- [ ] Has proper focus/cursor
- [ ] Can scroll if text is long
- [ ] Character count shown (optional)
- [ ] Save and Cancel buttons visible
- [ ] Clear indication of editing mode
- [ ] Original draft preserved if Cancel

### 7.7 Approve/Reject Flow

**Click Approve button**

✅ **Visual Checklist**:
- [ ] Confirmation dialog appears (if needed)
- [ ] Clear summary of what will happen
- [ ] Button labels are clear (Confirm / Cancel)
- [ ] Waiting state shows (spinner) while sending
- [ ] Success message displays ("Email sent")
- [ ] Redirects back to list (approval removed)

**Click Reject button**

✅ **Visual Checklist**:
- [ ] Modal appears asking for rejection reason
- [ ] Reason field is clear
- [ ] Can choose from preset reasons or custom
- [ ] Success message after rejection
- [ ] Approval marked as rejected in list

### 7.8 Activity/History (if present)

**Path**: Dashboard → Activity Log

✅ **Visual Checklist**:
- [ ] Shows chronological list of actions
- [ ] Each entry shows: timestamp, action, details
- [ ] Can filter by type (email received, approved, rejected, etc.)
- [ ] Pagination if many entries
- [ ] Each entry is clickable (shows full details)

### 7.9 Accessibility

**Test with keyboard only** (no mouse):
- [ ] Tab navigation works
- [ ] Focus indicators visible
- [ ] All buttons reachable via Tab
- [ ] Form inputs have labels (screen reader compatible)
- [ ] No keyboard traps

**Test with screen reader** (macOS: VoiceOver):
- [ ] Headings announced correctly
- [ ] Button labels read correctly
- [ ] Form field labels associated
- [ ] Error messages announced

### 7.10 Responsive Design

**Test at multiple widths**:
- [ ] 1920px (desktop)
- [ ] 1024px (tablet landscape)
- [ ] 768px (tablet portrait)
- [ ] 375px (mobile)

✅ **For each width**:
- [ ] Layout reflows properly
- [ ] No horizontal scrolling (except intentional)
- [ ] Touch targets are >= 44px
- [ ] Text is readable (not too small)
- [ ] Buttons/inputs are usable on touch
- [ ] Menu/navigation adapts (hamburger on mobile)

---

## Phase 8: Performance Testing (30 min)

### 8.1 Approval List Load Time

**Steps**:
1. Open DevTools (F12 → Network tab)
2. Go to Approvals page
3. Measure load time

✅ **Checklist**:
- [ ] Initial page load < 2 seconds
- [ ] API calls complete < 1 second
- [ ] No slow network requests (check waterfall)
- [ ] JavaScript bundle < 500KB (gzipped)

### 8.2 Classification Performance

**Steps**:
1. Open DevTools (Console tab)
2. Trigger email classification (webhook)
3. Check how long it takes

✅ **Checklist**:
- [ ] Classification completes < 5 seconds
- [ ] Groq API responds quickly (< 3s)
- [ ] No timeout errors
- [ ] Database queries are fast (< 100ms each)

### 8.3 Draft Generation Performance

**Steps**:
1. Trigger draft generation
2. Measure time from webhook to draft created

✅ **Checklist**:
- [ ] Draft generated < 5 seconds
- [ ] No LLM timeout
- [ ] Memory retrieval (RAG) is fast (< 1s)
- [ ] Database writes complete < 100ms

### 8.4 Approval Sending Performance

**Steps**:
1. Click Approve
2. Measure time until success

✅ **Checklist**:
- [ ] Email sent < 3 seconds
- [ ] Gmail API responds quickly
- [ ] Activity logged < 100ms
- [ ] No timeout or delay in UI

---

## Phase 9: Acceptance Criteria & Sign-Off

### Definition of Done ✅

For Phase 1 to be complete, ALL of the following must pass:

**Functional**:
- [ ] Email received, classified, and drafted correctly
- [ ] Owner can approve, reject, or edit drafts
- [ ] Email sent to Gmail correctly (appears in Sent folder)
- [ ] Thread maintained in Gmail (conversation visible)
- [ ] Audit trail logged all actions
- [ ] RLS policies prevent cross-user access
- [ ] Edge cases handled (spam, long threads, missing context)

**UI/UX**:
- [ ] Frontend loads and renders without errors
- [ ] All buttons/interactions work as expected
- [ ] Visual design matches brand (check CLAUDE.md)
- [ ] Mobile responsive (tested at 375px)
- [ ] Accessibility baseline met (keyboard navigation, screen reader)
- [ ] No visual bugs (overlapping text, broken layouts)

**Security**:
- [ ] JWT tokens validated on all endpoints
- [ ] RLS policies enforced in database
- [ ] Webhook signatures verified
- [ ] No sensitive data in logs
- [ ] Tokens encrypted in database

**Performance**:
- [ ] Page loads < 2 seconds
- [ ] Classification completes < 5 seconds
- [ ] Email sends < 3 seconds
- [ ] No N+1 queries or performance bottlenecks

**Documentation**:
- [ ] TESTING_GUIDE.md exists and is accurate
- [ ] API_REFERENCE.md documents all endpoints
- [ ] README.md has setup instructions
- [ ] Code has docstrings and comments

---

## Bug Tracking Template

When you find issues, log them like this:

### Bug Report Template

```
**Title**: [Component] Brief description

**Severity**: Critical / High / Medium / Low
- Critical: System doesn't work / data loss
- High: Feature broken, affects workflow
- Medium: Feature works but has issues
- Low: Cosmetic or nice-to-have

**Steps to Reproduce**:
1. Navigate to X
2. Click Y
3. Expected Z, but saw W

**Expected**: 
What should happen

**Actual**: 
What actually happened (with screenshot/error)

**Browser/Device**: 
Chrome 125 on macOS 14.4

**Additional Context**:
Any other info that helps

**Assigned to**: [Owner/Dev]
```

**Tracking**: Use GitHub Issues, Linear, or a simple markdown file in `/Olivander/PHASE_1_BUGS.md`

---

## Success Criteria Summary

Phase 1 testing is **complete** when:

✅ All workflows work end-to-end (email → approval → send)
✅ No critical bugs (show-stoppers)
✅ UI/UX meets baseline quality
✅ Security verified
✅ Performance acceptable
✅ Owner can approve emails from phone
✅ Everything logged for audit trail

**Once this passes, you're ready to start Phase 3 (Calendar)**

---

## Next Steps After Testing

1. **Fix any bugs found** (prioritize critical/high)
2. **Document any workarounds** (if issues can't be fixed immediately)
3. **Get feedback** from test user (if available)
4. **Update CLAUDE.md** with any architecture changes needed
5. **Create Phase 3 specification** (Calendar & Scheduling)

---

## Contact & Questions

If you hit blockers during testing:
1. Check the error logs (backend terminal)
2. Check browser console (DevTools)
3. Check database state (Supabase console)
4. Review BACKEND_IMPLEMENTATION.md for context

Good luck! 🚀
