# Olivander — Complete Product Roadmap
## Agentic AI System for SME Administrative Automation
**Version 1.0 — April 2026**

---

## Executive Summary

Olivander is an **agentic AI platform** that automates administrative work for small-to-medium enterprises (SMEs) while maintaining a persistent, growing memory of their business. The system uses RAG (Retrieval-Augmented Generation) to continuously learn from business operations and improve its autonomous decision-making within approval-based workflows.

**Core Philosophy**: Remove time-consuming administrative tasks while keeping business owners in control through approval gates.

---

## Phase Overview

| Phase | Feature Area | Status | Est. Timeline |
|-------|------|--------|---|
| Phase 1 | Email Communication (MVP) | ✅ Complete | Done |
| Phase 2 | SMS & Messaging | Planned | Q2 2026 |
| Phase 3 | Calendar & Scheduling | Planned | Q2 2026 |
| Phase 4 | Invoicing & Payments | Planned | Q3 2026 |
| Phase 5 | Customer Relationship Management | Planned | Q3 2026 |
| Phase 6 | Proposals & Contracts | Planned | Q3 2026 |
| Phase 7 | Support & Feedback | Planned | Q4 2026 |
| Phase 8 | Reporting & Insights | Planned | Q4 2026 |
| Phase 9 | Competitor Intelligence & Research | Planned | Q4 2026 |

---

# PHASE 1: EMAIL COMMUNICATION (MVP) ✅ COMPLETE

## Status
**Implementation Complete** — All endpoints built, database schema deployed, ready for end-to-end testing with real Gmail.

## What's Included

### 1.1 Gmail Integration
- Google OAuth connect/disconnect flow
- AES-256 encrypted token storage and refresh
- Webhook receiver for Cloud Pub/Sub email notifications
- Thread history retrieval with full conversation context

### 1.2 Email Classification
- AI-powered categorization using Groq LLM
  - new_lead
  - existing_client
  - booking_request
  - complaint
  - invoice_received
  - payment_confirmation
  - fyi
  - spam
- Urgency assessment (high/normal/low)
- Sender identification against customer records

### 1.3 Context-Aware Reply Drafting
- Uses business memory: tone, services, pricing, payment terms
- Retrieves relevant customer history via RAG
- Generates 3-6 sentence replies personalized to business voice
- Respects New Zealand English and cultural conventions
- Includes [OWNER INPUT NEEDED] markers for missing context

### 1.4 Approval-First Workflow
- Draft queued for owner approval (Tier 3)
- Approval email with:
  - Full draft preview
  - Approve/reject/edit action links
  - Cryptographically signed to prevent tampering
  - Can be approved from any device (including phone)
- Owner can edit before sending
- Owner can reject with reason

### 1.5 Email Execution & Auditing
- Email sent via Gmail API after approval
- Maintains thread context in Gmail
- Proper subject line formatting (Re: Original)
- Complete audit trail logged
  - Classification result
  - Draft generated
  - Approval decision
  - Final email sent
  - Timestamps and metadata

