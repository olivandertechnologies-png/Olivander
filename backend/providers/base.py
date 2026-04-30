"""Abstract base classes for all external provider integrations.

Section 3.1 of PRD v6.0: this interface layer MUST exist before any
provider-specific code. All workers call these methods — never a provider
SDK directly.
"""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any


class EmailProvider(ABC):
    """Unified interface for email providers (Gmail, Outlook, IMAP)."""

    @abstractmethod
    def fetch_thread(self, access_token: str, thread_id: str) -> list[dict[str, Any]]:
        """Return all messages in a thread, oldest first.

        Each message: {id, from, from_name, subject, snippet, body, date}.
        Full thread context is required before generating any reply.
        """

    @abstractmethod
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
        """Send an email and return the sent message ID."""

    @abstractmethod
    def list_unread(
        self,
        access_token: str,
        since: datetime | None = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Return recent unread messages for initial sync and catch-up."""

    @abstractmethod
    def mark_read(self, access_token: str, message_id: str) -> bool:
        """Mark a message as read. Returns True on success."""

    @abstractmethod
    def watch(self, access_token: str, webhook_url: str) -> dict[str, Any]:
        """Register a push subscription for inbox changes.

        Gmail: Cloud Pub/Sub. Outlook: Microsoft Graph webhooks.
        IMAP: polling fallback (not supported by this method).
        """

    @abstractmethod
    def get_attachments(
        self, access_token: str, message_id: str
    ) -> list[dict[str, Any]]:
        """Return attachments for a message.

        Each attachment: {id, filename, mime_type, data (bytes), size}.
        Used for expense capture and document workflows.
        """


class CalendarProvider(ABC):
    """Unified interface for calendar providers (Google Calendar, Outlook Calendar)."""

    @abstractmethod
    def get_availability(
        self,
        access_token: str,
        start: datetime,
        end: datetime,
        buffer_mins: int = 15,
    ) -> list[dict[str, str]]:
        """Return busy periods as [{start: ISO, end: ISO}]."""

    @abstractmethod
    def propose_slots(
        self,
        access_token: str,
        duration_minutes: int,
        buffer_minutes: int = 15,
        tz_name: str = "Pacific/Auckland",
        hours_start: str = "09:00",
        hours_end: str = "17:00",
        num_slots: int = 3,
    ) -> list[dict[str, str]]:
        """Return available booking slots as [{start, end, display}]."""

    @abstractmethod
    def create_event(
        self,
        access_token: str,
        *,
        summary: str,
        start: str,
        end: str,
        description: str | None = None,
        attendee_email: str | None = None,
        tz_name: str = "Pacific/Auckland",
    ) -> str:
        """Create a calendar event and return its event ID."""

    @abstractmethod
    def update_event(
        self,
        access_token: str,
        event_id: str,
        changes: dict[str, Any],
    ) -> str:
        """Apply changes to an event and return the event ID."""

    @abstractmethod
    def delete_event(self, access_token: str, event_id: str) -> bool:
        """Delete an event. Returns True on success."""

    @abstractmethod
    def list_events(
        self,
        access_token: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        """List events in a time window. Used for rostering and capacity intelligence."""

    @abstractmethod
    def watch(
        self,
        access_token: str,
        calendar_id: str,
        webhook_url: str,
    ) -> dict[str, Any]:
        """Register push notifications for calendar changes."""


class AccountingProvider(ABC):
    """Unified interface for accounting providers (Xero, MYOB)."""

    @abstractmethod
    def create_invoice(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_id: str,
        line_items: list[dict[str, Any]],
        due_date_days: int = 30,
        gst_registered: bool = True,
        currency: str = "NZD",
        reference: str = "",
    ) -> str:
        """Create a draft invoice and return its invoice ID."""

    @abstractmethod
    def get_payment_status(
        self, access_token: str, tenant_id: str, invoice_id: str
    ) -> str:
        """Return current invoice status (DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED).

        MUST query live — no caching ever. An invoice paid 5 minutes ago must
        never receive a chaser.
        """

    @abstractmethod
    def list_overdue(
        self, access_token: str, tenant_id: str, days: int = 7
    ) -> list[dict[str, Any]]:
        """Return invoices overdue by at least `days` days."""

    @abstractmethod
    def create_expense(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_name: str,
        amount: float,
        gst_amount: float,
        category: str,
        description: str,
        expense_date: str,
    ) -> str:
        """Create an expense entry and return its ID."""

    @abstractmethod
    def get_bank_balance(
        self, access_token: str, tenant_id: str
    ) -> float | None:
        """Return current bank balance from the accounting provider's bank feed."""

    @abstractmethod
    def create_quote(
        self,
        access_token: str,
        tenant_id: str,
        *,
        contact_id: str,
        line_items: list[dict[str, Any]],
        expiry_date_days: int = 30,
        gst_registered: bool = True,
        currency: str = "NZD",
        title: str = "",
        terms: str = "",
    ) -> str:
        """Create a draft quote and return its quote ID."""

    @abstractmethod
    def get_contact(
        self,
        access_token: str,
        tenant_id: str,
        email_or_name: str,
    ) -> dict[str, Any] | None:
        """Look up a contact by email or name. Returns contact dict or None."""

    @abstractmethod
    def find_or_create_contact(
        self,
        access_token: str,
        tenant_id: str,
        *,
        name: str,
        email: str | None = None,
    ) -> str:
        """Return the contact ID, creating if not found."""
