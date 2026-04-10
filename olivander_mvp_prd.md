# Olivander — Implementation PRD 2
## Gmail Integration, Email Processing Pipeline & Approval Flow
**Do not start this PRD until every checkbox in PRD 1's definition of done passes.**
April 2026

---

## What this PRD covers

MVP build steps 4–8:

4. Gmail webhook receiver (Cloud Pub/Sub setup + endpoint)
5. Email processing pipeline (classify → retrieve context → draft → queue)
6. Approval email (HTML email with signed approve/edit/reject links)
7. Approve/reject/edit endpoints (execute on approval, Gmail send, audit log)
8. Follow-up sequence scheduler (job_queue with future run_at, halt-on-reply)

When this PRD is done, the result is: a real email arrives in the connected Gmail inbox, Olivander classifies it, generates a draft reply, sends an approval email to the owner, and the owner can approve from their phone — which sends the reply via Gmail. The owner never has to open the dashboard to do this. The entire loop works end-to-end.

**Do not start PRD 3 (frontend screens) until every checkbox in the definition of done at the bottom of this file passes against a real Gmail inbox.**

---

## Assumed state going in

From PRD 1, the following are working and verified:

- Supabase schema: all 11 tables, RLS on all tables, auth trigger creating `tenants` rows
- Google OAuth: connect flow, token exchange, AES-256 encrypted token storage, token refresh
- Supabase Auth + FastAPI JWT middleware: `get_tenant_id()` extracting from HS256 JWT
- Environment variables: all set in Railway and Vercel

The file structure expected:

```
backend/
├── main.py
├── api/
│   └── auth.py              ✅ done
├── core/
│   ├── auth_middleware.py   ✅ done
│   └── encryption.py        ✅ done
└── db/
    └── supabase.py          ✅ done
```

Everything below is new work.

---

## Part 1 — AI provider abstraction

Before writing any pipeline code, build the AIProvider class. All Groq calls 
go through this class. Nothing else calls Groq directly.

**`backend/core/ai.py`**

```python
import os
import json
import asyncio
from dataclasses import dataclass
from groq import AsyncGroq

@dataclass
class ClassificationResult:
    classification: str   # new_lead | existing_client | booking_request | 
                          # complaint | invoice_received | payment_confirmation | 
                          # fyi | spam
    summary: str          # 2 sentences max, plain English
    urgency: str          # high | normal | low
    sender_is_known: bool

class AIProvider:
    def __init__(self):
        self.client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"])
        self.chat_model = "llama-3.3-70b-versatile"
        self.embed_model = "nomic-embed-text"   # See embedding note below
        self.timeout = 10  # seconds

    async def classify(self, thread_content: str, business_context: dict) -> ClassificationResult:
        prompt = self._classification_prompt(thread_content, business_context)
        response_text = await self._chat(prompt, expect_json=True)
        data = json.loads(response_text)
        return ClassificationResult(
            classification=data["classification"],
            summary=data["summary"],
            urgency=data.get("urgency", "normal"),
            sender_is_known=data.get("sender_is_known", False),
        )

    async def draft_reply(
        self,
        thread_content: str,
        business_context: dict,
        memory_chunks: list[str],
        customer_record: dict | None,
        classification: str,
        urgency: str,
    ) -> str:
        prompt = self._draft_prompt(
            thread_content, business_context, memory_chunks,
            customer_record, classification, urgency
        )
        return await self._chat(prompt, expect_json=False)

    async def embed(self, text: str) -> list[float]:
        """
        Returns a vector embedding for the given text.
        
        IMPORTANT: Groq does not currently offer an embedding endpoint.
        Use one of these alternatives in order of preference:
        
        1. If OPENAI_API_KEY is set: use OpenAI text-embedding-3-small (1536 dims).
           Update the memory_embeddings schema: vector(1536).
        
        2. If running locally or on a server with Ollama: use nomic-embed-text 
           via the Ollama API (768 dims). Matches current schema.
        
        3. Fallback: use a lightweight sentence-transformers model via HuggingFace
           inference API (768 dims).
        
        Decide which to use based on what API keys are available in Railway.
        Update the vector dimension in the schema to match before inserting rows.
        Do not mix dimensions — if you change models, re-embed all existing rows.
        """
        raise NotImplementedError("Choose embedding provider — see docstring above")

    async def _chat(self, prompt: str, expect_json: bool) -> str:
        for attempt in range(3):
            try:
                response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.chat_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                        response_format={"type": "json_object"} if expect_json else None,
                    ),
                    timeout=self.timeout,
                )
                return response.choices[0].message.content
            except asyncio.TimeoutError:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 ** attempt)
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 ** attempt)

    def _classification_prompt(self, thread: str, ctx: dict) -> str:
        known_emails = ", ".join(ctx.get("known_customer_emails", [])) or "none"
        return f"""You are an email classifier for a {ctx['business_type']} business called {ctx['business_name']} in New Zealand.

Classify the email thread below into exactly one category.
Return JSON only — no other text, no markdown, no explanation.

Categories: new_lead | existing_client | booking_request | complaint | invoice_received | payment_confirmation | fyi | spam

Known customer emails: {known_emails}

Email thread (newest message first):
{thread}

Respond with exactly:
{{"classification": "...", "summary": "one sentence, 15 words max", "urgency": "high|normal|low", "sender_is_known": true|false}}"""

    def _draft_prompt(
        self, thread: str, ctx: dict, chunks: list[str],
        customer: dict | None, classification: str, urgency: str
    ) -> str:
        memory_block = "\n".join(f"- {c}" for c in chunks) if chunks else "No specific memory available."
        customer_block = f"Customer record: {customer}" if customer else "Sender not in customer records."
        tone = ctx.get("tone_seed", "Professional but friendly. Direct. No corporate language.")
        
        return f"""You are drafting an email reply on behalf of {ctx['business_name']}, a {ctx['business_type']} business in Queenstown, New Zealand.

CRITICAL: Use ONLY the context provided below. If you need a fact you don't have — a specific price, date, name, or detail — write [OWNER INPUT NEEDED: describe what's missing] in that exact format. Never guess. Never invent facts.

Business context:
- Business: {ctx['business_name']} ({ctx['business_type']})
- Services: {ctx.get('services', 'not specified')}
- Pricing: {ctx.get('pricing_range', 'not specified')}
- Payment terms: {ctx.get('payment_terms', 20)} days

Relevant memory:
{memory_block}

{customer_block}

Tone reference — write in this style:
{tone}

Email thread to reply to (newest first):
{thread}

Classification: {classification}
Urgency: {urgency}

Write the reply body only. No subject line. No "Dear X" opener unless it's genuinely appropriate for the tone. 3–6 sentences. Sound like the business owner wrote it personally."""


# Singleton
ai = AIProvider()
```

**Embedding decision — make this now before writing any pipeline code:**

Check Railway environment variables. If `OPENAI_API_KEY` exists, use 
`text-embedding-3-small` (1536 dims) and update the schema:
```sql
ALTER TABLE memory_embeddings ALTER COLUMN embedding TYPE vector(1536);
DROP INDEX idx_memory_embeddings_vector;
CREATE INDEX idx_memory_embeddings_vector ON memory_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

If no OpenAI key, use the HuggingFace inference API with 
`sentence-transformers/all-MiniLM-L6-v2` (384 dims) and update accordingly.

The dimension does not matter as long as it is consistent. Pick one. Set it. 
Never mix dimensions in the same table.

---

## Part 2 — Gmail API client

**`backend/core/gmail.py`**

This wraps the Gmail API. All Gmail operations go through this class.

```python
import base64
import email as email_lib
from email.mime.text import MIMEText
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from core.encryption import decrypt
from db.supabase import supabase

