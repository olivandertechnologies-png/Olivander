# Olivander Build Report

Last updated: 2026-05-03, Pacific/Auckland

This is the working build report for Olivander. Keep it current when product scope changes, when a meaningful implementation change lands, or when a blocker is resolved. Agents maintaining this file must follow `docs/build_report_agent_rules.md` and leave session continuity notes in `docs/agent_handoff.md`.

## Source Order

Use these sources in this order when deciding what to build:

1. `Olivander_PRD_v6.docx` - current product direction. Supersedes PRD v5.
2. `Olivander_First_Customer_Build_Spec_Two_Plans.pdf` - first customer tradie scope and plan split.
3. `Olivander_PRD.docx` - PRD v5 detail where v6 does not contradict it.
4. `AGENTS.md` - codebase rules, brand rules, and implementation guardrails.
5. `PLATFORM_STATUS.md` - **authoritative feature status, migration table, and prioritised next steps.** This file is the day-to-day build tracker. Update it when a feature lands, a priority changes, or a migration is applied. This report (`build_report.md`) is the PRD-aligned spec and implementation plan doc — update it when product requirements change, new features are scoped, or implementation plans are written.

## Document Responsibilities

| Document | Owned by | Update when |
|----------|----------|-------------|
| `PLATFORM_STATUS.md` | Both agents | Feature status changes, priority order changes, migration applied/confirmed, new gap identified |
| `docs/build_report.md` | Both agents | New PRD requirement added, implementation plan written, product scope changes, open questions resolved |
| `docs/agent_handoff.md` | Both agents | End of any meaningful session — what changed, blockers, next action |

## Build Principle For This Report

One thing working completely before touching the next. For the MVP, that means Gmail and approval-first email drafting must work end to end before deeper Phase 2 work.

## Current Product Shape

Olivander is an approval-first AI admin layer for NZ South Island service SMEs. The first customer build narrows that into a practical admin assistant for tradies: Today, Inbox, Jobs, Ask Olivander, Activity, and Settings.

Core promise:

- Find admin work before it goes missing.
- Draft the next reply, follow-up, booking step, quote, or invoice action.
- Show why the action exists.
- Require owner approval before anything customer-facing is sent or changed.
- Support both Google and Microsoft email/calendar stacks over time. Gmail proves the first loop, but Microsoft Outlook/Microsoft 365 is a required first-class provider because many target companies use Outlook instead of Gmail.

## Current Implementation State

Confirmed from repo inspection:

- Frontend: React/Vite dashboard and onboarding flow exist.
- Backend: FastAPI app with auth, Gmail, Calendar, Xero, approvals, quotes, leads, workspace, and job queue modules.
- AI: Groq provider abstraction exists and is used for classification, drafting, planning, and edit learning.
- Provider layer: `EmailProvider`, `CalendarProvider`, and `AccountingProvider` interfaces exist.
- Gmail pipeline: client, webhook handler, full-thread fetch, draft generation, approval creation, and approval notification paths exist.
- Onboarding dry run: `/api/onboarding/dry-run` classifies and drafts against recent real inbox emails without saving or sending.
- Learning loop: owner edits are compared against AI drafts and can promote repeated tone instructions into memory.
- First-customer workspace: migrations and API support exist for jobs, messages, and admin action cards.

Confirmed since the original repo inspection:

- Google OAuth was confirmed working on 2026-05-01 from Render callback logs and the connected app state. Business `olivandertechnologies@gmail.com`, ID `c8e6dea8-fa44-4bea-8f3e-dff7b5a43eb6`.
- Supabase migrations `001` through `010` were confirmed applied on 2026-05-01 from live Supabase checks recorded in `docs/agent_handoff.md`.
- Gmail Pub/Sub topic `projects/olivandertechnologies/topics/gmail-watch` and push subscription `gmail-watch-push` were created on 2026-05-01. The webhook accepts `?token=` for Pub/Sub push compatibility.
- Live frontend `https://olivander.vercel.app` is built against backend `https://olivander.onrender.com`; `/health` returned `{"status":"ok"}` on 2026-05-03 after cold start.

Unconfirmed or blocked:

