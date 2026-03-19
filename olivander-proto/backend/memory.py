import os
import sqlite3


DATABASE_PATH = os.path.join(os.path.dirname(__file__), "olivander_memory.db")
LEGACY_DEFAULT_PROFILE = {
    "business_name": "Alpine Physio",
    "business_type": "physiotherapy clinic",
    "owner_name": "Sam",
    "tone": "warm, professional, concise",
    "location": "Queenstown, New Zealand",
    "services": "physiotherapy, sports rehabilitation, injury assessment",
    "sign_off": "The team at Alpine Physio",
}


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS business_profile (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )

        rows = connection.execute(
            "SELECT key, value FROM business_profile"
        ).fetchall()
        current_profile = {row["key"]: row["value"] for row in rows}

        # Clear the legacy demo seed so Memory starts blank until setup runs.
        if current_profile == LEGACY_DEFAULT_PROFILE:
            connection.execute("DELETE FROM business_profile")

        connection.commit()


def get_profile() -> dict:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT key, value FROM business_profile"
        ).fetchall()
    return {row["key"]: row["value"] for row in rows}


def set_value(key: str, value: str) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO business_profile (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        connection.commit()


initialize_database()