class GmailClient:
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self._service = None

    async def _get_service(self):
        if self._service:
            return self._service
        # Fetch and decrypt tokens
        result = supabase.table("oauth_tokens").select("*").eq(
            "tenant_id", self.tenant_id
        ).eq("provider", "google").single().execute()
        
        if not result.data:
            raise ValueError(f"No Google tokens for tenant {self.tenant_id}")
        
        row = result.data
        access_token = decrypt(row["access_token_encrypted"])
        refresh_token = decrypt(row["refresh_token_encrypted"])
        
        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        )
        self._service = build("gmail", "v1", credentials=creds)
        return self._service

    async def get_thread(self, thread_id: str) -> dict:
        """Fetch full thread. Returns list of messages, each with sender, 
        subject, body, date."""
        svc = await self._get_service()
        thread = svc.users().threads().get(
            userId="me", id=thread_id, format="full"
        ).execute()
        return self._parse_thread(thread)

    async def send_reply(
        self, 
        to: str, 
        subject: str, 
        body: str, 
        thread_id: str,
        in_reply_to_message_id: str
    ) -> str:
        """Send a reply in an existing thread. Returns the sent message ID."""
        svc = await self._get_service()
        
        msg = MIMEText(body)
        msg["to"] = to
        msg["subject"] = subject if subject.startswith("Re:") else f"Re: {subject}"
        msg["In-Reply-To"] = in_reply_to_message_id
        msg["References"] = in_reply_to_message_id
        
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        sent = svc.users().messages().send(
            userId="me",
            body={"raw": raw, "threadId": thread_id}
        ).execute()
        return sent["id"]

    async def get_recent_messages(self, max_results: int = 10) -> list[dict]:
        """Fetch recent inbox messages. Used for onboarding dry run."""
        svc = await self._get_service()
        results = svc.users().messages().list(
            userId="me",
            labelIds=["INBOX"],
            maxResults=max_results,
        ).execute()
        
        messages = []
        for msg_ref in results.get("messages", []):
            msg = svc.users().messages().get(
                userId="me", id=msg_ref["id"], format="full"
            ).execute()
            messages.append(self._parse_message(msg))
        return messages

    async def watch_inbox(self, pubsub_topic: str) -> dict:
        """Subscribe to push notifications for this inbox.
        Call once on OAuth connect. Must be re-called every 7 days.
        Returns expiration timestamp."""
        svc = await self._get_service()
        return svc.users().watch(
            userId="me",
            body={
                "labelIds": ["INBOX"],
                "topicName": pubsub_topic,
            }
        ).execute()

    async def check_thread_for_reply(
        self, thread_id: str, after_timestamp: int
    ) -> bool:
        """Returns True if the client has replied to this thread 
        after the given Unix timestamp. Used to halt follow-up sequences."""
        thread = await self.get_thread(thread_id)
        owner_email = await self._get_owner_email()
        for msg in thread["messages"]:
            if (msg["timestamp"] > after_timestamp 
                    and msg["sender_email"].lower() != owner_email.lower()):
                return True
        return False

    async def _get_owner_email(self) -> str:
        result = supabase.table("oauth_tokens").select("google_email").eq(
            "tenant_id", self.tenant_id
        ).single().execute()
        return result.data["google_email"]

    def _parse_thread(self, raw_thread: dict) -> dict:
        return {
            "thread_id": raw_thread["id"],
            "messages": [self._parse_message(m) for m in raw_thread.get("messages", [])],
        }

    def _parse_message(self, raw_msg: dict) -> dict:
        headers = {h["name"].lower(): h["value"] 
                   for h in raw_msg.get("payload", {}).get("headers", [])}
        body = self._extract_body(raw_msg.get("payload", {}))
        return {
            "message_id": raw_msg["id"],
            "thread_id": raw_msg.get("threadId"),
            "sender": headers.get("from", ""),
            "sender_email": self._extract_email(headers.get("from", "")),
            "subject": headers.get("subject", "(no subject)"),
            "date": headers.get("date", ""),
            "timestamp": int(raw_msg.get("internalDate", 0)) // 1000,
            "body": body,
            "message_id_header": headers.get("message-id", ""),
        }

    def _extract_body(self, payload: dict) -> str:
        """Extract plain text body from Gmail payload, handling multipart."""
        if payload.get("mimeType") == "text/plain":
            data = payload.get("body", {}).get("data", "")
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        
        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/plain":
                data = part.get("body", {}).get("data", "")
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        
        # Fallback: try HTML part, strip tags crudely
        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/html":
                data = part.get("body", {}).get("data", "")
                html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                import re
                return re.sub(r"<[^>]+>", " ", html).strip()
        return ""

    def _extract_email(self, from_header: str) -> str:
        """Extract email address from 'Name <email>' format."""
        import re
        match = re.search(r"<([^>]+)>", from_header)
        return match.group(1).lower() if match else from_header.lower().strip()
```

Add to `requirements.txt`:
```
google-api-python-client
google-auth
google-auth-httplib2
```

---

## Part 3 — Cloud Pub/Sub setup

This is infrastructure setup, not code. Do this in Google Cloud Console before 
writing the webhook endpoint.

**Step 1 — Enable APIs**

In Google Cloud Console → APIs & Services → Enable:
- Cloud Pub/Sub API (if not already enabled)
- Gmail API (should already be enabled for OAuth)

**Step 2 — Create the Pub/Sub topic**

```
Topic name: olivander-gmail-push
```

In Cloud Console → Pub/Sub → Topics → Create Topic.

**Step 3 — Create the push subscription**

In Pub/Sub → Subscriptions → Create Subscription:
```
Subscription name:  olivander-gmail-push-sub
Topic:              olivander-gmail-push
Delivery type:      Push
Push endpoint:      https://olivander-production.up.railway.app/api/webhooks/gmail
Acknowledgement deadline: 10 seconds
Message retention:  7 days
```

**Step 4 — Verify the push endpoint domain**

Google requires domain verification before it will deliver push notifications 
to an HTTPS endpoint. In Pub/Sub → Subscriptions → your subscription → 
verify the push endpoint. Follow the verification steps for the Railway domain.

If Railway domain verification is not possible (Railway generates subdomains 
they don't own), use a custom domain pointed at Railway instead, then verify 
that domain.

**Step 5 — Set PUBSUB_VERIFICATION_TOKEN**

Create a random string (e.g. `openssl rand -hex 32`). Add it to Railway env vars 
as `PUBSUB_VERIFICATION_TOKEN`. This will be validated on every incoming webhook 
to prevent spoofed requests.

**Step 6 — Note the full topic name**

The full Pub/Sub topic name for the Gmail `watch()` call is:
```
projects/{YOUR_GOOGLE_CLOUD_PROJECT_ID}/topics/olivander-gmail-push
```

Store this as `PUBSUB_TOPIC_NAME` in Railway env vars.

---

## Part 4 — Gmail webhook receiver

**`backend/api/webhooks.py`**

```python
import os
import json
import base64
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from db.supabase import supabase
from workers.email_worker import process_email_job

router = APIRouter()

PUBSUB_VERIFICATION_TOKEN = os.environ.get("PUBSUB_VERIFICATION_TOKEN")