- Gmail watch activation on the deployed service is not yet verified. The missing `PUBSUB_TOPIC` deployment config was added to `render.yaml` and `backend/.env.example` on 2026-05-03, but the real Render env/deploy still needs to be checked.
- The previous docs/handoff used `https://olivander-api.onrender.com`, which returned Render `no-server` 404 on 2026-05-03. Deployment config and docs now use `https://olivander.onrender.com`; the Google Pub/Sub push subscription endpoint must be checked and updated if it still points at the stale host.
- After Render has the topic value, Google must be disconnected and reconnected in app Settings so `/auth/google/callback` calls `setup_gmail_watch()`.
- Xero developer-portal setup is owner-confirmed as of 2026-05-05. The Xero OAuth/invoice flow is implemented in code, but invoice creation → approval → send still needs a live end-to-end test.
- The working tree contains a pre-existing `Dockerfile` edit. Treat it as prior work unless explicitly reviewed.

## MVP Ship Bar

The MVP ships only when these are true for one real paying customer:

- Google OAuth works reliably.
- Gmail integration is live.
- Email triage works end to end: inbound email, classification, full thread context, draft, approval, send.
- Booking handling works end to end: email request, calendar availability, slot proposal, approval, confirmation.
- Invoice creation works end to end: owner instruction, Xero draft, approval, invoice send.
- Finance actions remain approval-first. No invoice executes without owner review.

## First Customer Focus

Use the two-plan tradie build as the near-term product lens:

- Admin Starter: inbox triage, lead capture, draft replies, manual jobs, quote follow-up tracking, approval workflow, activity log.
- Admin Plus: everything in Starter plus invoice chasing, money-at-risk views, calendar awareness, richer job detail, scheduling gaps, and business snapshot.

Do not expand into full job management, native mobile, complex reporting, payments, route optimisation, or WhatsApp before the first customer proves weekly use.

## New Requirement: Microsoft Outlook / Microsoft 365 Connection

Owner request added on 2026-05-03:

Olivander must support Microsoft Outlook/Microsoft 365 as a first-class email and calendar connection. Many target companies use Outlook instead of Gmail, especially established trades and service businesses, so Outlook support is required for market coverage rather than a long-term nice-to-have.

### Product Intent

The Gmail-first MVP should prove the approval-first admin loop, but the architecture and next provider build must make Outlook a native path. Owners should be able to connect either Google or Microsoft, then receive the same inbox triage, booking handling, approval notification, and calendar-aware drafting experience.

### Behaviour

- Add Microsoft OAuth connection for Outlook mail and Outlook Calendar via Microsoft Graph.
- Implement `EmailProvider` and `CalendarProvider` concrete adapters for Microsoft Graph.
- Support Outlook inbox change notifications/webhooks, thread fetch, send, unread listing, attachment fetch, token refresh, and disconnect/reconnect.
- Keep Gmail and Outlook behind the same provider interfaces so workers do not contain Gmail-only assumptions.
- Use Outlook Calendar availability for booking slot proposals when Microsoft is the connected provider.
- Make Settings show Google and Microsoft as separate connection options, with only one active email/calendar provider required at MVP.

### Guardrails

- Approval-first rules stay identical across Gmail and Outlook.
- Full thread context is required before drafting any Outlook reply.
- Calendar availability must be checked live before proposing Outlook calendar slots.
- No provider-specific credentials or tokens can be hardcoded; Microsoft secrets stay in environment variables only.
- Outlook support must not fork the product into two workflows. Provider-specific code belongs in adapters; classification, drafting, approvals, memory, and jobs stay shared.

### Acceptance Criteria

- Owner can connect Microsoft 365/Outlook from Settings.
- Inbound Outlook email can trigger classification, full-thread retrieval, draft creation, approval notification, and approved send.
- Outlook booking request can produce live availability slots from Outlook Calendar.
- Token refresh, disconnect, and reconnect work without losing tenant scoping.
- Tests cover Microsoft OAuth callback, provider adapter calls, webhook verification, approval creation, send, and calendar availability failure fallback.

## New Requirement: Sent-Mail Voice Calibration

Owner request added on 2026-05-01:

During email onboarding, Olivander should learn how the owner writes by reviewing the emails the owner has sent, then generate an example reply for a realistic customer scenario based on that business context. The owner can edit that example until it sounds right. The result becomes a stronger tone and structure seed for future customer email drafts.

### Product Intent

This should make the first dry run feel like "this sounds like me" instead of "this is a generic AI email." It supports the PRD trust moment: the owner sees real output before going live.

### Behaviour

