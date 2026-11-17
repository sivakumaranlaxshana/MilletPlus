from pathlib import Path

from fastapi import HTTPException, status
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from pydantic_settings import BaseSettings, SettingsConfigDict
from requests.exceptions import RequestException


BACKEND_DIRECTORY = Path(__file__).resolve().parent.parent


class GoogleSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIRECTORY / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_client_id: str = ""


google_settings = GoogleSettings()


class TimeoutRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


def verify_google_credential(credential: str) -> dict:
    client_id = google_settings.google_client_id.strip()

    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google login is not configured.",
        )

    try:
        claims = id_token.verify_oauth2_token(
            credential,
            TimeoutRequest(),
            audience=client_id,
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google credential.",
        ) from exc

    except (GoogleAuthError, RequestException) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Cannot verify Google login right now. "
                "Please try again."
            ),
        ) from exc

    google_sub = claims.get("sub")
    email = claims.get("email")

    if (
        not isinstance(google_sub, str)
        or not google_sub
        or len(google_sub) > 255
        or not isinstance(email, str)
        or not email
        or len(email) > 254
        or claims.get("email_verified") is not True
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account details could not be verified.",
        )

    return claims