@router.post("/api/webhooks/gmail")
async def gmail_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives Gmail push notifications from Cloud Pub/Sub.
    Must acknowledge within 10 seconds or Pub/Sub retries.
    All real work is done in a background task.
    """
    # Step 1: Validate the verification token
    # Pub/Sub sends it as a query parameter when configured
    token = request.query_params.get("token")
    if token != PUBSUB_VERIFICATION_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid verification token")

    # Step 2: Parse the Pub/Sub message
    try:
        body = await request.json()
        message = body.get("message", {})
        data_b64 = message.get("data", "")
        data = json.loads(base64.b64decode(data_b64).decode("utf-8"))
    except Exception:
        # Bad payload — acknowledge anyway to prevent infinite retries
        return {"status": "ok"}

    # Pub/Sub Gmail notifications contain:
    # {"emailAddress": "user@gmail.com", "historyId": "12345"}
    gmail_address = data.get("emailAddress")
    history_id = data.get("historyId")

    if not gmail_address or not history_id:
        return {"status": "ok"}

    # Step 3: Find the tenant for this Gmail address
    result = supabase.table("oauth_tokens").select("tenant_id").eq(
        "provider", "google"
    ).eq("google_email", gmail_address).execute()

    if not result.data:
        # No tenant found for this address — acknowledge and ignore
        return {"status": "ok"}

    tenant_id = result.data[0]["tenant_id"]

    # Step 4: Find new message IDs using Gmail History API
    # The historyId tells us where the inbox changed — fetch messages since then
    new_message_ids = await get_new_message_ids(tenant_id, history_id)

    # Step 5: For each new message, check dedup and queue a job
    for message_id in new_message_ids:
        # Dedup: check if we've already seen this message
        existing = supabase.table("action_queue").select("id").eq(
            "gmail_message_id", message_id
        ).execute()
        
        if existing.data:
            continue  # Already processed

        # Queue the job
        supabase.table("job_queue").insert({
            "tenant_id": tenant_id,
            "job_type": "process_email",
            "payload": {
                "tenant_id": tenant_id,
                "gmail_message_id": message_id,
            },
            "status": "pending",
        }).execute()

    # Acknowledge immediately — Pub/Sub requires response within 10s
    return {"status": "ok"}


async def get_new_message_ids(tenant_id: str, history_id: str) -> list[str]:
    """
    Use the Gmail History API to find message IDs added since the given historyId.
    
    We need to store the last processed historyId per tenant so we can fetch 
    only new messages. Store it in the tenants table.
    
    Add column to tenants table:
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_history_id text;
    """
    from core.gmail import GmailClient
    gmail = GmailClient(tenant_id)
    svc = await gmail._get_service()
    
    # Get last known history ID for this tenant
    tenant = supabase.table("tenants").select("gmail_history_id").eq(
        "id", tenant_id
    ).single().execute()
    start_history_id = tenant.data.get("gmail_history_id") or history_id
    
    try:
        history = svc.users().history().list(
            userId="me",
            startHistoryId=start_history_id,
            historyTypes=["messageAdded"],
            labelId="INBOX",
        ).execute()
    except Exception:
        # History ID too old or invalid — return empty list
        # Update history ID and continue
        supabase.table("tenants").update(
            {"gmail_history_id": history_id}
        ).eq("id", tenant_id).execute()
        return []

    message_ids = []
    for record in history.get("history", []):
        for msg in record.get("messagesAdded", []):
            message_ids.append(msg["message"]["id"])

    # Update the stored history ID
    supabase.table("tenants").update(
        {"gmail_history_id": history_id}
    ).eq("id", tenant_id).execute()

    return message_ids
```

Add this migration to run in Supabase:
```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_history_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_frequency text 
  NOT NULL DEFAULT 'realtime' 
  CHECK (notification_frequency IN ('realtime', 'morning_digest', 'weekly'));
```

Register the router in `main.py`:
```python
from api.webhooks import router as webhooks_router
app.include_router(webhooks_router)
```

---

## Part 5 — Email processing worker

This is the core of the product. Read it entirely before writing a line.

**`backend/workers/email_worker.py`**

```python
import asyncio
from datetime import datetime, timedelta
from db.supabase import supabase
from core.ai import ai, ClassificationResult
from core.gmail import GmailClient
from core.email_sender import send_approval_email

STOP_CLASSIFICATIONS = {"spam", "fyi"}

async def process_email_job(tenant_id: str, gmail_message_id: str):
    """
    Full pipeline for a single inbound email.
    Called by the job queue worker.
    Logs every step to audit_log. Never raises — catches and logs all errors.
    """
    try:
        await _process(tenant_id, gmail_message_id)
    except Exception as e:
        # Log the error and mark the job failed — never let this crash the worker
        supabase.table("audit_log").insert({
            "tenant_id": tenant_id,
            "event_type": "error",
            "trigger_source": "gmail_webhook",
            "error_detail": str(e),
        }).execute()
        raise  # Re-raise so the job queue worker can increment attempts


async def _process(tenant_id: str, gmail_message_id: str):
    # ── Step 1: Fetch business context ──────────────────────────────
    tenant = supabase.table("tenants").select("*").eq(
        "id", tenant_id
    ).single().execute().data
    
    profile = supabase.table("business_profile").select("*").eq(
        "tenant_id", tenant_id
    ).execute()
    profile_data = profile.data[0] if profile.data else {}

    # Known customer emails for classification context
    customers_result = supabase.table("customers").select("email").eq(
        "tenant_id", tenant_id
    ).execute()
    known_emails = [c["email"] for c in customers_result.data if c.get("email")]

    business_context = {
        "business_name": tenant["business_name"],
        "business_type": tenant.get("business_type", "service"),
        "services": profile_data.get("services", []),
        "pricing_range": profile_data.get("pricing_range", ""),
        "payment_terms": profile_data.get("payment_terms", 20),
        "tone_seed": profile_data.get("tone_seed", ""),
        "comm_rules": profile_data.get("comm_rules", ""),
        "known_customer_emails": known_emails,
    }

    # ── Step 2: Fetch the full email thread ─────────────────────────
    gmail = GmailClient(tenant_id)
    
    # First get the message to find its thread ID
    svc = await gmail._get_service()
    msg = svc.users().messages().get(
        userId="me", id=gmail_message_id, format="metadata",
        metadataHeaders=["threadId"]
    ).execute()
    thread_id = msg.get("threadId", gmail_message_id)

    thread = await gmail.get_thread(thread_id)
    messages = thread["messages"]
    
    if not messages:
        return

    # Build thread text for the AI (newest first, last 5 messages max)
    latest_message = messages[-1]
    thread_text = _format_thread(messages[-5:])

    # ── Step 3: Classify ────────────────────────────────────────────
    classification: ClassificationResult = await ai.classify(
        thread_content=thread_text,
        business_context=business_context,
    )

    # Log the classification
    supabase.table("audit_log").insert({
        "tenant_id": tenant_id,
        "event_type": "queued",
        "trigger_source": "gmail_webhook",
        "model_used": ai.chat_model,
        "final_outcome": f"classified:{classification.classification}",
    }).execute()

    # ── Step 4: Stop conditions ─────────────────────────────────────
    if classification.classification in STOP_CLASSIFICATIONS:
        supabase.table("audit_log").insert({
            "tenant_id": tenant_id,
            "event_type": "skipped",
            "trigger_source": "gmail_webhook",
            "final_outcome": f"skipped:{classification.classification}",
        }).execute()
        return

    # ── Step 5: Retrieve memory context ─────────────────────────────
    sender_email = latest_message["sender_email"]
    
    # Look up customer record
    customer_result = supabase.table("customers").select("*").eq(
        "tenant_id", tenant_id
    ).eq("email", sender_email).execute()
    customer_record = customer_result.data[0] if customer_result.data else None

    # Semantic memory retrieval
    memory_chunks = await _retrieve_memory(tenant_id, latest_message)

    # ── Step 6: Determine tier ──────────────────────────────────────
    # Week 1 override: all actions are Tier 3 for the first 7 days
    created_at = datetime.fromisoformat(tenant["created_at"].replace("Z", "+00:00"))
    week_one_active = (
        tenant.get("week_one_override", True)
        and (datetime.now(created_at.tzinfo) - created_at).days < 7
    )
    tier = 3  # MVP always Tier 3; week_one_override enforces it

    # ── Step 7: Generate draft ──────────────────────────────────────
    draft_text = await ai.draft_reply(
        thread_content=thread_text,
        business_context=business_context,
        memory_chunks=memory_chunks,
        customer_record=customer_record,
        classification=classification.classification,
        urgency=classification.urgency,
    )

    # Check for missing info markers
    needs_owner_input = "[OWNER INPUT NEEDED:" in draft_text

    # ── Step 8: Store in action queue ───────────────────────────────
    import hashlib, secrets
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    token_exp = datetime.utcnow() + timedelta(hours=48)

    sender_name = latest_message["sender"].split("<")[0].strip() or sender_email
    subject = latest_message["subject"]

    action_row = supabase.table("action_queue").insert({
        "tenant_id": tenant_id,
        "workflow": "email",
        "action_type": "draft_reply",
        "tier": tier,
        "status": "pending",
        "subject": f"Reply to {sender_name} — {subject}",
        "summary": classification.summary,
        "draft_content": {
            "body": draft_text,
            "to": sender_email,
            "to_name": sender_name,
            "subject": subject,
            "thread_id": thread_id,
            "in_reply_to": latest_message.get("message_id_header", ""),
        },
        "context_used": {"memory_chunks": memory_chunks, "customer_record": customer_record},
        "customer_id": customer_record["id"] if customer_record else None,
        "gmail_thread_id": thread_id,
        "gmail_message_id": gmail_message_id,
        "needs_owner_input": needs_owner_input,
        "approval_token": token_hash,
        "approval_token_exp": token_exp.isoformat(),
        "approval_token_used": False,
    }).execute()

    action_id = action_row.data[0]["id"]

    # Log to audit log
    supabase.table("audit_log").insert({
        "tenant_id": tenant_id,
        "action_queue_id": action_id,
        "event_type": "queued",
        "trigger_source": "gmail_webhook",
        "model_used": ai.chat_model,
        "draft_snapshot": draft_text,
        "context_chunks": {"memory_chunks": memory_chunks},
    }).execute()

    # ── Step 9: Send approval email ─────────────────────────────────
    await send_approval_email(
        to_email=tenant["owner_email"],
        action_id=action_id,
        raw_token=raw_token,
        sender_name=sender_name,
        sender_email=sender_email,
        subject=subject,
        classification=classification.classification,
        urgency=classification.urgency,
        draft_body=draft_text,
        needs_owner_input=needs_owner_input,
        week_one_active=week_one_active,
    )


async def _retrieve_memory(tenant_id: str, message: dict) -> list[str]:
    """
    Retrieve top-3 relevant memory chunks via pgvector cosine similarity.
    If embeddings are not yet implemented, return an empty list gracefully.
    """
    try:
        from core.ai import ai
        query = f"{message['sender']} {message['subject']}"
        embedding = await ai.embed(query)
        
        # pgvector cosine similarity search
        result = supabase.rpc("match_memory", {
            "query_embedding": embedding,
            "match_tenant_id": tenant_id,
            "match_count": 3,
        }).execute()
        
        return [row["content"] for row in (result.data or [])]
    except NotImplementedError:
        # Embedding not yet implemented — continue without memory chunks
        return []
    except Exception:
        # Any memory retrieval failure is non-fatal
        return []


def _format_thread(messages: list[dict]) -> str:
    """Format a list of messages into a readable thread string for the AI."""
    parts = []
    for msg in reversed(messages):  # Oldest first for readability
        parts.append(
            f"From: {msg['sender']}\n"
            f"Date: {msg['date']}\n"
            f"Subject: {msg['subject']}\n\n"
            f"{msg['body']}\n"
            f"{'─' * 40}"
        )
    return "\n".join(parts)
```

Create the pgvector RPC function in Supabase SQL editor:
```sql
CREATE OR REPLACE FUNCTION match_memory(
  query_embedding vector,
  match_tenant_id uuid,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  content text,
  source_type text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.id,
    me.content,
    me.source_type,
    1 - (me.embedding <=> query_embedding) AS similarity
  FROM memory_embeddings me
  WHERE me.tenant_id = match_tenant_id
    AND me.embedding IS NOT NULL
  ORDER BY me.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## Part 6 — Approval email

**`backend/core/email_sender.py`**

The approval email is the most important piece of UI in the product outside the 
dashboard. It must:
- Work in Gmail app (iOS and Android), Apple Mail, and Outlook mobile
- Use only plain HTML — no JavaScript, no CSS that Outlook strips
- Have buttons with minimum 44px tap targets
- Never show raw JSON errors to the owner

```python
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

BACKEND_URL = os.environ.get("BACKEND_URL", "https://olivander-production.up.railway.app")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://olivander.vercel.app")

# Email sending via SMTP
# Add these to Railway env vars:
# SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
# Recommended: use Resend (resend.com) or Postmark for reliable delivery.
# Both have SMTP relay support and free tiers sufficient for MVP.

CLASSIFICATION_LABELS = {
    "new_lead": "New lead inquiry",
    "existing_client": "Existing client",
    "booking_request": "Booking request",
    "complaint": "Customer complaint",
    "invoice_received": "Invoice received",
    "payment_confirmation": "Payment confirmed",
    "fyi": "For your information",
    "spam": "Spam",
}

URGENCY_LABELS = {
    "high": "🔴 Urgent",
    "normal": "Normal",
    "low": "Low priority",
}


async def send_approval_email(
    to_email: str,
    action_id: str,
    raw_token: str,
    sender_name: str,
    sender_email: str,
    subject: str,
    classification: str,
    urgency: str,
    draft_body: str,
    needs_owner_input: bool,
    week_one_active: bool,
):
    approve_url = f"{BACKEND_URL}/api/actions/{action_id}/approve?token={raw_token}"
    edit_url = f"{FRONTEND_URL}/queue/{action_id}"
    reject_url = f"{FRONTEND_URL}/queue/{action_id}?action=reject"

    classification_label = CLASSIFICATION_LABELS.get(classification, classification)
    urgency_label = URGENCY_LABELS.get(urgency, urgency)

    owner_input_banner = ""
    if needs_owner_input:
        owner_input_banner = """
        <tr>
          <td style="background:#FEF3E2;border:0.5px solid #F5D28A;border-radius:8px;
                     padding:12px 16px;margin-bottom:16px;font-family:sans-serif;
                     font-size:13px;color:#7C4F0A;">
            ⚠️ This draft needs your input — look for <strong>[OWNER INPUT NEEDED:]</strong> 
            in the text below and fill in the missing details before approving.
          </td>
        </tr>
        """

    week_one_banner = ""
    if week_one_active:
        week_one_banner = """
        <tr>
          <td style="background:#EDE9FF;border:0.5px solid #C4BCFF;border-radius:8px;
                     padding:12px 16px;margin-bottom:16px;font-family:sans-serif;
                     font-size:12px;color:#4A4460;">
            Week 1 calibration — editing this draft teaches Olivander your style. 
            Edit freely before approving.
          </td>
        </tr>
        """

    html = f"""
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F0E8;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8;padding:24px 16px;">
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0" 
               style="max-width:600px;margin:0 auto;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:20px;">
              <span style="font-size:20px;font-weight:700;color:#5A4FD0;">O</span>
              <span style="font-size:20px;font-weight:700;color:#2C3240;">livander</span>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#FDFAF4;border:0.5px solid #DED9D0;border-radius:12px;
                       padding:24px;">
              <table width="100%" cellpadding="0" cellspacing="0">

                <!-- Title -->
                <tr>
                  <td style="font-size:16px;font-weight:600;color:#2C3240;
                             padding-bottom:4px;">
                    Reply ready — {sender_name}
                  </td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#8C93A4;padding-bottom:20px;">
                    Re: {subject}
                  </td>
                </tr>

                <!-- Meta rows -->
                <tr>
                  <td style="padding-bottom:6px;">
                    <span style="font-size:11px;font-weight:500;color:#8C93A4;
                                 text-transform:uppercase;letter-spacing:0.06em;">WHO</span><br>
                    <span style="font-size:13px;color:#3D4452;">
                      {sender_name} &lt;{sender_email}&gt;
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:6px;">
                    <span style="font-size:11px;font-weight:500;color:#8C93A4;
                                 text-transform:uppercase;letter-spacing:0.06em;">WHAT</span><br>
                    <span style="font-size:13px;color:#3D4452;">{classification_label}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:20px;">
                    <span style="font-size:11px;font-weight:500;color:#8C93A4;
                                 text-transform:uppercase;letter-spacing:0.06em;">URGENCY</span><br>
                    <span style="font-size:13px;color:#3D4452;">{urgency_label}</span>
                  </td>
                </tr>

                <!-- Banners -->
                {owner_input_banner}
                {week_one_banner}

                <!-- Draft -->
                <tr>
                  <td style="background:#F5F0E8;border-radius:8px;padding:16px;
                             font-size:14px;color:#3D4452;line-height:1.6;
                             white-space:pre-wrap;margin-bottom:24px;">
{draft_body}
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:20px 0;">
                    <hr style="border:none;border-top:0.5px solid #DED9D0;">
                  </td>
                </tr>

                <!-- Action buttons -->
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <!-- Approve button -->
                        <td style="padding-right:8px;">
                          <a href="{approve_url}"
                             style="display:inline-block;background:#5A4FD0;color:#ffffff;
                                    text-decoration:none;font-size:14px;font-weight:600;
                                    padding:12px 20px;border-radius:7px;min-width:120px;
                                    text-align:center;">
                            Approve &amp; Send
                          </a>
                        </td>
                        <!-- Edit button -->
                        <td style="padding-right:8px;">
                          <a href="{edit_url}"
                             style="display:inline-block;background:transparent;
                                    color:#5A4FD0;text-decoration:none;font-size:14px;
                                    font-weight:600;padding:12px 20px;border-radius:7px;
                                    border:0.5px solid #C4BCFF;text-align:center;">
                            Edit in App
                          </a>
                        </td>
                        <!-- Reject button -->
                        <td>
                          <a href="{reject_url}"
                             style="display:inline-block;background:transparent;
                                    color:#C42B2B;text-decoration:none;font-size:14px;
                                    font-weight:600;padding:12px 20px;border-radius:7px;
                                    border:0.5px solid #F5AAAA;text-align:center;">
                            Reject
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:16px;font-size:11px;color:#8C93A4;text-align:center;">
              This approval link expires in 48 hours. 
              <a href="{FRONTEND_URL}/queue" style="color:#5A4FD0;">
                View all pending approvals
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Reply ready — {sender_name}, re: {subject}"
    msg["From"] = f"Olivander <noreply@{os.environ.get('EMAIL_DOMAIN', 'olivander.app')}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html"))

    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ["SMTP_USER"]
    smtp_pass = os.environ["SMTP_PASSWORD"]

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(msg["From"], [to_email], msg.as_string())
```

Add to Railway env vars:
```
SMTP_HOST          # e.g. smtp.resend.com
SMTP_PORT          # 587
SMTP_USER          # From your SMTP provider
SMTP_PASSWORD      # From your SMTP provider
EMAIL_DOMAIN       # e.g. olivander.app (or your domain)
BACKEND_URL        # https://olivander-production.up.railway.app
FRONTEND_URL       # https://olivander.vercel.app
```

**Recommended email provider for MVP: Resend (resend.com)**
- Free tier: 3,000 emails/month, 100/day
- Simple SMTP relay + API
- Takes 10 minutes to set up
- Better deliverability than raw SMTP from Railway

---

## Part 7 — Approve, reject, and edit endpoints

**`backend/api/actions.py`**

```python
import hashlib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from core.auth_middleware import get_tenant_id
from core.gmail import GmailClient
from db.supabase import supabase