- After Google is connected, scan owner-sent Gmail messages using the existing Gmail read scope.
- Start with a bounded recent sample for onboarding speed, then support incremental backfill toward the full sent-mail history.
- Filter out automated mail, forwards, blank replies, legal/accounting boilerplate, and messages that are too short to teach voice.
- Extract a voice profile: greeting style, sign-off style, typical length, directness, formality, local phrasing, how pricing/booking uncertainty is handled, and common call-to-action patterns.
- Generate at least one realistic scenario from the business context, such as a new lead enquiry, booking request, quote follow-up, invoice question, or reschedule request.
- Draft the example reply in the owner's inferred style.
- Let the owner edit the example during onboarding.
- Save the approved voice profile and edited example into business memory.
- Use that profile in future `draft_reply()` calls before relying on generic tone instructions.

### Guardrails

- Nothing generated during calibration is sent.
- Raw sent emails should not be stored long-term.
- Store the durable output as a compact style profile, source count, timestamp, and any owner-approved exemplar.
- Show the owner what was learned in Memory and allow deletion or recalibration.
- If the sent-mail sample is too weak, ask the owner to paste or approve a good example instead of guessing.
- Privacy copy must be updated before release because current policy describes inbound drafting but not sent-mail voice calibration.

### Suggested Memory Keys

- `owner_voice_profile`
- `owner_voice_examples`
- `owner_voice_calibrated_at`
- `owner_voice_source_count`
- `learned_tone_global`
- Classification-specific overrides such as `learned_tone_new_lead` can still be created by the edit learning loop.

### Acceptance Criteria

- Onboarding can complete even if calibration fails.
- Calibration produces a visible, editable example draft before launch.
- The example draft changes after the owner edits the tone profile or exemplar.
- Future draft prompts include the saved voice profile.
- The approval card still shows provenance for business facts used in a draft.
- No customer-facing email can be sent from calibration.
- Tests cover sent-mail listing, weak sample fallback, memory persistence, and prompt inclusion.

## New Requirement: Calendar Command Centre

Owner request added on 2026-05-01:

Olivander should include a practical calendar feature as part of the first-customer build. This is not just "connect Google Calendar"; it should help the owner understand the day, spot scheduling problems, and prepare booking actions for approval.

### Product Intent

The calendar feature should make Olivander useful at the start of the day and during booking conversations. For tradies and service operators, the calendar is where customer promises become real work. The product should connect inbox, jobs, and calendar into one operational view.

### Behaviour

- Show a Today and upcoming week view using connected Google Calendar events.
- Link calendar events to jobs, customers, and inbox threads where possible.
- Detect booking requests from email and propose 2-3 available slots using business hours, buffers, blocked dates, travel time if available, and existing events.
- Surface schedule gaps, double-bookings, unscheduled jobs, and overdue booking confirmations.
- Let the owner create, edit, reschedule, or cancel proposed events from approval cards.
- Generate confirmation and reminder drafts tied to the event.
- Add a daily plan summary: first job, gaps, travel-sensitive items, urgent admin follow-ups, and any bookings awaiting confirmation.
- Keep manual job dates visible even before full calendar sync is perfect.

### Guardrails

- Calendar changes are approval-first during MVP.
- Never create, move, or cancel a calendar event without owner approval.
- Never promise a slot to a customer unless it was checked against live calendar availability.
- If calendar access fails, keep drafting the reply but mark availability as unverified and ask the owner to confirm.
- Event records should avoid storing unnecessary private calendar detail. Store only what is needed for the job, approval, and audit trail.

### Suggested Data Needs

- Calendar event ID and provider.
- Linked job ID, approval ID, customer name, and customer email.
- Event start/end, timezone, location, status, and source.
- Business hours, booking buffer, blocked periods, minimum lead time, and maximum daily bookings.
- Reminder state for confirmation, 24-hour reminder, and 2-hour reminder.

### Acceptance Criteria

- Owner can see today's events and manually entered job dates in one view.
- Booking request emails produce available slot proposals from live calendar data.
- Owner can approve a proposed event and confirmation reply.
- Reschedule requests produce a reviewed event update, not an automatic move.
- Calendar failure is visible and does not silently produce unsafe availability claims.
- Tests cover slot proposal, conflict detection, approval creation, event creation, and failure fallback.

## Next Step

See `PLATFORM_STATUS.md` for the full ordered priority list. Current top priorities:

