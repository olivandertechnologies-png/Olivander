from core.ai import get_ai_provider

_VALID_LABELS = {
    "new_lead",
    "existing_client",
    "booking_request",
    "complaint",
    "invoice",
    "payment_confirmation",
    "fyi",
    "spam",
}

# Emails in these categories are logged but not drafted or queued for approval.
SKIP_LABELS = {"spam", "fyi"}


def classify_email(
    subject: str,
    body: str,
    sender: str,
    business_id: str | None = None,
) -> str:
    """Classify an inbound email into one of 8 operational categories.

    Returns one of: new_lead, existing_client, booking_request, complaint,
    invoice, payment_confirmation, fyi, spam.

    Falls back to "existing_client" if the model returns an unrecognised label.
    """
    prompt = f"""
You are an AI assistant for a New Zealand service business.
Classify the following inbound email into exactly one category.

Categories:
- new_lead: first contact from someone who has never dealt with this business before
- existing_client: a message from a known client that needs a reply but no specific workflow
- booking_request: customer wants to schedule, reschedule, or cancel an appointment or service
- complaint: customer is unhappy, disputing something, or escalating an issue
- invoice: question or discussion about payment, pricing, quotes, or invoices
- payment_confirmation: notification that a payment has been made or received
- fyi: informational only — no reply needed (receipts, auto-confirmations, newsletters, notifications)
- spam: unsolicited commercial email, phishing, or junk

Rules:
- If the email is from a no-reply or automated sender, classify as fyi or spam.
- If you are uncertain between new_lead and existing_client, prefer existing_client.
- If you are uncertain about anything else, prefer existing_client.

Email:
From: {sender}
Subject: {subject}
Body: {body}

Reply with ONLY the category name. No explanation. No punctuation.
""".strip()

    ai = get_ai_provider()
    result = ai.complete(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=20,
        operation="classify_email",
        business_id=business_id,
    )
    result = result.splitlines()[0].strip(" \n\r\t`\"'.,:;!?") if result else ""
    return result if result in _VALID_LABELS else "existing_client"
