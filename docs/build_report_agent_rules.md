# Build Report Agent Rules

Use this document whenever you change product scope, implementation state, blockers, migrations, deployment status, or next steps for Olivander. The target document is `docs/build_report.md`.

## Core Rule

Update `docs/build_report.md` in the same turn as any meaningful product or build change. Do not leave the report stale and assume a later agent will reconstruct what happened.

## When To Update

Update the build report when any of these happen:

- A feature is added, removed, scoped down, or re-prioritised.
- A blocker is found, resolved, downgraded, or replaced by a more specific blocker.
- A PRD, customer spec, or user request changes the build direction.
- A migration is added, applied, verified, or found missing.
- An integration status changes, especially Google, Gmail, Calendar, Xero, Supabase, Groq, Render, or Vercel.
- A workflow becomes end-to-end testable or fails an end-to-end test.
- A new build principle, guardrail, or compliance requirement is introduced.
- The "Next Step" changes.

Do not update it for tiny mechanical edits that do not change product behaviour, architecture, scope, risks, or verification status.

## Required Read Before Updating

Before editing `docs/build_report.md`, quickly read:

1. `docs/build_report.md`
2. `docs/agent_handoff.md`
3. `AGENTS.md` or `CLAUDE.md`, depending on the tool
4. Any directly relevant source doc or code file you are changing

If the change touches product direction, also check:

1. `Olivander_PRD_v6.docx`
2. `Olivander_First_Customer_Build_Spec_Two_Plans.pdf`
3. `Olivander_PRD.docx` only where v6 is silent

## Update Format

Keep the report plain and operational. Prefer short bullets over narrative.

Every update should do at least one of these:

- Move an item from unconfirmed to confirmed, or from confirmed to blocked.
- Add evidence for a status claim.
- Replace a vague blocker with a concrete blocker.
- Add or update a dated change-log entry.
- Update the immediate next step.
- Add acceptance criteria for a new requirement.

## Evidence Standard

Status claims must say how they are known:

- Repo inspection: name the file, endpoint, migration, component, or module.
- Test verification: name the command, endpoint, browser flow, or deployment checked.
- External platform verification: name the platform and exact setting checked.
- User decision: mark it as an owner request and date it.

Avoid claims like "done" or "live" without evidence.

## Change Log Rules

Use a dated entry under `Running Change Log`.

Each entry should include:

- What changed.
- Why it matters for the MVP or first customer.
- Any verification performed.
- Any remaining follow-up.

If several changes happen in one turn, group them under one date.

## Next Step Rules

The `Next Step` section must always contain the real immediate build step, not a long roadmap.

Good next steps are concrete:

- "Fix Google OAuth `invalid_request` by verifying redirect URI and callback logs."
- "Run migrations `003` through `010` against Supabase and record results."
- "Implement sent-mail voice calibration API and onboarding card."

Weak next steps are too broad:

- "Improve the app."
- "Continue MVP."
- "Work on integrations."

## Product Direction Rules

Preserve these priorities unless the owner explicitly changes them:

- Approval-first remains non-negotiable.
- Gmail and approval-first email drafting come before deeper Phase 2 work.
- Finance actions never execute without owner review.
- First-customer tradie scope beats broad platform expansion until weekly use is proven.
- Sent-mail voice calibration is part of the onboarding trust moment and should be built after OAuth/dry-run are working.

## Do Not

- Do not rewrite the whole report when a small section update is enough.
- Do not delete old blockers without saying why they are resolved or no longer relevant.
- Do not mark migrations applied unless verified against Supabase.
- Do not mark deployment live unless checked on the real deployed service.
- Do not store secrets, tokens, or private customer email content in the report.
- Do not copy long PRD passages into the report. Summarise the decision and cite the source filename.
- Do not overwrite user or prior-agent work in the git tree to make the report look cleaner.

## Done Criteria

An update is complete when:

- `docs/build_report.md` reflects the current decision or build state.
- The dated change log includes the update.
- The next step is still accurate.
- `docs/agent_handoff.md` has a session entry when the report update is part of meaningful agent work.
- Any unknowns are clearly marked as unconfirmed instead of implied done.