**Priority 1 — MVP unblocking (infra only)**
1. Xero setup is owner-confirmed as of 2026-05-05; if invoice E2E fails, verify Render `XERO_REDIRECT_URI` still equals `https://olivander.onrender.com/auth/xero/callback`
2. Verify Render has `PUBSUB_TOPIC=projects/olivandertechnologies/topics/gmail-watch` and Pub/Sub push subscription points at `https://olivander.onrender.com/webhook/gmail?token=<WEBHOOK_SECRET>`
3. Disconnect and reconnect Google in app Settings to activate Gmail watch
4. End-to-end test: inbound email → approve from phone → reply sent
5. End-to-end test: invoice creation → Xero draft → approve → invoice sent

**Priority 2 — Unpaid invoices panel + manual reminder ✅ code complete**
- `GET /api/invoices/unpaid` queries Xero live and returns unpaid authorised invoices sorted by oldest due date.
- `UnpaidInvoicesPanel` is wired into the dashboard with days-overdue colouring and per-row "Send reminder".
- Manual reminder creates an approval action; owner reviews/edits the draft before anything sends.
- Remaining verification: live Xero account E2E against the connected customer account.

**Priority 3 — Email → Lead Auto-Link ✅ code complete**
- `gmail/webhook.py` creates or links a pipeline lead when classification is `new_lead`.
- Dedup order is Gmail `thread_id`, then sender email; existing leads are linked rather than duplicated.
- Dashboard lead count refreshes during inbox polling and the "New leads" metric opens the Leads panel.

**Priority 4 — Missed Response Detection ✅ code complete**
- Gmail webhook queues a 4h missed-response check after actionable inbound messages.
- Job handler skips handled approvals and creates a non-sending `missed_response` approval card when no approved/rejected response exists.
- Dashboard/email-tap approval paths mark missed-response cards handled without sending.

**Priority 5 — ROI Outcomes Dashboard ✅ code complete**
- `GET /api/outcomes/summary` returns rolling 30-day proof-of-value metrics.
- Today dashboard now includes `OutcomesPanel` with the six plain-number metrics and the required 30-day headline.
- Counts are derived from existing approvals/jobs/leads; no migration or new tracking columns required.

**Next code build: Priority 6 — Sent-Mail Voice Calibration**
- Add owner sent-mail style analysis and persist the voice profile in memory.
- Feed the owner voice profile into draft generation.
- Live Gmail/Xero E2E checks remain the operational priority before first customer use.

## Implementation Plan: Sent-Mail Voice Calibration

1. Gmail client
   - Add a helper to list sent messages with `labelIds=["SENT"]` or query `in:sent`.
   - Reuse full body extraction.
   - Return only the fields required for analysis.

2. AI voice analysis
   - Add `backend/agent/voice.py`.
   - Summarise sent messages in bounded batches.
   - Produce structured JSON for the voice profile and example scenario.
   - Keep prompts explicit: infer style only, do not invent business facts.

3. Persistence
   - Store the compact voice profile in `memory` using `set_memory_value`.
   - Track source count and calibration timestamp.
   - Store only owner-approved exemplar text.

4. API
   - Add `POST /api/onboarding/voice-calibration`.
   - Return detected style points, scenario, draft, source count, and confidence.
   - Add `PATCH /api/onboarding/voice-calibration` or reuse `/api/memory` for owner edits.

5. Frontend
   - Extend onboarding preview with a "Sounds like you?" calibration card.
   - Let the owner edit the example draft inline.
   - Save the accepted profile before launch.

6. Drafting
   - Load `owner_voice_profile` in `get_business_context`.
   - Inject it into `draft_reply()` as a priority tone instruction.
   - Keep learned classification-specific tone overrides as the strongest signal after calibration.

7. Compliance
   - Update privacy copy to mention sent-mail voice calibration.
   - State that raw sent emails are processed for style extraction and not retained long-term.

## Implementation Plan: Calendar Command Centre

1. Calendar data access
   - Confirm Google Calendar OAuth scope and token refresh work.
   - Reuse `gcal/client.py` and `CalendarProvider` where possible.
   - Add event listing for Today and upcoming week.

2. Backend API
   - Add or extend endpoints for calendar overview, availability, proposed event creation, reschedule proposals, and cancellation proposals.
   - Keep event execution behind the existing approval flow.

3. Data model
   - Add a migration if needed for linked calendar events, booking rules, blocked periods, and reminder state.
   - Link calendar events to workspace jobs and approvals where possible.

4. Frontend
   - Add calendar content to Today and Jobs rather than creating a separate complex calendar app first.
   - Show schedule gaps, pending booking approvals, and event-linked job cards.

5. Booking workflow
   - For booking request emails, generate slots from live availability.
   - Queue the proposed reply and event creation together as one approval where possible.
   - On approval, create the event and send the confirmation reply.

