import base64
import logging
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import Any

import requests
from fastapi import HTTPException

logger = logging.getLogger("olivander")

GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me"


def _gmail_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _get_header_value(headers: list[dict[str, Any]], header_name: str, default: str = "") -> str:
    for header in headers:
        if header.get("name", "").lower() == header_name.lower():
            return str(header.get("value", default))

    return default


def _extract_plain_text(payload: dict[str, Any]) -> str:
    """Recursively extract plain text from a Gmail MIME payload."""
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime_type == "text/plain" and body_data:
        try:
            return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        except Exception:
            return ""

    for part in payload.get("parts", []):
        result = _extract_plain_text(part)
        if result:
            return result

    return ""


def get_message(access_token: str, message_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{GMAIL_API_BASE_URL}/messages/{message_id}",
        params={"format": "full"},
        headers=_gmail_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail get message failed with status {response.status_code}.",
        )

    payload = response.json()
    msg_payload = payload.get("payload", {})
    headers = msg_payload.get("headers", [])
    sender_name, sender_email = parseaddr(
        _get_header_value(headers, "From", "Unknown Sender <unknown@example.com>")
    )
    full_body = _extract_plain_text(msg_payload).strip()

    return {
        "id": str(payload.get("id", message_id)),
        "from": sender_email or sender_name or "unknown@example.com",
        "from_name": sender_name or sender_email or "Unknown Sender",
        "subject": _get_header_value(headers, "Subject", "Untitled Email"),
        "snippet": payload.get("snippet", ""),
        "full_body": full_body or payload.get("snippet", ""),
        "date": _get_header_value(headers, "Date", payload.get("internalDate")),
        "thread_id": payload.get("threadId"),
    }


def list_recent_messages(
    access_token: str,
    max_results: int = 10,
    *,
    query: str | None = None,
    label_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"maxResults": max_results}

    if query:
        params["q"] = query

    if label_ids:
        params["labelIds"] = label_ids

    response = requests.get(
        f"{GMAIL_API_BASE_URL}/messages",
        params=params,
        headers=_gmail_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        logger.error("Gmail list messages failed: status=%s body=%s", response.status_code, response.text)
        raise HTTPException(
            status_code=502,
            detail=f"Gmail list messages failed with status {response.status_code}.",
        )

    message_refs = response.json().get("messages", []) or []

    return [get_message(access_token, message["id"]) for message in message_refs if message.get("id")]


def get_thread(access_token: str, thread_id: str) -> list[dict[str, Any]]:
    """Get all messages in a thread with full body text.

    Uses format=full so _extract_plain_text can pull actual message bodies,
    not just snippets. Required for coherent reply generation.
    """
    response = requests.get(
        f"{GMAIL_API_BASE_URL}/threads/{thread_id}",
        params={"format": "full"},
        headers=_gmail_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail get thread failed with status {response.status_code}.",
        )

    thread_data = response.json()
    messages = []

    for msg_data in thread_data.get("messages", []):
        msg_payload = msg_data.get("payload", {})
        headers = msg_payload.get("headers", [])
        sender_name, sender_email = parseaddr(
            _get_header_value(headers, "From", "Unknown Sender <unknown@example.com>")
        )
        full_body = _extract_plain_text(msg_payload).strip()

        messages.append({
            "id": msg_data.get("id"),
            "from": sender_email or sender_name or "unknown@example.com",
            "from_name": sender_name or sender_email or "Unknown Sender",
            "subject": _get_header_value(headers, "Subject", ""),
            "snippet": msg_data.get("snippet", ""),
            "body": full_body or msg_data.get("snippet", ""),
            "date": _get_header_value(headers, "Date", ""),
        })

    return messages


def send_html_message(
    access_token: str,
    *,
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    thread_id: str | None = None,
    pdf_bytes: bytes | None = None,
    pdf_filename: str = "Quote.pdf",
) -> dict[str, Any]:
    """Send an HTML email (with plain-text fallback) via Gmail API.

    If pdf_bytes is provided the message is sent as multipart/mixed with the
    PDF attached; otherwise it is sent as multipart/alternative.
    """
    if pdf_bytes:
        outer = MIMEMultipart("mixed")
        outer["To"] = to_email
        outer["Subject"] = subject
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(text_body, "plain"))
        alt.attach(MIMEText(html_body, "html"))
        outer.attach(alt)
        attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
        attachment.add_header("Content-Disposition", "attachment", filename=pdf_filename)
        outer.attach(attachment)
        message = outer
    else:
        message = MIMEMultipart("alternative")
        message["To"] = to_email
        message["Subject"] = subject
        message.attach(MIMEText(text_body, "plain"))
        message.attach(MIMEText(html_body, "html"))
    encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()

    payload: dict[str, Any] = {"raw": encoded_message}
    if thread_id:
        payload["threadId"] = thread_id

    response = requests.post(
        f"{GMAIL_API_BASE_URL}/messages/send",
        json=payload,
        headers={**_gmail_headers(access_token), "Content-Type": "application/json"},
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail send failed with status {response.status_code}.",
        )

    return response.json()


def setup_gmail_watch(access_token: str, topic_name: str) -> dict[str, Any]:
    """Register a Pub/Sub push subscription for this Gmail inbox."""
    response = requests.post(
        f"{GMAIL_API_BASE_URL}/watch",
        json={"topicName": topic_name, "labelIds": ["INBOX"], "labelFilterAction": "include"},
        headers={**_gmail_headers(access_token), "Content-Type": "application/json"},
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail watch setup failed with status {response.status_code}.",
        )

    return response.json()


def send_message(
    access_token: str,
    *,
    to_email: str,
    subject: str,
    body: str,
    thread_id: str | None = None,
) -> dict[str, Any]:
    message = MIMEText(body)
    message["To"] = to_email
    message["Subject"] = subject
    encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()

    payload: dict[str, Any] = {"raw": encoded_message}

    if thread_id:
        payload["threadId"] = thread_id

    response = requests.post(
        f"{GMAIL_API_BASE_URL}/messages/send",
        json=payload,
        headers={
            **_gmail_headers(access_token),
            "Content-Type": "application/json",
        },
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail send failed with status {response.status_code}.",
        )

    return response.json()
