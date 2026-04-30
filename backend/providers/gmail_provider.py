"""Gmail implementation of EmailProvider."""
from datetime import datetime
from typing import Any

import requests
from fastapi import HTTPException

from providers.base import EmailProvider

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailProvider(EmailProvider):
    """Wraps gmail/client.py functions behind the EmailProvider interface."""

    def fetch_thread(self, access_token: str, thread_id: str) -> list[dict[str, Any]]:
        from gmail.client import get_thread
        return get_thread(access_token, thread_id)

    def send(
        self,
        access_token: str,
        *,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: str,
        thread_id: str | None = None,
    ) -> str:
        from gmail.client import send_html_message
        result = send_html_message(
            access_token,
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            thread_id=thread_id,
        )
        return str(result.get("id", ""))

    def list_unread(
        self,
        access_token: str,
        since: datetime | None = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        from gmail.client import list_recent_messages
        query = "is:unread in:inbox"
        if since:
            # Gmail query date format: after:YYYY/MM/DD
            query += f" after:{since.strftime('%Y/%m/%d')}"
        return list_recent_messages(access_token, max_results=max_results, query=query)

    def mark_read(self, access_token: str, message_id: str) -> bool:
        response = requests.post(
            f"{GMAIL_API_BASE}/messages/{message_id}/modify",
            json={"removeLabelIds": ["UNREAD"]},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=20,
        )
        return response.ok

    def watch(self, access_token: str, webhook_url: str) -> dict[str, Any]:
        from gmail.client import setup_gmail_watch
        from config import get_secret
        topic_name = get_secret("GMAIL_PUBSUB_TOPIC") or ""
        return setup_gmail_watch(access_token, topic_name)

    def get_attachments(
        self, access_token: str, message_id: str
    ) -> list[dict[str, Any]]:
        import base64

        response = requests.get(
            f"{GMAIL_API_BASE}/messages/{message_id}",
            params={"format": "full"},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
        if not response.ok:
            raise HTTPException(
                status_code=502,
                detail=f"Gmail get message failed with status {response.status_code}.",
            )

        attachments = []
        payload = response.json().get("payload", {})
        for part in payload.get("parts", []):
            body = part.get("body", {})
            attachment_id = body.get("attachmentId")
            if not attachment_id:
                continue

            att_response = requests.get(
                f"{GMAIL_API_BASE}/messages/{message_id}/attachments/{attachment_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=20,
            )
            if not att_response.ok:
                continue

            data_b64 = att_response.json().get("data", "")
            raw_data = base64.urlsafe_b64decode(data_b64 + "==")
            attachments.append({
                "id": attachment_id,
                "filename": part.get("filename", "attachment"),
                "mime_type": part.get("mimeType", "application/octet-stream"),
                "data": raw_data,
                "size": body.get("size", len(raw_data)),
            })

        return attachments
