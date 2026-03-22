import os

from groq import Groq


def get_groq_client() -> Groq:
    return Groq(api_key=os.getenv("GROQ_API_KEY"))
