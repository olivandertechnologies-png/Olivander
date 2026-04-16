from groq_client import get_groq_client

_VALID_LABELS = {
    "booking_request",
    "invoice_query",
    "general_reply",
    "new_client_enquiry",
    "ignore",
}


def classify_email(subject: str, body: str, sender: str) -> str:
    prompt = f"""
You are an AI assistant for a New Zealand service business.
Classify the following inbound email into exactly one category.

Categories:
- booking_request: customer wants to schedule, reschedule, or cancel an appointment
- invoice_query: question about payment, pricing, quotes, or invoices
- general_reply: needs a response but no specific workflow
- new_client_enquiry: first contact from a new potential customer
- ignore: automated email, spam, newsletter, or no response needed

If you are uncertain, choose general_reply.

Email:
From: {sender}
Subject: {subject}
Body: {body}

Reply with ONLY the category name. No explanation. No punctuation.
""".strip()

    client = get_groq_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=20,
    )
    result = (response.choices[0].message.content or "").strip().lower()
    result = result.splitlines()[0].strip(" \n\r\t`\"'.,:;!?") if result else ""
    return result if result in _VALID_LABELS else "general_reply"
