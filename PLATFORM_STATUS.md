# Olivander Platform Status
*Last updated: 2026-05-01 — full codebase annotation by Claude*

---

## Current State Summary

| Layer | Status | Notes |
|-------|--------|-------|
| Frontend (React/Vite) | **Live** | olivander.vercel.app |
| Backend (FastAPI) | **Live** | Render (previously Railway) |
| Database (Supabase) | **Active** | PostgreSQL + pgvector configured; migrations 003–010 written but unconfirmed applied |
| AI pipeline (Groq) | **Live** | `llama-3.3-70b-versatile` — classify, draft, plan, learn |
| Gmail OAuth | **Working** | Confirmed 2026-05-01 — callback 200 OK, business upserted, Connected shown in UI |
| Google Calendar | **Implemented** | `gcal/client.py` — slot proposals, event creation, list events |
| Xero | **Implemented, untested live** | OAuth + invoice creation + chaser logic in code |
| Provider abstraction | **Done** | `providers/base.py` + gmail/gcal/xero concrete providers |
| Job queue | **Done** | `jobs/queue.py` — 30s polling loop, 4-worker thread pool |
| Learning loop | **Done** | `agent/learning.py` — edit pattern extraction + memory promotion |
| RAG | **Partial** | `agent/rag.py` — keyword priority retrieval; pgvector not wired |
| Onboarding wizard | **Done** | `OnboardingWizard.jsx` — 4 steps; dry run at step 3 |
| Workspace (first customer) | **Done** | `api/workspace.py` + `010_first_customer_workspace.sql` |
| Sent-mail voice calibration | **Spec only** | `docs/build_report.md` — no code written |
| Calendar Command Centre | **Spec only** | Spec in `docs/build_report.md` — no dedicated UI |

---

## Verified Feature Coverage (Code Read 2026-05-01)

### Email Pipeline

| Feature | Status | Location |
|---------|--------|----------|
| Gmail Pub/Sub webhook handler | ✅ Done | `gmail/webhook.py` |
| Full thread context before reply | ✅ Done | `gmail/webhook.py` → `gmail/client.py:get_thread()` |
| Email classification (8 categories) | ✅ Done | `agent/classify.py` — temperature 0.1, fallback to existing_client |
| Draft reply (classification-aware prompts) | ✅ Done | `agent/draft.py` — temperature 0.4 |
| Execution plan with confidence (high/medium/review) | ✅ Done | `agent/execution_plan.py` — deterministic step builder |
| RAG context retrieval (keyword-priority) | ✅ Done | `agent/rag.py` — learned_tone_* fetched first |
| Approval creation + HMAC notification email | ✅ Done | `db/supabase.py:create_approval()` + `notifications/email_sender.py` |
| Email-tap approve/reject (HMAC tokens, 24h expiry) | ✅ Done | `api/email_actions.py` — idempotent |
| Edit pattern extraction + memory promotion | ✅ Done | `agent/learning.py` — promotes after 3 consistent edits |
| Approval atomic claim (no double-approve) | ✅ Done | `db/supabase.py:claim_approval()` |
| Dedup via approval_exists_for_message | ✅ Done | `gmail/webhook.py` |
| Booking request → calendar slot proposals | ✅ Done | `gmail/webhook.py` + `gcal/client.py:propose_slots()` |
| New lead follow-up sequences (+48h, +5d, +10d) | ✅ Done | `gmail/webhook.py:_enqueue_new_lead_follow_ups()` |
| Gmail watch renewal (6-day job) | ✅ Done | `jobs/handlers.py:handle_renew_gmail_watch()` |

### Approvals & Actions

| Feature | Status | Location |
|---------|--------|----------|
| Email reply send (approve) | ✅ Done | `api/actions.py` — Gmail send via `gmail/client.py` |
| Xero invoice create (approve) | ✅ Done | `api/actions.py` — Day-7 & Day-14 chasers enqueued |
| Quote send with PDF (approve) | ✅ Done | `api/actions.py` — WeasyPrint PDF, HTML email, Day-5 follow-up |
| Calendar event create (approve) | ✅ Done | `api/actions.py` — 24h & 2h reminders enqueued |
| Reject | ✅ Done | `api/actions.py` |
| Inline edit + learn | ✅ Done | `api/actions.py` — edit triggers `maybe_learn_from_edit()` |
| Execution plan display in ApprovalCard | ✅ Done | `ApprovalCard.jsx` |
| Memory context chips on ApprovalCard | ✅ Done | `ApprovalCard.jsx` — retrieved_context |

