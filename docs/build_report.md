# Olivander Build Report

Last updated: 2026-05-01, Pacific/Auckland

This is the working build report for Olivander. Keep it current when product scope changes, when a meaningful implementation change lands, or when a blocker is resolved. Agents maintaining this file must follow `docs/build_report_agent_rules.md` and leave session continuity notes in `docs/agent_handoff.md`.

## Source Order

Use these sources in this order when deciding what to build:

1. `Olivander_PRD_v6.docx` - current product direction. Supersedes PRD v5.
2. `Olivander_First_Customer_Build_Spec_Two_Plans.pdf` - first customer tradie scope and plan split.
3. `Olivander_PRD.docx` - PRD v5 detail where v6 does not contradict it.
4. `AGENTS.md` - codebase rules, brand rules, and implementation guardrails.
5. `PLATFORM_STATUS.md` - historical status snapshot from 2026-04-22. Useful, but not guaranteed to match the live deployment or current git state.

## Build Principle For This Report

One thing working completely before touching the next. For the MVP, that means Gmail and approval-first email drafting must work end to end before deeper Phase 2 work.

## Current Product Shape

Olivander is an approval-first AI admin layer for NZ South Island service SMEs. The first customer build narrows that into a practical admin assistant for tradies: Today, Inbox, Jobs, Ask Olivander, Activity, and Settings.

Core promise:

- Find admin work before it goes missing.
- Draft the next reply, follow-up, booking step, quote, or invoice action.
- Show why the action exists.
- Require owner approval before anything customer-facing is sent or changed.

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

Unconfirmed or blocked:

- Google OAuth still appears to be the MVP blocker from the PRDs and status doc. The known issue is `invalid_request` on OAuth callback.
- Live deployment state has not been verified in this report.
- Supabase migration application is not confirmed. Migrations `003` through `010` need to be checked against the real database.
- Xero OAuth/invoice flow is implemented in code but still needs a live end-to-end test.
- Gmail Pub/Sub watch configuration must be verified after OAuth is fixed.
- The working tree already contains many uncommitted changes. Treat pre-existing diffs as prior work unless explicitly reviewed.

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

Immediate next build step:

1. Resolve Google OAuth `invalid_request`.
2. Confirm the deployed Google redirect URI matches the Google Cloud Console value exactly.
3. Confirm OAuth consent includes Gmail readonly, Gmail compose, Calendar events, userinfo email, and userinfo profile.
4. Apply or verify Supabase migrations `003` through `010`.
5. Run a real onboarding dry run against a connected Gmail account.

Once OAuth and dry run are working, implement sent-mail voice calibration before expanding deeper Calendar/Xero work. Calendar Command Centre should follow as the first substantial workflow feature after the email trust loop, because it ties booking requests, job dates, and daily planning together.

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

## Running Change Log

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
