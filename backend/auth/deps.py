import os
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

bearer = HTTPBearer(auto_error=False)


def decode_session_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            os.getenv("JWT_SECRET"),
            algorithms=["HS256"],
        )
    except JWTError as error:
        raise HTTPException(status_code=401, detail="Invalid session") from error


def try_decode_session_token(token: str) -> dict[str, Any] | None:
    try:
        return decode_session_token(token)
    except HTTPException:
        return None


def get_current_business(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Invalid session")

    payload = decode_session_token(credentials.credentials)
    return payload["business_id"]