### Invoicing & Quotes

| Feature | Status | Location |
|---------|--------|----------|
| Natural language → invoice (AI extraction) | ✅ Done | `api/invoices.py` + `core/ai.py:extract_invoice_details()` |
| Xero contact find-or-create | ✅ Done | `xero/client.py:find_or_create_contact()` |
| Xero invoice creation (NZD, GST, line items) | ✅ Done | `xero/client.py:create_invoice()` |
| Payment chaser (Day-7, Day-14, Day-21) | ✅ Done | `jobs/handlers.py:handle_chase_invoice()` — live Xero check before each |
| Natural language → quote | ✅ Done | `api/quotes.py` |
| Quote PDF (WeasyPrint, A4, inline CSS) | ✅ Done | `api/quotes.py:generate_quote_pdf()` |
| Quote follow-up (Day-5) | ✅ Done | `jobs/handlers.py:handle_follow_up_email()` |

### Calendar

| Feature | Status | Location |
|---------|--------|----------|
| Busy period query | ✅ Done | `gcal/client.py:check_availability()` |
| Slot proposals (next 7 days, buffer-aware) | ✅ Done | `gcal/client.py:propose_slots()` |
| Event creation | ✅ Done | `gcal/client.py:create_event()` |
| Event listing | ✅ Done | `gcal/client.py:list_events()` |
| Calendar API endpoints (availability, slots, events) | ✅ Done | `api/calendar.py` |
| 24h & 2h reminder jobs | ✅ Done | `jobs/handlers.py:handle_calendar_reminder()` |
| Calendar Command Centre UI | ❌ Not built | Spec in build_report.md; no dedicated frontend view |

### Lead Pipeline

| Feature | Status | Location |
|---------|--------|----------|
| Lead CRUD | ✅ Done | `api/leads.py` |
| Stage progression (new_enquiry → won/lost) | ✅ Done | `api/leads.py` + `db/migrations/007_lead_pipeline.sql` |
| Pipeline summary | ✅ Done | `api/leads.py:get_lead_pipeline_summary()` |
| LeadPipelinePanel frontend | ✅ Done | `components/LeadPipelinePanel.jsx` |
| Email → lead auto-mapping | ❌ Missing | No thread_id lookup to leads; manual entry only |

### Auth & Security

| Feature | Status | Location |
|---------|--------|----------|
| Google OAuth (PKCE, CSRF via oauth_states) | ✅ Working | Confirmed 2026-05-01 — full flow tested live |
| Xero OAuth | ✅ Done | `auth/xero.py` — redirect URI needs Xero portal registration |
| JWT session (7-day) | ✅ Done | `auth/tokens.py` + `auth/deps.py` |
| Token encryption at rest (Fernet) | ✅ Done | `auth/tokens.py:_encrypt()/_decrypt()` |
| Auto-refresh Google token (5-min ahead) | ✅ Done | `auth/tokens.py:get_valid_token()` |
| Auto-refresh Xero token | ✅ Done | `auth/xero.py:get_valid_xero_token()` |
| Rate limiting (SlowAPI) | ✅ Done | `rate_limit.py` on all endpoints |
| Security headers (CSP, X-Frame, etc.) | ✅ Done | `main.py:add_security_headers()` |
| HMAC-signed email action tokens | ✅ Done | `notifications/email_sender.py:create_action_token()` |

### AI Infrastructure

