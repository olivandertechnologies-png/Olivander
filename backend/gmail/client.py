import base64
from email.mime.text import MIMEText
from email.utils import parseaddr
from typing import Any

import requests
from fastapi import HTTPException

GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me"


def _gmail_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _get_header_value(headers: list[dict[str, Any]], header_name: str, default: str = "") -> str:
    for header in headers:
        if header.get("name", "").lower() == header_name.lower():
            return str(header.get("value", default))

    return default


def get_message(access_token: str, message_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{GMAIL_API_BASE_URL}/messages/{message_id}",
        params={
            "format": "metadata",
            "metadataHeaders": ["From", "Subject", "Date"],
        },
        headers=_gmail_headers(access_token),
        timeout=20,
    )

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Gmail get message failed with status {response.status_code}.",
        )

    payload = response.json()
    headers = payload.get("payload", {}).get("headers", [])
    sender_name, sender_email = parseaddr(
        _get_header_value(headers, "From", "Unknown Sender <unknown@example.com>")
    )

    return {
        "id": str(payload.get("id", message_id)),
        "from": sender_email or sender_name or "unknown@example.com",
        "from_name": sender_name or sender_email or "Unknown Sender",
        "subject": _get_header_value(headers, "Subject", "Untitled Email"),
        "snippet": payload.get("snippet", ""),
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
        raise HTTPException(
            status_code=502,
            detail=f"Gmail list messages failed with status {response.status_code}.",
        )

    message_refs = response.json().get("messages", []) or []

    return [get_message(access_token, message["id"]) for message in message_refs if message.get("id")]


def get_thread(access_token: str, thread_id: str) -> list[dict[str, Any]]:
    """Get all messages in a thread."""
    response = requests.get(
        f"{GMAIL_API_BASE_URL}/threads/{thread_id}",
        params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
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
        headers = msg_data.get("payload", {}).get("headers", [])
        sender_name, sender_email = parseaddr(
            _get_header_value(headers, "From", "Unknown Sender <unknown@example.com>")
        )

        messages.append({
            "id": msg_data.get("id"),
            "from": sender_email or sender_name or "unknown@example.com",
            "from_name": sender_name or sender_email or "Unknown Sender",
            "subject": _get_header_value(headers, "Subject", ""),
            "snippet": msg_data.get("snippet", ""),
            "date": _get_header_value(headers, "Date", ""),
        })

    return messages


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