6. Verification
   - Test normal slot proposal, double-booking prevention, event creation, reschedule, cancellation, and calendar API failure fallback.

## Implementation Plan: Microsoft Outlook / Microsoft 365 Connection

1. Provider contracts
   - Confirm current `EmailProvider` and `CalendarProvider` interfaces cover Outlook needs.
   - Add missing methods before writing Microsoft-specific business logic.

2. Microsoft OAuth
   - Add Microsoft app registration env vars and callback route.
   - Store encrypted access/refresh tokens with provider metadata.
   - Support disconnect/reconnect from Settings.

3. Microsoft Graph email adapter
   - Implement thread fetch, unread listing, send, attachment fetch, and webhook subscription.
   - Map Graph message/thread fields into Olivander's existing internal email shape.

4. Microsoft Graph calendar adapter
   - Implement availability lookup, event listing, event create/update/delete, and webhook subscription.
   - Keep booking actions approval-first.

5. Worker integration
   - Select the active provider by business connection.
   - Keep classification, drafting, approval creation, memory retrieval, and job handling provider-neutral.

6. Frontend
   - Add Microsoft connection card in Settings.
   - Show provider-specific connected state without changing the main workflow UI.

7. Verification
   - Test OAuth, webhook verification, full-thread draft flow, approved send, token refresh, disconnect/reconnect, and calendar availability fallback.

## Running Change Log

### 2026-05-05

- Integrated market research report (Wanaka A&P Show survey + secondary sources) into `PLATFORM_STATUS.md`.
- Added market-validated workflows table to PLATFORM_STATUS.md: confirms invoice AR chasing and email triage are correct first wedges; identifies two missing workflows.
- Added **Priority 2 — Unpaid Invoices Panel + Manual Reminder**: owner needs a live AR view with on-demand reminder trigger, not just the automated Day-7/14/21 chasers. Spec: `GET /api/invoices/unpaid`, `UnpaidInvoicesPanel`, per-row "Send Reminder" creates an approval action.
- Added **Priority 4 — Missed Response Detection**: unanswered enquiries are invisible lost revenue. Spec: thread-state tracking, 2h `handle_missed_response_check` job, amber badge on dashboard.
- Added **Priority 5 — ROI Outcomes Dashboard**: primary retention and referral driver per market research. Spec: `GET /api/outcomes/summary` (6 rolling-30-day metrics), `OutcomesPanel` with plain number display.
- Explicitly marked out of scope for Phase 1: social media automation, Shopify, SMS, staff rostering, supplier coordination.
- Clarified document responsibilities: PLATFORM_STATUS.md owns feature status and priorities; build_report.md owns PRD specs and implementation plans.
- Updated CLAUDE.md and AGENTS.md: removed stale "Pending DB Migrations" section (all 001–010 confirmed applied 2026-05-01); added sync warning between the two files.
- Owner confirmed Xero setup is complete on 2026-05-05. Docs now treat the Xero redirect/setup item as owner-confirmed, while the live invoice creation → approval → send E2E remains unverified.
- Built **Priority 2 — Unpaid Invoices Panel + Manual Reminder** in code: live Xero unpaid invoice endpoint, dashboard panel, manual reminder approval queue, duplicate guard against pending reminder approvals and scheduled chasers within 48h. Verification: backend invoice/security tests passed; frontend production build passed; Playwright smoke checked desktop/mobile empty state.
- Built **Priority 3 — Email → Lead Auto-Link** in code: new-lead Gmail webhook processing now creates or links `lead_pipeline` rows, dedups by thread/email, links approval IDs, refreshes dashboard lead count during inbox polling, and routes the "New leads" metric to the Leads panel. Verification: backend lead/security/invoice tests passed; frontend production build passed.
- Built **Priority 4 — Missed Response Detection** in code: actionable inbound Gmail processing queues delayed missed-response checks, job handler creates non-sending `missed_response` approval cards when the original approval remains unhandled, and dashboard/email-tap approvals can mark those cards handled without sending. Verification: backend missed-response/lead/invoice/security tests passed; frontend production build passed.
- Built **Priority 5 — ROI Outcomes Dashboard** in code: added `GET /api/outcomes/summary`, pure 30-day outcome counting from approvals/jobs/leads, and a compact Today-panel `OutcomesPanel` with the six required metrics. Verification: backend outcomes/missed-response/lead/invoice/security tests passed; frontend production build passed.

### 2026-05-03