| Feature | Status | Location |
|---------|--------|----------|
| Groq LLM provider abstraction | ✅ Done | `core/ai.py:AIProvider` — retry, cost tracking |
| AI usage logging (tokens, cost, operation) | ✅ Done | `core/ai.py:_log_usage()` + `db/migrations/003_ai_usage.sql` |
| RAG keyword retrieval (classification-aware) | ✅ Done | `agent/rag.py` |
| pgvector semantic retrieval | ❌ Not wired | `agent/rag.py` is keyword-only; no embedding model configured |
| Edit learning → memory promotion | ✅ Done | `agent/learning.py` — SequenceMatcher + AI pattern extraction |
| Sent-mail voice calibration | ❌ Not built | Spec written; `agent/voice.py` does not exist |

### Onboarding & Memory

| Feature | Status | Location |
|---------|--------|----------|
| 4-step onboarding wizard | ✅ Done | `OnboardingWizard.jsx` |
| Dry run (classify + draft without saving) | ✅ Done | `POST /api/onboarding/dry-run` |
| Memory KV store | ✅ Done | `db/supabase.py:get_memory_profile() / set_memory_value()` |
| Memory provenance chips | ✅ Done | `ApprovalCard.jsx` — retrieved_context |
| Memory edit UI | ✅ Done | `MemoryPanel.jsx` |
| Sent-mail voice calibration onboarding step | ❌ Not built | No UI, no API endpoint |

### Workspace (First Customer)

| Feature | Status | Location |
|---------|--------|----------|
| Jobs CRUD | ✅ Done | `api/workspace.py` + `db/migrations/010_first_customer_workspace.sql` |
| Messages CRUD | ✅ Done | `api/workspace.py` |
| Actions CRUD | ✅ Done | `api/workspace.py` |
| Gmail inbox import → workspace | ✅ Done | `POST /api/workspace/inbox/import` |
| Workspace → approvals integration | ❌ Gap | Workspace tables are isolated; no FK link to approvals table |
| TodayPanel + JobsPanel | ✅ Done | `components/TodayPanel.jsx`, `components/JobsPanel.jsx` |

### Infrastructure

| Feature | Status | Location |
|---------|--------|----------|
| 30s background job polling | ✅ Done | `jobs/queue.py:JobRunner` — 4-worker thread pool |
| Follow-up job sequences | ✅ Done | `jobs/handlers.py` — new_lead, quote_sent, invoice_chase, calendar_reminder |
| Client records (derived from approvals) | ✅ Done | `api/clients.py` |
| Client notes | ✅ Done | `api/clients.py` + `db/migrations/006_client_notes.sql` |
| Activity log (append-only) | ✅ Done | `db/supabase.py:log_activity()` |
| Activity panel | ✅ Done | `components/ActivityPanel.jsx` |
| Tier 2 auto-send (2hr countdown) | ❌ Missing | No timer or scheduler logic |
| Trust progression suggestions | ❌ Missing | No consecutive-approval tracking |

---

## Database Migrations Status

| Migration | Description | Applied |
|-----------|-------------|---------|
| `001_initial_schema.sql` | Core tables (businesses, approvals, memory, activity, oauth_states) | ✅ Confirmed (2026-05-01 — live queries returning 200) |
| `002_add_code_verifier.sql` | PKCE code_verifier on oauth_states | ✅ Confirmed (2026-05-01 — OAuth state consumed successfully) |
| `003_ai_usage.sql` | ai_usage table for token/cost tracking | ✅ Confirmed (owner applied before 2026-05-01) |
| `004_xero_columns.sql` | Xero token columns on businesses | ✅ Confirmed (owner applied before 2026-05-01) |
| `005_job_queue.sql` | job_queue table | ✅ Confirmed (2026-05-01 — job_queue polling returning 200) |
| `006_client_notes.sql` | client_notes table | ✅ Confirmed (owner applied before 2026-05-01) |
| `007_lead_pipeline.sql` | leads table | ✅ Confirmed (owner applied before 2026-05-01) |
| `008_approval_plan_context.sql` | execution_plan + retrieved_context on approvals | ✅ Confirmed (owner applied before 2026-05-01) |
| `009_memory_unique_key.sql` | UNIQUE (business_id, key) on memory — required for atomic upserts | ✅ Confirmed (owner applied before 2026-05-01) |
| `010_first_customer_workspace.sql` | workspace_jobs, workspace_messages, workspace_actions | ✅ Confirmed (2026-05-01 — applied successfully, no errors) |

