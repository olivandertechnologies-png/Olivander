"""Provider abstraction layer.

All workers and agents interact with these interfaces — never with a provider
SDK or REST client directly. This makes adding Outlook, MYOB, or any future
provider a matter of adding a new concrete class, not changing business logic.
"""
from providers.base import AccountingProvider, CalendarProvider, EmailProvider
from providers.gmail_provider import GmailProvider
from providers.gcal_provider import GCalProvider
from providers.xero_provider import XeroProvider


def get_email_provider(provider: str = "gmail") -> EmailProvider:
    if provider == "gmail":
        return GmailProvider()
    raise ValueError(f"Unknown email provider: {provider}")


def get_calendar_provider(provider: str = "google") -> CalendarProvider:
    if provider == "google":
        return GCalProvider()
    raise ValueError(f"Unknown calendar provider: {provider}")


def get_accounting_provider(provider: str = "xero") -> AccountingProvider:
    if provider == "xero":
        return XeroProvider()
    raise ValueError(f"Unknown accounting provider: {provider}")