router = APIRouter()


# ── List pending actions ─────────────────────────────────────────────────────

@router.get("/api/actions")
async def list_actions(
    status: str = "pending",
    workflow: str | None = None,
    page: int = 1,
    tenant_id: str = Depends(get_tenant_id),
):
    query = supabase.table("action_queue").select("*").eq(
        "tenant_id", tenant_id
    ).eq("status", status).order("created_at", desc=True)

    if workflow:
        query = query.eq("workflow", workflow)

    offset = (page - 1) * 20
    query = query.range(offset, offset + 19)
    result = query.execute()
    return {"actions": result.data, "page": page}


# ── Single action detail ─────────────────────────────────────────────────────

@router.get("/api/actions/{action_id}")
async def get_action(
    action_id: str,
    tenant_id: str = Depends(get_tenant_id),
):
    result = supabase.table("action_queue").select("*").eq(
        "id", action_id
    ).eq("tenant_id", tenant_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Action not found")
    return result.data


# ── Approve (from app or email link) ─────────────────────────────────────────

@router.post("/api/actions/{action_id}/approve")
async def approve_action(
    action_id: str,
    token: str | None = Query(default=None),
    tenant_id: str | None = Depends(get_tenant_id) if False else None,
    # Note: approve can be called two ways:
    # 1. From the app: with JWT auth, no token param
    # 2. From email link: with token param, no JWT
    # The endpoint must handle both.
):
    # Fetch the action
    result = supabase.table("action_queue").select("*").eq(
        "id", action_id
    ).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Action not found")
    
    action = result.data[0]

    # Validate token if provided (email link flow)
    if token:
        if action.get("approval_token_used"):
            # Token already used — show a clear message, not an error
            return HTMLResponse(_already_used_html(), status_code=200)
        
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        if action.get("approval_token") != token_hash:
            raise HTTPException(status_code=403, detail="Invalid approval token")
        
        exp = action.get("approval_token_exp")
        if exp and datetime.fromisoformat(exp.replace("Z", "+00:00")) < datetime.utcnow().replace(tzinfo=__import__("datetime").timezone.utc):
            return HTMLResponse(_token_expired_html(action_id), status_code=200)
    elif tenant_id:
        # App flow: verify tenant owns this action
        if action["tenant_id"] != tenant_id:
            raise HTTPException(status_code=403, detail="Not authorised")
    else:
        raise HTTPException(status_code=401, detail="Authentication required")

    if action["status"] != "pending":
        return {"status": "already_handled", "action_status": action["status"]}

    # Mark as executing
    supabase.table("action_queue").update(
        {"status": "executing", "approval_token_used": True}
    ).eq("id", action_id).execute()

    # Execute the action
    try:
        await _execute_action(action)
    except Exception as e:
        supabase.table("action_queue").update(
            {"status": "failed"}
        ).eq("id", action_id).execute()
        supabase.table("audit_log").insert({
            "tenant_id": action["tenant_id"],
            "action_queue_id": action_id,
            "event_type": "error",
            "error_detail": str(e),
        }).execute()
        if token:
            return HTMLResponse(_error_html(), status_code=200)
        raise HTTPException(status_code=500, detail="Failed to execute action")

    # Log success
    supabase.table("audit_log").insert({
        "tenant_id": action["tenant_id"],
        "action_queue_id": action_id,
        "event_type": "executed",
        "trigger_source": "email_link" if token else "app",
        "final_outcome": "sent",
    }).execute()

    # Queue follow-up sequence
    await _queue_followups(action)

    if token:
        return HTMLResponse(_success_html(), status_code=200)
    return {"status": "executed"}


async def _execute_action(action: dict):
    """Execute an approved action. Currently handles email replies only."""
    if action["workflow"] == "email" and action["action_type"] == "draft_reply":
        draft = action["draft_content"]
        gmail = GmailClient(action["tenant_id"])
        await gmail.send_reply(
            to=draft["to"],
            subject=draft["subject"],
            body=draft["body"],
            thread_id=draft["thread_id"],
            in_reply_to_message_id=draft.get("in_reply_to", ""),
        )
        supabase.table("action_queue").update({
            "status": "executed",
            "executed_at": datetime.utcnow().isoformat(),
        }).eq("id", action["id"]).execute()


# ── Reject ────────────────────────────────────────────────────────────────────

class RejectPayload(BaseModel):
    reason: str = "other"   # tone | price | wrong_person | timing | other

@router.post("/api/actions/{action_id}/reject")
async def reject_action(
    action_id: str,
    payload: RejectPayload,
    tenant_id: str = Depends(get_tenant_id),
):
    result = supabase.table("action_queue").select("*").eq(
        "id", action_id
    ).eq("tenant_id", tenant_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Action not found")
    
    action = result.data[0]

    supabase.table("action_queue").update({
        "status": "rejected",
        "rejection_reason": payload.reason,
    }).eq("id", action_id).execute()

    # Store in edit patterns for learning loop
    supabase.table("edit_patterns").insert({
        "tenant_id": tenant_id,
        "action_type": action["action_type"],
        "edit_type": payload.reason,
        "original_draft": action.get("draft_content", {}).get("body", ""),
        "context_snap": action.get("context_used"),
    }).execute()

    supabase.table("audit_log").insert({
        "tenant_id": tenant_id,
        "action_queue_id": action_id,
        "event_type": "rejected",
        "trigger_source": "app",
        "final_outcome": f"rejected:{payload.reason}",
    }).execute()

    return {"status": "rejected"}


# ── Edit draft ────────────────────────────────────────────────────────────────

class EditPayload(BaseModel):
    body: str

@router.patch("/api/actions/{action_id}/edit")
async def edit_action(
    action_id: str,
    payload: EditPayload,
    tenant_id: str = Depends(get_tenant_id),
):
    result = supabase.table("action_queue").select("*").eq(
        "id", action_id
    ).eq("tenant_id", tenant_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Action not found")
    
    action = result.data[0]
    original_body = action.get("draft_content", {}).get("body", "")
    
    # Compute delta (simple: store both original and edited)
    delta = f"ORIGINAL:\n{original_body}\n\nEDITED:\n{payload.body}"

    # Update draft content with edited body
    updated_draft = {**action.get("draft_content", {}), "body": payload.body}
    
    supabase.table("action_queue").update({
        "draft_content": updated_draft,
        "owner_edit_delta": delta,
    }).eq("id", action_id).execute()

    # Store edit pattern
    supabase.table("edit_patterns").insert({
        "tenant_id": tenant_id,
        "action_type": action["action_type"],
        "edit_type": "tone",   # Default — learning loop will categorise later
        "original_draft": original_body,
        "edited_version": payload.body,
        "context_snap": action.get("context_used"),
    }).execute()

    return {"status": "updated"}


# ── Email link response pages ─────────────────────────────────────────────────

def _success_html() -> str:
    return """<!DOCTYPE html><html><body style="font-family:sans-serif;
    background:#F5F0E8;display:flex;align-items:center;justify-content:center;
    height:100vh;margin:0;">
    <div style="background:#FDFAF4;border:0.5px solid #DED9D0;border-radius:12px;
    padding:40px;text-align:center;max-width:400px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px;">
    <span style="color:#5A4FD0;">O</span>livander</div>
    <div style="color:#2E7D52;font-size:24px;margin-bottom:12px;">✓</div>
    <div style="font-size:16px;font-weight:600;color:#2C3240;margin-bottom:8px;">
    Email sent.</div>
    <div style="font-size:13px;color:#8C93A4;">
    The reply has been sent from your Gmail account.</div>
    </div></body></html>"""

def _error_html() -> str:
    return """<!DOCTYPE html><html><body style="font-family:sans-serif;
    background:#F5F0E8;display:flex;align-items:center;justify-content:center;
    height:100vh;margin:0;">
    <div style="background:#FDFAF4;border:0.5px solid #DED9D0;border-radius:12px;
    padding:40px;text-align:center;max-width:400px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px;">
    <span style="color:#5A4FD0;">O</span>livander</div>
    <div style="color:#C42B2B;font-size:13px;">Something went wrong sending this email.
    Open the app to try again.</div>
    </div></body></html>"""

def _already_used_html() -> str:
    return """<!DOCTYPE html><html><body style="font-family:sans-serif;
    background:#F5F0E8;display:flex;align-items:center;justify-content:center;
    height:100vh;margin:0;">
    <div style="background:#FDFAF4;border:0.5px solid #DED9D0;border-radius:12px;
    padding:40px;text-align:center;max-width:400px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px;">
    <span style="color:#5A4FD0;">O</span>livander</div>
    <div style="font-size:13px;color:#8C93A4;">This approval link has already been used.
    </div></div></body></html>"""

def _token_expired_html(action_id: str) -> str:
    frontend = os.environ.get("FRONTEND_URL", "https://olivander.vercel.app")
    return f"""<!DOCTYPE html><html><body style="font-family:sans-serif;
    background:#F5F0E8;display:flex;align-items:center;justify-content:center;
    height:100vh;margin:0;">
    <div style="background:#FDFAF4;border:0.5px solid #DED9D0;border-radius:12px;
    padding:40px;text-align:center;max-width:400px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:8px;">
    <span style="color:#5A4FD0;">O</span>livander</div>
    <div style="font-size:13px;color:#8C93A4;margin-bottom:16px;">
    This approval link has expired (48hr limit).</div>
    <a href="{frontend}/queue/{action_id}" 
    style="background:#5A4FD0;color:#fff;text-decoration:none;
    padding:10px 20px;border-radius:7px;font-size:13px;font-weight:600;">
    Approve in App</a>
    </div></body></html>"""
```

The approve endpoint handles both the email-link flow (token param, no JWT) and 
the app flow (JWT, no token). The HTML response pages render in the owner's 
mobile browser when they tap the email button — keep them simple.

---

## Part 8 — Follow-up sequence scheduler

**`backend/workers/followup_worker.py`**

```python
from datetime import datetime, timedelta
from db.supabase import supabase
from core.gmail import GmailClient

FOLLOW_UP_SEQUENCES = {
    "new_lead": [
        {"delay_hours": 48,  "message_type": "follow_up_1"},
        {"delay_hours": 120, "message_type": "follow_up_2"},
        {"delay_hours": 240, "message_type": "follow_up_3"},
    ],
    "existing_client": [],   # No automated follow-ups for existing clients at MVP
    "booking_request": [
        {"delay_hours": 48,  "message_type": "follow_up_1"},
        {"delay_hours": 120, "message_type": "follow_up_2"},
    ],
}


async def queue_follow_ups(original_action: dict):
    """
    Called after an email reply is approved and sent.
    Inserts future job_queue rows for follow-up messages.
    All follow-ups are Tier 3 and halt on any client reply.
    """
    draft = original_action.get("draft_content", {})
    classification = original_action.get("summary", "")  
    # Note: classification isn't stored directly on action_queue.
    # Store it: add `classification` column to action_queue.
    # ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS classification text;
    
    classification = original_action.get("classification", "new_lead")
    sequence = FOLLOW_UP_SEQUENCES.get(classification, [])
    
    if not sequence:
        return

    now = datetime.utcnow()
    
    for step in sequence:
        run_at = now + timedelta(hours=step["delay_hours"])
        
        supabase.table("job_queue").insert({
            "tenant_id": original_action["tenant_id"],
            "job_type": "send_follow_up",
            "payload": {
                "original_action_id": original_action["id"],
                "tenant_id": original_action["tenant_id"],
                "to_email": draft.get("to"),
                "to_name": draft.get("to_name"),
                "subject": draft.get("subject"),
                "thread_id": draft.get("thread_id"),
                "customer_id": original_action.get("customer_id"),
                "message_type": step["message_type"],
                "sequence_position": sequence.index(step) + 1,
                "total_in_sequence": len(sequence),
            },
            "status": "pending",
            "run_at": run_at.isoformat(),
        }).execute()


async def process_follow_up_job(payload: dict):
    """
    Processes a scheduled follow-up job.
    Before doing anything: check if the client has replied since the 
    original email was sent. If they have, cancel this and all remaining 
    follow-ups in the sequence.
    """
    tenant_id = payload["tenant_id"]
    thread_id = payload.get("thread_id")
    
    # Fetch original action to get sent timestamp
    original = supabase.table("action_queue").select("executed_at").eq(
        "id", payload["original_action_id"]
    ).single().execute()
    
    if not original.data or not original.data.get("executed_at"):
        return  # Original action not found or not executed

    sent_at = datetime.fromisoformat(
        original.data["executed_at"].replace("Z", "+00:00")
    ).timestamp()

    # Check if client has replied since we sent the original
    if thread_id:
        gmail = GmailClient(tenant_id)
        client_replied = await gmail.check_thread_for_reply(
            thread_id=thread_id,
            after_timestamp=int(sent_at),
        )
        
        if client_replied:
            # Cancel this and all remaining follow-ups for this sequence
            await _cancel_sequence(tenant_id, payload["original_action_id"])
            return

    # Generate follow-up draft
    tenant = supabase.table("tenants").select("*").eq(
        "id", tenant_id
    ).single().execute().data
    
    profile = supabase.table("business_profile").select("*").eq(
        "tenant_id", tenant_id
    ).execute()
    profile_data = profile.data[0] if profile.data else {}

    follow_up_prompt = _follow_up_prompt(
        to_name=payload["to_name"],
        subject=payload["subject"],
        position=payload["sequence_position"],
        total=payload["total_in_sequence"],
        business_name=tenant["business_name"],
        tone_seed=profile_data.get("tone_seed", ""),
    )

    from core.ai import ai
    draft_body = await ai.draft_reply(
        thread_content=f"Following up on: {payload['subject']}",
        business_context={
            "business_name": tenant["business_name"],
            "business_type": tenant.get("business_type", "service"),
            "tone_seed": profile_data.get("tone_seed", ""),
        },
        memory_chunks=[],
        customer_record=None,
        classification="follow_up",
        urgency="normal",
    )

    # Queue as Tier 3 action
    import hashlib, secrets
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    from datetime import timedelta
    token_exp = datetime.utcnow() + timedelta(hours=48)

    action = supabase.table("action_queue").insert({
        "tenant_id": tenant_id,
        "workflow": "email",
        "action_type": "follow_up",
        "tier": 3,
        "status": "pending",
        "subject": f"Follow-up #{payload['sequence_position']} — {payload['to_name']}",
        "summary": f"Follow-up email to {payload['to_name']} (#{payload['sequence_position']} of {payload['total_in_sequence']})",
        "draft_content": {
            "body": draft_body,
            "to": payload["to_email"],
            "to_name": payload["to_name"],
            "subject": payload["subject"],
            "thread_id": thread_id,
        },
        "customer_id": payload.get("customer_id"),
        "gmail_thread_id": thread_id,
        "approval_token": token_hash,
        "approval_token_exp": token_exp.isoformat(),
    }).execute()

    action_id = action.data[0]["id"]

    # Send approval email
    from core.email_sender import send_approval_email
    await send_approval_email(
        to_email=tenant["owner_email"],
        action_id=action_id,
        raw_token=raw_token,
        sender_name=payload["to_name"],
        sender_email=payload["to_email"],
        subject=payload["subject"],
        classification="follow_up",
        urgency="normal",
        draft_body=draft_body,
        needs_owner_input="[OWNER INPUT NEEDED:" in draft_body,
        week_one_active=False,
    )


def _follow_up_prompt(
    to_name: str, subject: str, position: int, total: int,
    business_name: str, tone_seed: str
) -> str:
    return f"""Brief follow-up #{position} of {total} to {to_name} regarding: {subject}.
    
Business: {business_name}
Tone: {tone_seed or 'Professional, direct, friendly. No corporate language.'}

Write a short follow-up (2–3 sentences maximum). 
Acknowledge this is a follow-up. Don't be pushy. 
If you need any specific details, write [OWNER INPUT NEEDED: what's missing]."""


async def _cancel_sequence(tenant_id: str, original_action_id: str):
    """Cancel all pending follow-up jobs for a given original action."""
    supabase.table("job_queue").update({"status": "done"}).eq(
        "tenant_id", tenant_id
    ).eq("status", "pending").eq(
        "job_type", "send_follow_up"
    ).contains("payload", {"original_action_id": original_action_id}).execute()
```

Add this column migration:
```sql
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS classification text;
```

---

## Part 9 — Job queue worker (cron)

The job queue needs something to process it. Two options:

**Option A — Railway cron job (recommended for MVP)**

In Railway → your backend service → Settings → Cron Jobs → Add:

```
Schedule:  */30 * * * *    (every 30 minutes)
Command:   python -m workers.job_runner
```

**`backend/workers/job_runner.py`**

```python
"""
Standalone script run by Railway cron every 30 minutes.
Picks up pending job_queue rows and processes them.
"""
import asyncio
from datetime import datetime
from db.supabase import supabase
from workers.email_worker import process_email_job
from workers.followup_worker import process_follow_up_job

async def run():
    now = datetime.utcnow().isoformat()
    
    # Fetch pending jobs that are due
    result = supabase.table("job_queue").select("*").in_(
        "status", ["pending", "failed"]
    ).lte("run_at", now).lte(
        "attempts", 2  # max_attempts - 1, so we process up to 3 times
    ).order("run_at").limit(50).execute()

    jobs = result.data or []
    print(f"Processing {len(jobs)} jobs")

    for job in jobs:
        # Mark as processing
        supabase.table("job_queue").update({
            "status": "processing",
            "attempts": job["attempts"] + 1,
        }).eq("id", job["id"]).execute()

        try:
            if job["job_type"] == "process_email":
                await process_email_job(
                    tenant_id=job["payload"]["tenant_id"],
                    gmail_message_id=job["payload"]["gmail_message_id"],
                )
            elif job["job_type"] == "send_follow_up":
                await process_follow_up_job(job["payload"])

            # Mark done
            supabase.table("job_queue").update({
                "status": "done",
                "completed_at": datetime.utcnow().isoformat(),
            }).eq("id", job["id"]).execute()
            print(f"Job {job['id']} ({job['job_type']}) — done")

        except Exception as e:
            attempts = job["attempts"] + 1
            new_status = "failed" if attempts >= job["max_attempts"] else "pending"
            
            # Exponential backoff: retry in 2^attempt minutes
            import math
            from datetime import timedelta
            backoff_minutes = 2 ** attempts
            next_run = (datetime.utcnow() + timedelta(minutes=backoff_minutes)).isoformat()
            
            supabase.table("job_queue").update({
                "status": new_status,
                "error_detail": str(e),
                "run_at": next_run if new_status == "pending" else job["run_at"],
            }).eq("id", job["id"]).execute()
            
            print(f"Job {job['id']} ({job['job_type']}) — {'failed permanently' if new_status == 'failed' else f'will retry at {next_run}'}: {e}")


if __name__ == "__main__":
    asyncio.run(run())
```

**Option B — FastAPI background task (simpler but less reliable)**

If Railway cron is not working, add a startup background loop to `main.py`:

```python
import asyncio
from contextlib import asynccontextmanager
from workers.job_runner import run as run_jobs

@asynccontextmanager
async def lifespan(app):
    # Start background worker loop
    task = asyncio.create_task(background_worker())
    yield
    task.cancel()

async def background_worker():
    while True:
        try:
            await run_jobs()
        except Exception as e:
            print(f"Worker error: {e}")
        await asyncio.sleep(30)  # Run every 30 seconds

app = FastAPI(lifespan=lifespan)
```

Use Option B for MVP if cron setup is causing friction. Switch to Option A 
before the first paying customer.

---

## Part 10 — Watch subscription on OAuth connect

When a tenant connects Gmail, subscribe their inbox to Pub/Sub notifications.
Also set up a weekly renewal job.

In `backend/api/auth.py`, after storing tokens in the callback:

```python
# After successfully storing OAuth tokens:
from core.gmail import GmailClient
import os

gmail = GmailClient(tenant_id)
pubsub_topic = os.environ.get("PUBSUB_TOPIC_NAME")

try:
    watch_result = await gmail.watch_inbox(pubsub_topic)
    # watch_result contains expiration timestamp (~7 days from now)
    # Store it so we know when to renew
    supabase.table("oauth_tokens").update({
        "watch_expiry": watch_result.get("expiration")
    }).eq("tenant_id", tenant_id).eq("provider", "google").execute()
except Exception as e:
    # Non-fatal — log it but don't fail the OAuth flow
    print(f"Watch setup failed for {tenant_id}: {e}")
```

Add to schema:
```sql
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS watch_expiry text;
```

Add a daily job_queue cron to renew expiring watches:
```python
# In job_runner.py, add:
# Check for watches expiring in the next 24 hours and renew them
```

---

## Register all new routers in main.py

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.auth import router as auth_router
from api.actions import router as actions_router
from api.webhooks import router as webhooks_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://olivander.vercel.app", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(actions_router)
app.include_router(webhooks_router)
```

---

## Additional schema migrations

Run these in Supabase SQL editor (in addition to what's in Part 4 and Part 9):

```sql
-- From Part 4
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_history_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_frequency text 
  NOT NULL DEFAULT 'realtime'
  CHECK (notification_frequency IN ('realtime', 'morning_digest', 'weekly'));

-- From Part 8
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS classification text;

-- From Part 10
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS watch_expiry text;
```

---

## Definition of done

Test every item below against a real Gmail inbox before marking this PRD complete. 
Do not use mocked data for any of these checks.

**AI provider:**
- [ ] `ai.classify()` returns a valid `ClassificationResult` for a real email thread
- [ ] `ai.draft_reply()` returns a non-empty string that reads like a human wrote it
- [ ] A prompt with missing context produces `[OWNER INPUT NEEDED:]` in the output
- [ ] Groq timeout (simulate by temporarily setting timeout to 0.001s) is caught and retried
- [ ] After 3 failures, the job is marked `failed` in job_queue with `error_detail` populated

**Gmail client:**
- [ ] `gmail.get_thread()` returns parsed messages with sender, subject, body, timestamp
- [ ] `gmail.send_reply()` sends a real email that appears in the Gmail Sent folder
- [ ] `gmail.watch_inbox()` returns an expiration timestamp without erroring
- [ ] `gmail.check_thread_for_reply()` correctly detects a client reply in an existing thread

**Webhook receiver:**
- [ ] Sending a test Pub/Sub message to the endpoint creates a `job_queue` row
- [ ] Sending the same message twice creates only one `job_queue` row (dedup works)
- [ ] A request without the verification token returns 403
- [ ] A Pub/Sub message for an unknown Gmail address returns 200 (acknowledged, not errored)

**Processing pipeline:**
- [ ] Send a real email to the connected Gmail inbox
- [ ] Within 90 seconds: a `action_queue` row exists with `status = 'pending'`
- [ ] The draft body reads like a relevant reply (not generic, uses business context)
- [ ] The `context_used` field is populated with memory chunks (even if empty array)
- [ ] An email arrives at `tenant.owner_email` with the approval buttons
- [ ] `spam` and `fyi` classified emails produce an `audit_log` row with `event_type = 'skipped'` but no `action_queue` row

**Approval email:**
- [ ] "Approve & Send" button works in Gmail app on iOS
- [ ] "Approve & Send" button works in Gmail app on Android  
- [ ] "Approve & Send" button works in Apple Mail
- [ ] Tapping "Approve & Send" sends the email from the owner's Gmail account
- [ ] The success HTML page renders in a mobile browser
- [ ] Tapping the same approve link twice shows the "already used" page
- [ ] A link older than 48 hours shows the "expired" page with an "Approve in App" button
- [ ] "Edit in App" redirects to `olivander.vercel.app/queue/{id}`
- [ ] "Reject" redirects to `olivander.vercel.app/queue/{id}?action=reject`

**Approve/reject/edit API:**
- [ ] `POST /api/actions/{id}/approve` (app flow, JWT) marks the action executed and sends the email
- [ ] `POST /api/actions/{id}/reject` with reason stores in both `action_queue` and `edit_patterns`
- [ ] `PATCH /api/actions/{id}/edit` updates draft_content and stores the delta in `edit_patterns`
- [ ] Approving an already-executed action returns `{"status": "already_handled"}`

**Follow-up sequences:**
- [ ] After approving a `new_lead` reply, 3 follow-up rows appear in `job_queue` with future `run_at`
- [ ] When the client replies to the thread: running the follow-up job cancels the remaining sequence
- [ ] A follow-up job that fires generates a draft, queues a Tier 3 action, and sends an approval email

**Job queue worker:**
- [ ] Running `job_runner.py` manually processes pending jobs in order
- [ ] A job that fails increments `attempts` and is retried with exponential backoff
- [ ] A job that fails 3 times is marked `failed` permanently with `error_detail`
- [ ] The cron (or background loop) runs automatically without manual intervention