### 1.6 Follow-up Sequences
- Scheduled follow-up job queue
- Halt on customer reply (don't auto-follow if they respond)
- Configurable delays and sequences
- Approval required for each follow-up

## Technical Foundation

### Database Tables
- `businesses` — Business accounts with OAuth tokens
- `approvals` — Pending email drafts awaiting approval
- `memory` — Business context (RAG source)
- `memory_embeddings` — Vector embeddings for RAG
- `activity` — Complete audit log
- `oauth_states` — OAuth flow state management
- `job_queue` — Follow-up sequences and scheduled tasks

### API Endpoints (22 total)
- `/auth/google/connect` — OAuth initiation
- `/auth/google/callback` — OAuth token exchange
- `/api/approvals` — List all pending approvals
- `/api/approvals/{id}` — Get approval details
- `/api/approvals/{id}/approve` — Approve and send email
- `/api/approvals/{id}/reject` — Reject with reason
- `/api/approvals/{id}/edit` — Edit draft before sending
- `/health` — Health check
- Plus authentication and utility endpoints

### Security
- ✅ JWT authentication (Google OAuth)
- ✅ HMAC-SHA256 webhook verification
- ✅ Row-level security (RLS) on all business tables
- ✅ AES-256 token encryption
- ✅ Rate limiting (60 req/min default, 100 for webhooks)
- ✅ CORS restricted to known origins

---

# PHASE 2: SMS & MESSAGING

## Goals
Extend approval-first workflow to SMS and messaging platforms.

## Features

### 2.1 SMS Communication
- Trigger: Incoming SMS from customers
- Classification: Same as email (booking, inquiry, confirmation, etc.)
- Drafting: Context-aware SMS replies (concise, under 160 chars)
- Approval: Same approval workflow
- Execution: Send via Twilio/MessageBird

### 2.2 Messaging Platform Support
- WhatsApp Business API
- Facebook Messenger
- Slack (for business-to-B2B communications)
- Each with same classify → draft → approve → send flow

### 2.3 Cross-Channel Context
- Unified customer view across email, SMS, messaging
- Conversation history spans all channels
- Memory system learns from all interactions

### 2.4 Tone Adaptation
- SMS: Shorter, punchier drafts
- WhatsApp: Slightly longer, more conversational
- Messenger: Platform-specific formatting
- All respect business memory and voice

---

# PHASE 3: CALENDAR & SCHEDULING

## Goals
Handle meeting logistics with AI coordination.

## Features

### 3.1 Meeting Request Parsing
- AI extracts: proposed times, duration, meeting type, attendees
- Classifies urgency and type (sales call, support, consultation, etc.)

### 3.2 Availability Checking
- Check owner's calendar for conflicts
- Account for travel time, prep time
- Respect business hours and buffer zones
- Consider team availability for team meetings

### 3.3 Time Proposal
- AI suggests 3 alternative times if requested time unavailable
- Respects customer's timezone preference
- Proposes reasonable alternatives (business hours, no back-to-back)

### 3.4 Calendar Management
- Create calendar blocks based on workload
- Auto-block prep time before meetings
- Block deep work time
- Generate meeting agendas from context:
  - Customer history
  - Previous meeting notes
  - Business goals

### 3.5 Reminder & Notification Sequences
- Automated reminders: 24h, 1h, 15min before
- Custom reminder tone based on meeting type
- Link to Zoom/Teams call for virtual meetings
- Reschedule with one-click for attendees

### 3.6 Follow-up Scheduling
- Schedule follow-up based on meeting outcome
- Auto-create tasks from meeting notes
- Set reminders for action items

---

# PHASE 4: INVOICING & PAYMENTS

## Goals
Automate billing workflows with context-aware intelligence.

## Features

### 4.1 Invoice Generation
- Draft invoices from templates + business memory
- Use personalized payment terms per customer:
  - New customers: NET 14
  - High-value customers: NET 30
  - Problem accounts: payment upfront
- Include business branding, terms, contact info
- Approval workflow before sending

### 4.2 Payment Reminders
- Escalating tone based on days overdue:
  - Day 7: Friendly reminder
  - Day 14: Slightly more urgent
  - Day 21+: Direct, professional
- Smart timing: Don't remind high-value customers aggressively
- Personalized message referencing invoice details
- Link to payment portal

### 4.3 Payment Reconciliation
- Track received payments against invoices
- Auto-match manual bank transfers
- Flag partial payments
- Identify overdue invoices
- Alert owner to anomalies

### 4.4 Refund & Credit Decisions
- AI applies business policy to refund requests
- Considers:
  - Customer history (dispute rate)
  - Account value (VIP treatment)
  - Refund policy in memory
  - Legitimate reason assessment
- Automatically approve low-risk refunds
- Flag edge cases for owner approval

### 4.5 Customer Payment History
- Maintain payment patterns per customer
- Predict payment timeliness for new invoices
- Adjust terms automatically based on track record

---

# PHASE 5: CUSTOMER RELATIONSHIP MANAGEMENT

## Goals
Intelligent customer lifecycle management with memory-driven actions.

## Features

### 5.1 Customer Segmentation
- Automatic segmentation:
  - High-value (top 20% by spend)
  - At-risk (declining spend, infrequent contact)
  - New (< 3 months since first contact)
  - Loyal (consistent repeat customers)
  - Dormant (no activity in 6+ months)
- Update segments weekly

### 5.2 Personalized Follow-ups
- Segment-specific outreach sequences
- High-value: Monthly check-in, VIP offers
- At-risk: "We miss you" campaigns, special offers
- New: Onboarding sequence, success validation
- Loyalty: Exclusive access, referral programs
- All follow-ups require approval before sending

### 5.3 Upsell & Cross-sell
- AI identifies opportunities based on:
  - Customer purchase history
  - Similar customers' behavior
  - Business services offered
  - Customer's stated needs
- Generate personalized recommendations
- Timing: Not too aggressive, respect past behavior
- Approval workflow for outreach

### 5.4 Churn Detection & Win-back
- Identify customers likely to leave:
  - Declining frequency
  - Single-purchase customers not returning
  - Negative sentiment in communications
- Trigger win-back campaign:
  - Personalized re-engagement offer
  - Highlight new features/services
  - Remove friction (special offer, discount)
- Track success of win-back efforts

### 5.5 Customer Notes & Context
- AI summarizes interactions automatically
- Extract: preferences, pain points, objections, interests
- Store in memory for future context
- Flag VIP customers for special handling

---

# PHASE 6: PROPOSALS & CONTRACTS

## Goals
Automate document generation with business-specific customization.

## Features

### 6.1 Proposal Generation
- AI drafts from templates + customer context
- Includes:
  - Personalized scope of work
  - Pricing (from memory: standard rates, discounts for repeat customers)
  - Timeline
  - Terms & conditions
  - Payment schedule
- Uses business memory for tone and standard terms
- Approval before sending

### 6.2 Contract Generation
- Templates for common agreements
- Auto-fill: business details, customer info, standard terms
- Signature workflow (DocuSign, HelloSign integration)
- Store signed contracts in audit trail

### 6.3 Policy Documents
- Auto-generate from memory:
  - Refund policy
  - Terms of service
  - Privacy policy
  - Cancellation policy
  - Payment terms
- Keep updated as business memory evolves
- Version control in audit log

### 6.4 Dynamic Pricing
- Proposals include customized pricing based on:
  - Customer segment (VIP discount, bulk discount)
  - Historical pricing decisions
  - Market conditions
  - Customer lifetime value
- Approval required for non-standard pricing

---

# PHASE 7: SUPPORT & FEEDBACK

## Goals
Streamline customer support with intelligent triage and response.

## Features

### 7.1 Support Ticket Triage
- Classify incoming support requests:
  - Billing/invoice question
  - Technical issue
  - Feature request
  - Complaint
  - General inquiry
- Assign urgency:
  - Critical (service down)
  - High (customer blocked)
  - Normal (standard issue)
  - Low (feature request, question)

### 7.2 Auto-Response Drafting
- Draft responses using:
  - FAQ database from memory
  - Previous solutions to similar issues
  - Business context and policies
  - Customer history
- Escalate complex issues to owner
- Approval workflow for responses

### 7.3 Issue Resolution Tracking
- Track ticket through resolution
- Auto-close when issue resolved
- Follow-up: "Did we solve your issue?"
- Satisfaction survey

### 7.4 Feedback Synthesis
- Aggregate feedback across channels
- Identify patterns:
  - Recurring complaints
  - Frequently requested features
  - Common support questions
- Generate weekly report:
  - Top issues
  - Recommendations
  - Actionable insights
- Alert owner to critical feedback

### 7.5 FAQ & Knowledge Base
- Auto-populate from resolved tickets
- Link tickets to relevant FAQs
- Learn over time what questions get asked
- Feed into proposal/support drafting

---

# PHASE 8: REPORTING & INSIGHTS

## Goals
Provide actionable business intelligence from all operational data.

## Features

### 8.1 Business Summaries
- Weekly report:
  - Revenue (invoiced, paid, outstanding)
  - Customer activity (new, lost, engaged)
  - Top communication issues
  - Team workload/efficiency
  - Key metrics trending
- Monthly deep-dive:
  - Performance vs. last month
  - Seasonal patterns
  - Forecasts

### 8.2 Customer Sentiment Analysis
- Mine communications for sentiment:
  - Emails, SMS, reviews, support tickets
  - Classify: very positive, positive, neutral, negative, very negative
  - Identify detractors and promoters
- Trends over time
- Segment analysis (does one customer type have lower satisfaction?)

### 8.3 Performance Metrics
- Operational:
  - Response time (how fast do we reply?)
  - Approval time (how long do approvals take?)
  - First-contact resolution rate
  - Customer satisfaction trend
- Financial:
  - Revenue by customer segment
  - Invoice aging (days to payment)
  - Refund rate
  - Customer lifetime value

### 8.4 Anomaly Detection
- Flag unusual patterns:
  - Payment delays from normally-reliable customer
  - Sudden increase in support tickets
  - Revenue drop vs. trend
  - High refund rate
- Alert owner with context and recommendation

### 8.5 Actionable Recommendations
- AI generates insights:
  - "High-value customer X hasn't ordered in 60 days → trigger win-back"
  - "Support tickets about feature Y → this is in-demand"
  - "Payment delays spiking → consider tighter terms"
  - "New customer segment looking for discounts → adjust pricing"

---

# PHASE 9: COMPETITOR INTELLIGENCE & RESEARCH

## Goals
Keep business strategically ahead of competitors through continuous market research.

## Features

### 9.1 Competitor Monitoring
- Track competitor websites for:
  - Pricing changes
  - New product/service launches
  - Feature updates
  - Website/branding changes
- Monitor social media:
  - New campaigns
  - Messaging shifts
  - Engagement trends
  - Content themes
- Set up keyword alerts for industry news
- Frequency: daily scans, weekly digest

### 9.2 Weakness Identification
- Analyze competitors relative to your business:
  - Feature gaps (what they don't offer that you do)
  - Pricing vulnerabilities (where you're cheaper/better value)
  - Customer complaints (review sites, social media):
    - Aggregate negative reviews by theme
    - Identify pain points competitors aren't solving
  - Service gaps (customers saying "wish they had X")
- Weekly report: "Here's where competitors are weak vs. us"

### 9.3 Market Research
- Industry trend tracking:
  - New technologies affecting your market
  - Regulatory changes
  - Customer need shifts
  - Seasonal patterns
- Customer sentiment in broader market:
  - Search trends related to your industry
  - Social media discussions
  - Emerging customer pain points
- Emerging opportunities:
  - Underserved niches
  - New market segments
  - Adjacent products/services customers want

### 9.4 Content Intelligence for Marketing
- AI analyzes competitive landscape and generates:
  - Social media campaign angles
    - "Competitor X just raised prices → post about our better value"
    - "Trending topic Y → tie it to our service"
  - Posts highlighting your competitive advantages
  - Campaign hooks based on competitor missteps
  - Blog post ideas from market gaps
  - Content calendar recommendations

### 9.5 Strategic Recommendations
- Weekly briefing:
  - "Competitor X just launched Y → consider responding with Z"
  - "Trending keyword about [pain point] → update your website"
  - "Customer pain point [X] your competitors ignore → feature marketing opportunity"
  - "Market shifting toward [trend] → this is urgent"
  - "Seasonal opportunity coming in [month] → start prep now"

### 9.6 Research Integration with Campaigns
- Feeds directly into social media/marketing approvals
- "Based on research, here's a draft social post about [opportunity]"
- Links research to action (which competitors to monitor for your niche)
- Tracks which research-driven campaigns perform best

---

# Architecture & Technical Principles

## Agentic AI Design

### Decision-Making Flow
```
Input (email, SMS, request)
  ↓
Classify/Understand (AI + business context)
  ↓
Retrieve Memory (RAG — relevant business context)
  ↓
Draft Action (personalized, contextual)
  ↓
Approval Gate (owner always in control)
  ↓
Execute & Log
  ↓
Learn (feedback loop for continuous improvement)
```

## Business Memory System

### What Gets Stored
- Brand voice & tone (examples, guides)
- Business policies (refund, payment terms, pricing)
- Customer segments & treatment rules
- Standard operating procedures
- Key facts (business name, location, services offered)
- Performance data (what works, what doesn't)

### How Memory Improves
1. Every action recorded in audit log
2. Owner feedback (approvals/rejections) train the system
3. Weekly digest of learnings
4. Embeddings updated as memory evolves
5. RAG retrieval gets more accurate over time

## Approval-First Philosophy

### Why Approval Gates Matter
- Owner maintains strategic control
- System learns from rejections
- Builds trust (AI isn't making unilateral decisions)
- Compliance ready (audit trail for regulatory requirements)

### Approval UX
- Phone-friendly approval links
- Can approve from anywhere
- Edit before sending (not all-or-nothing)
- Batch approvals for efficiency
- Quick reject with templated reasons

## RAG Implementation

### Retrieval
- Search business memory for relevant context
- Vector embeddings (semantic search, not keyword)
- Weighted toward recent, frequently-used memories
- Customer history prioritized

### Augmentation
- Combine retrieved memory with current context
- Prompt includes most relevant 5-10 memory items
- System knows what it knows vs. guesses (marks unknowns)

### Generation
- LLM generates action using augmented context
- Personalized to business voice
- Includes confidence markers
- Flags missing information for owner input

---

# Implementation Roadmap

## Q2 2026 (Phases 2-3)
- [ ] SMS/Twilio integration
- [ ] WhatsApp Business API integration
- [ ] Calendar integration (Google Calendar, Outlook)
- [ ] Meeting request parsing
- [ ] Auto-scheduling endpoints

## Q3 2026 (Phases 4-5)
- [ ] Invoicing templates and generation
- [ ] Payment tracking and reminders
- [ ] Customer segmentation engine
- [ ] Upsell/cross-sell recommendation system
- [ ] Churn detection model

## Q4 2026 (Phases 6-8)
- [ ] Proposal and contract generation
- [ ] Support ticket system integration
- [ ] Reporting dashboard and API
- [ ] Sentiment analysis engine
- [ ] Competitor monitoring tools

## Q1 2027 (Phase 9)
- [ ] Competitive intelligence scraping
- [ ] Market research aggregation
- [ ] Research-to-campaign workflow
- [ ] Strategic recommendation engine

---

# Success Metrics

## User Metrics
- **Time saved per week**: Target 10+ hours for SME owner
- **Approvals per day**: Measure adoption (should be 5-20)
- **Edit rate on drafts**: <20% edits = high quality drafts
- **Approval rate**: >80% approved = system aligns well with business

## Quality Metrics
- **Response personalization score**: Rated by owner (4+/5 target)
- **Accuracy of classification**: 95%+ correct category
- **Follow-up completion rate**: Scheduled tasks executed properly
- **Error rate**: <1% of actions cause issues

## Business Metrics
- **Admin time reduction**: 70%+ reduction in email/scheduling time
- **Customer satisfaction**: NPS trend improves
- **Revenue impact**: Faster response → fewer lost leads
- **Churn prevention**: Win-back campaigns recover X% of at-risk customers

---

# Security & Compliance

## Data Protection
- ✅ End-to-end encryption for OAuth tokens
- ✅ Row-level security for all multi-tenant data
- ✅ Audit log immutable (append-only)
- ✅ GDPR-ready data deletion workflows
- ✅ Regular penetration testing

## Approval Workflow Security
- ✅ Cryptographic signing of approval links (prevents tampering)
- ✅ Time-limited tokens (expire after 24h)
- ✅ Rate limiting per user
- ✅ IP validation option for sensitive accounts

## Compliance Ready
- ✅ SOC2 audit trail
- ✅ Exportable data for customer requests
- ✅ Encrypted secrets in environment
- ✅ Automated backups with point-in-time recovery

---

# Support & Documentation

## For Users
- Owner dashboard walkthrough
- Approval workflow guide
- Memory management tutorial
- Troubleshooting guide

## For Developers
- API reference with examples
- Database schema documentation
- Integration guides (Gmail, Twilio, etc.)
- RAG implementation details
- Testing strategies

---

# FAQ

**Q: Does Olivander replace my team?**
A: No. Olivander replaces repetitive administrative work, freeing your team for higher-value work. The owner stays in control via approval gates.

**Q: What if the AI makes a mistake?**
A: Owner sees the draft before sending. Mistakes are caught. System learns from rejections.

**Q: How does RAG improve over time?**
A: Every interaction is logged. Memory embeddings update as business context evolves. Over months, the AI becomes more aligned with how your business actually operates.

**Q: What happens if I change my business model?**
A: Update business memory (tone, policies, services). System applies new context to future decisions within weeks.

**Q: Can I use this for multiple businesses?**
A: Yes. Completely separate memory and context per business. Multi-tenant architecture.

**Q: Is there a learning curve?**
A: Minimal. Approval workflow is straightforward. Memory setup is a one-time 30-minute exercise.

---

# Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | April 2026 | Initial complete roadmap. Phase 1 (Email) complete. Phases 2-9 planned. |