**All migrations confirmed applied as of 2026-05-01.**

---

## Key Technical Debt

1. **Google OAuth `invalid_request`** — Single MVP blocker. All real usage depends on this.
2. **DB migrations unconfirmed** — Code assumes tables exist; runtime will fail without them.
3. **Xero redirect URI** — Must be registered in Xero developer portal.
4. **pgvector not wired** — `agent/rag.py` uses keyword priority only; semantic retrieval requires an embedding model (not Groq — needs OpenAI or sentence-transformers) and `embedding vector(768)` column on memory.
5. **Workspace ↔ approvals gap** — `workspace_jobs/messages/actions` are isolated tables; no FK links to approvals. Actions created by the approval flow don't appear in the workspace.
6. **No email → lead auto-link** — Inbound leads are classified and approved, but not auto-created as leads in the pipeline. Manual entry required.
7. **DashboardApp.jsx is a 900-line monolith** — No state management library; all state in component refs/timers. Works, but will become painful at next scale.
8. **Real-time via polling only** — 30s email sync and 30s job queue. No WebSocket; no push. Good for MVP, not for multi-tenant.
9. **Quote PDF styling** — Inline CSS only; no template system. Hard to brand-customise.
10. **Auto-send countdown (Tier 2)** — Specified in PRD but not implemented. All actions are Tier 3.

---

## Architecture Gaps vs PRD v6

| Gap | PRD requirement | Current state |
|-----|-----------------|---------------|
| pgvector semantic retrieval | §7.1 "pgvector query: top-3 chunks per query" | Keyword priority fallback only |
| Embedding model | §3.3 "RAG retrieval: pgvector 768-dim + Groq" | No embedding API; no vector column on memory |
| Tier 2 auto-send countdown | §5.1 "2-hour window, sends if not rejected" | Not implemented |
| Trust progression prompts | §5.3 "suggest tier promotion after 10 consec." | Not implemented |
| Sent-mail voice calibration | PRD / build_report §3 | Spec only — no code |
| Calendar Command Centre | build_report §4 | Backend client exists; no dedicated UI |
| Email → lead auto-link | §7.3 | No automatic lead creation from inbound emails |
| Workspace ↔ approvals integration | Implied by first-customer spec | Tables are isolated |

---

## Prioritised Next Steps

### Priority 1 — Complete MVP Unblocking

1. **Google OAuth ✅ DONE** — Confirmed working 2026-05-01. Callback 200 OK, business upserted, Connected shown in UI.

2. **Apply and verify remaining DB migrations against Supabase**
   - Run each migration in sequence via Supabase SQL editor
   - Confirm tables exist: `ai_usage`, `job_queue`, `client_notes`, `leads`, workspace tables
   - Verify unique constraint on `memory(business_id, key)` — required for `set_memory_value()` atomic upsert
   - *Files*: `backend/db/migrations/003_ai_usage.sql` through `010_first_customer_workspace.sql`

3. **Register Xero redirect URI in Xero developer portal**
   - Must be: `https://olivander-api.onrender.com/auth/xero/callback`
   - Verify `XERO_REDIRECT_URI` env var matches exactly on Render

4. **Verify Gmail Pub/Sub watch**
   - Confirm Pub/Sub topic and push subscription exist in Google Cloud Console
   - Confirm webhook push URL is `https://olivander-api.onrender.com/webhook/gmail`
   - Confirm `WEBHOOK_SECRET` matches on both Render and the Pub/Sub push subscription header
   - Run a real onboarding dry run: connect Google → answer questions → preview drafts → launch

### Priority 2 — Email → Lead Auto-Link

5. **Auto-create leads from `new_lead` classified emails**
   - In `gmail/webhook.py` after classification = `new_lead`, call `create_lead()` if no existing lead for that sender email
   - Link lead `thread_id` to the Gmail thread_id for future dedup
   - Show lead count badge on LeadPipelinePanel when new lead is auto-created
   - *Files*: `gmail/webhook.py`, `db/supabase.py`, `api/leads.py`

