# Olivander — Project Guide

> Authoritative reference: `Olivander_PRD.docx` (PRD v5.0, April 2026). This file distils the working rules for development.

## What This Is

An AI operations layer for NZ South Island service SMEs. Connects to Gmail, Google Calendar, and Xero. Classifies inbound events, drafts responses using business memory, queues actions for owner approval, learns from edits.

**MVP ships when:** Google OAuth resolved, Gmail integration live, three core workflows (email triage, booking handling, invoice creation) working end-to-end for one real paying customer.

## Stack

| Layer | Technology | Hosting |
|-------|-----------|---------|
| Frontend | React / Vite | Vercel (`olivander.vercel.app`) |
| Backend API | FastAPI (Python 3.12) | Render |
| Database | Supabase (PostgreSQL + pgvector) | Supabase |
| AI | Groq API (`llama-3.3-70b-versatile`) | Groq |
| Email/Calendar | Gmail API + Google Calendar API | Google |
| Accounting | Xero API | Xero |

## Brand Rules

### Colours (PRD v5.0 Authoritative Palette)

The values below are from PRD v5.0 Section 0.2. `tokens.css` is the implementation reference.

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | `#F5F0E8` | Page background |
| `--card` | `#FDFAF4` | Card surface |
| `--act` | `#5A4FD0` | Action / Brand (buttons, active nav, links, focus rings) |
| Purple Tint | `#EDE9FF` | Badge backgrounds, info callouts |
| Purple Mid | `#8377E8` | Pending state indicators |
| Slate Dark | `#2C3240` | Nav, headings |
| Slate Primary | `#3D4452` | Body text |
| Slate Secondary | `#5C6475` | Supporting copy |
| Slate Muted | `#8C93A4` | Timestamps, labels, captions |
| Cream Tinted | `#EDE6D8` | Table row alternates, neutral badges |
| Cream Border | `#DED9D0` | Card borders, table lines |
| Success | `#2E7D52` | Approve, paid, active connections |
| Warning | `#D08B12` | Usage thresholds, flags |
| Danger | `#C42B2B` | Errors, delete, reject |

### Typography

| Context | Typeface | Weight | Size |
|---------|----------|--------|------|
| Display / Wordmark | Fraunces | 700 | 40px desktop |
| Section heading | Fraunces | 700 | 28px |
| Card title | DM Sans | 600 | 18px |
| Body text | DM Sans | 400 | 16px |
| Supporting copy | DM Sans | 400 | 14px |
| Captions / meta | DM Sans | 400 | 12px |
| Primary button | DM Sans | 500 | 14px |

### UI Surface Rules

- Cards: `#FDFAF4` on `#F5F0E8` base. Elevation through colour contrast only.
- No drop shadows, no gradients, no white (`#FFFFFF`) card backgrounds.
- Primary button: `#5A4FD0` fill, white text, 8px radius. One primary per screen.
- The "O" in Olivander is always `#5A4FD0`. All other letters Slate Dark on light surfaces.
- 2px `#5A4FD0` focus ring on every interactive element. WCAG 2.1 AA minimum.

### Brand Voice

Speak like a capable, no-nonsense operator. Natural and grounded. Never apologise for limitations. Never use jargon. State facts, propose actions, confirm outcomes.

## Build Principles

1. **Approval-first is non-negotiable.** No agent action sends without owner sign-off. All actions Tier 3 in week 1.
2. **One thing working completely before touching the next.** Never leave a feature half-built.
3. **Build the provider abstraction layer before any model-specific code.** AI costs fall rapidly.
4. **Credentials live in environment variables only.** Never hardcoded. Never pasted.
5. **Finance actions never above Tier 3.** No invoice ever executes without the owner seeing it.
6. **Full thread context before any reply.** Fetch the entire email thread, not just the latest message.
7. **Verify before chasing.** Finance Worker queries Xero live immediately before every chaser. No caching.

## Architecture

```
backend/
  main.py              FastAPI app, inline routes, middleware, CORS
  config.py            Environment + secrets loading
  rate_limit.py        SlowAPI rate limiter
  core/
    ai.py              AI provider abstraction (Groq, cost tracking)
  agent/
    classify.py        Email classification via Groq LLM
    draft.py           Draft reply + agent plan generation
  api/
    actions.py         Approval action endpoints (approve/reject/edit)
    calendar.py        Calendar availability + event endpoints
    email_actions.py   Email-tap approval webhooks
    invoices.py        Invoice creation (natural language → Xero)
  auth/
    deps.py            JWT auth dependency
    google.py          Google OAuth router (PKCE)
    tokens.py          Token encryption, refresh, storage
    xero.py            Xero OAuth router
  db/
    supabase.py        All Supabase database operations
    schema.sql         Database schema
    migrations/        SQL migration files
  gmail/
    client.py          Gmail API wrapper
    webhook.py         Gmail Pub/Sub webhook + processing pipeline
  gcal/
    client.py          Google Calendar API wrapper
  xero/
    client.py          Xero API client (invoices, contacts)
  notifications/
    email_sender.py    Approval notification emails (HTML, HMAC tokens)
  jobs/
    queue.py           JobRunner (30s poll) + enqueue_job() helper
    handlers.py        Handlers: follow_up_email, renew_gmail_watch, chase_invoice, calendar_reminder
  tests/
    test_security.py   Security integration tests

frontend/src/
  App.jsx              Slim orchestrator (~6 lines, wraps DashboardApp)
  components/          All UI components (DashboardApp, panels, cards, icons, OnboardingWizard)
  utils/               Pure utilities (constants, format, storage, api, task, memory)
  styles/
    tokens.css         Design token variables
    global.css         Global styles
    dashboard.css      Dashboard-specific styles
```

## Database (Supabase)

Current tables: `businesses`, `approvals`, `memory`, `activity`, `oauth_states`

Row Level Security enabled on all tenant tables. All queries scoped to authenticated tenant.

## Pending DB Migrations (run against Supabase)

| File | Description |
|------|-------------|
| `backend/db/migrations/003_ai_usage.sql` | `ai_usage` table for LLM cost tracking |
| `backend/db/migrations/004_xero_columns.sql` | Adds Xero token columns to `businesses` |
| `backend/db/migrations/005_job_queue.sql` | `job_queue` table for background jobs and follow-up sequences |

## Local Development

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Fill in all values
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
cp .env.example .env  # Set VITE_API_URL=http://localhost:8000
npm run dev
```

## Deployment

- **Backend:** Render (Docker, `render.yaml` at project root)
- **Frontend:** Vercel (auto-deploys from GitHub)
- **Database:** Supabase (managed PostgreSQL)

Required env vars on Render:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_ORIGIN`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`,
`JWT_SECRET`, `ENCRYPTION_KEY`, `WEBHOOK_SECRET`

## Key Docs

| File | Purpose |
|------|---------|
| `Olivander_PRD.docx` | Authoritative PRD v5.0 — full spec |
| `docs/api_reference.md` | API endpoint documentation |
| `docs/security_audit.md` | Security audit record (April 2026) |
| `docs/testing_guide.md` | End-to-end testing checklist |
