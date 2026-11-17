from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

from app.config import settings


password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(
    password: str,
    password_hash: str,
) -> bool:
    return password_hasher.verify(
        password,
        password_hash,
    )


def create_access_token(
    user_id: int,
    token_version: int,
) -> str:
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        ),
    }

    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY.get_secret_value(),
        algorithm="HS256",
    )


def decode_access_token(token: str) -> tuple[int, int]:
    payload = jwt.decode(
        token,
        settings.JWT_SECRET_KEY.get_secret_value(),
        algorithms=["HS256"],
        options={
            "require": [
                "sub",
                "ver",
                "iat",
                "exp",
            ]
        },
    )

    subject = payload.get("sub")
    token_version = payload.get("ver")

    if (
        not isinstance(subject, str)
        or not subject.isdecimal()
    ):
        raise InvalidTokenError("Invalid user ID.")

    user_id = int(subject)

    if user_id < 1:
        raise InvalidTokenError("Invalid user ID.")

    if type(token_version) is not int or token_version < 0:
        raise InvalidTokenError("Invalid token version.")

    return user_id, token_version