- Added owner-requested Microsoft Outlook/Microsoft 365 connection requirement to `Olivander_PRD_v6.docx`, `Olivander_PRD.docx`, and this report. The requirement makes Outlook a required first-class email/calendar provider because many target companies use Outlook instead of Gmail.
- PRD updates cover product definition, architecture, email workflow, roadmap, current stack tables, and implementation guardrails.
- Added `PUBSUB_TOPIC=projects/olivandertechnologies/topics/gmail-watch` to `render.yaml` and `backend/.env.example` so the deployed OAuth callback has the topic required to register Gmail inbox watches.
- Confirmed live frontend uses `https://olivander.onrender.com`; `https://olivander.onrender.com/health` returned `{"status":"ok"}` and `POST /webhook/gmail` without a token returned the expected 403. `https://olivander-api.onrender.com` returned Render `no-server` 404.
- Updated `BACKEND_ORIGIN` defaults/docs to `https://olivander.onrender.com` and added it to `render.yaml`.
- Centralised `PUBSUB_TOPIC` in `backend/config.py` and used it from `backend/auth/google.py`.
- Added a production startup guard requiring `PUBSUB_TOPIC` on Render/Railway so Gmail watch setup cannot silently ship disabled.
- Added/updated OAuth security tests for the current PKCE helper signature, `/api/connections` payload, and Gmail watch registration when a topic is configured.
- Verification: `PYTHONPATH=. /Users/ollie/.local/bin/uv run --python /Users/ollie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 --with-requirements requirements.txt pytest tests/test_security.py -q` from `backend/` passed: 7 tests on Python 3.12.
- Remaining first-customer step: verify Render has the backend origin/topic values, update the Pub/Sub push endpoint if needed, reconnect Google, and run the real inbound-email approval test.

### 2026-05-01 (session 2)

- Confirmed Google OAuth working end-to-end via Render logs. Business ID c8e6dea8-fa44-4bea-8f3e-dff7b5a43eb6 live in Supabase.
- Confirmed DB migrations 001, 002, 005 applied (live query evidence). Applied migration 010 (workspace tables) via Supabase SQL editor.
- Confirmed owner had applied migrations 003–009 previously. All 10 migrations now confirmed applied.
- Created Pub/Sub topic `gmail-watch` in Google Cloud project `olivandertechnologies`.
- Granted `gmail-api-push@system.gserviceaccount.com` Pub/Sub Publisher role on the topic.
- Created push subscription `gmail-watch-push` → `https://olivander-api.onrender.com/webhook/gmail?token=<WEBHOOK_SECRET>`.
- Modified `backend/gmail/webhook.py` to accept secret via `?token=` query param (Pub/Sub push does not support custom static headers).
- Added CSS hover state to connected integration buttons: turns red, shows "Disconnect" text on hover.
- Committed all prior Codex work (51 files, Phases 4–7) and pushed to GitHub.
- **Blocker remaining**: `PUBSUB_TOPIC` env var not yet set on Render. Gmail watch will not activate until this is added and Google is reconnected in app Settings.
- After `PUBSUB_TOPIC` is added and Google reconnected, first end-to-end email test can run.
- `WEBHOOK_SECRET` should be rotated after end-to-end test is confirmed working.

### 2026-05-01

- Created this build report.
- Added sent-mail voice calibration as a tracked product requirement.
- Set the next step as OAuth verification, migration verification, real onboarding dry run, then voice calibration implementation.
- Added `docs/build_report_agent_rules.md` so future agents update this report consistently.
- Added `docs/agent_handoff.md` and linked it from `AGENTS.md` and `CLAUDE.md` so Codex and Claude can share prior work context.
- Added Calendar Command Centre as a tracked build requirement for daily planning, booking availability, event approvals, and job-linked schedule context.

## Open Questions

- Should first-customer onboarding scan only recent sent mail for speed, or offer an optional deeper historical calibration after launch?
- What is the minimum acceptable source count before trusting the voice profile: 10, 25, or 50 owner-sent customer emails?
- Should the first calibration scenario be chosen automatically from business type, or should the owner pick from new lead, booking, quote follow-up, invoice question, and reschedule request?
- Should Admin Starter include voice calibration, or should deeper historical backfill be Admin Plus only?
- Should Calendar Command Centre be included in Admin Starter as a simple Today schedule, with advanced gap/conflict/money-at-risk views reserved for Admin Plus?
- Should travel-time awareness be manual at first, or should it use an external maps API later?