### Priority 3 — Sent-Mail Voice Calibration

6. **Implement `agent/voice.py`** — Scan last 50 sent emails, extract style profile via Groq
7. **Add `POST /api/onboarding/voice-calibration`** — Returns profile + example draft
8. **Extend OnboardingWizard step 3** — "Sounds like you?" card with editable example
9. **Inject `owner_voice_profile` into `draft_reply()`** — Load in `get_business_context`
10. **Store profile in memory** — Keys: `owner_voice_profile`, `owner_voice_calibrated_at`, `owner_voice_source_count`
    - *Full spec*: `docs/build_report.md §Sent-Mail Voice Calibration`

### Priority 4 — Calendar Command Centre UI

11. **TodayPanel** — Add today's events from Google Calendar alongside manual jobs
12. **Slot proposal UI** — When a booking_request approval is shown, display proposed slots as selectable options
13. **Calendar event approval cards** — Approve creates event + sends confirmation draft together
14. **Schedule gap detection** — Surface unscheduled jobs and double-bookings in TodayPanel
    - *Full spec*: `docs/build_report.md §Calendar Command Centre`

### Priority 5 — Workspace ↔ Approvals Integration

15. **Link workspace actions to approvals** — When an approval is created for a message in the workspace, surface it in the workspace action cards (not just the Approvals panel)
16. **Auto-create workspace message from inbound email** — When webhook processes a new email and creates an approval, also create or update a `workspace_message` row

### Priority 6 — Trust & Autonomy

17. **Tier 2 auto-send countdown** — After owner has approved 10+ consecutive actions for a classification, display suggestion to promote to Tier 2 (2hr auto-send window) with explicit confirmation
18. **Trust progression UI** — Counter on SettingsPanel showing consecutive approvals per classification; promote button triggers memory update

### Priority 7 — Hardening (before multi-tenant)

19. **pgvector semantic search** — Add `embedding vector(768)` to memory table; call an embedding API (OpenAI text-embedding-3-small) on memory writes; replace keyword priority in `agent/rag.py` with cosine similarity
20. **Pagination** — Add cursor-based pagination to workspace queries and approval list
21. **Email → lead duplicate guard** — Check existing leads by thread_id before auto-creating
22. **DashboardApp.jsx split** — Extract auth state, approval state, workspace state into separate context providers or Zustand stores

---

## MVP Ship Checklist

- [x] Google OAuth resolved and tested end-to-end — confirmed 2026-05-01
- [ ] Xero redirect URI registered in Xero developer portal
- [ ] DB migrations 003–010 applied and confirmed in Supabase
- [ ] `GOOGLE_REDIRECT_URI` env var on Render matches Google Cloud Console exactly
- [ ] Gmail Pub/Sub topic + push subscription configured with correct `WEBHOOK_SECRET`
- [ ] End-to-end test: inbound email → classification → draft → approval email → approve from phone → reply sent
- [ ] End-to-end test: invoice creation → Xero draft → approve → invoice sent
- [ ] End-to-end test: onboarding dry run with a real Gmail account → preview proposals → launch

---

## Phase 2 (Not yet started)

| Feature | PRD section | Status |
|---------|-------------|--------|
| Expense capture (photo → Xero) | §8.2 | ❌ Not started |
| Staff rostering | §8.3 | ❌ Not started |
| Document generation + Google Drive | §8.4 | ❌ Not started |
| Reputation & review management | §8.6 | ❌ Not started |
| SMS channel + missed call recovery | §8.7 | ❌ Not started |
| Supplier coordination | §8.8 | ❌ Not started |
| Cash position summary | §8.9 | ❌ Not started |
| Microsoft Outlook/365 provider | §3.1 | ❌ Not started |
| Stripe billing | §3.2 | ❌ Not started |
| BullMQ + Redis job queue | §3.2 | ❌ Not started |
| PWA configuration | §3.2 | ❌ Not started |

---

*This file is the authoritative build status. Update it when features land, blockers resolve, or scope changes. Follow `docs/build_report_agent_rules.md`.*
