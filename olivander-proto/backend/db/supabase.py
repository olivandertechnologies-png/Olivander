import logging

from supabase import Client, create_client

from config import SUPABASE_KEY, SUPABASE_URL

_supabase_client: Client | None = None
logger = logging.getLogger("olivander")


def verify_supabase_connection() -> None:
    supabase = get_supabase_client()

    try:
        supabase.table("businesses").select("id").limit(1).execute()
    except Exception as error:
        raise RuntimeError("Supabase connection failed.") from error

    logger.info("Supabase connected")


def get_supabase_client() -> Client:
    global _supabase_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in backend/.env."
        )

    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

    return _supabase_client
