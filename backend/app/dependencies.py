from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.security import decode_access_token


bearer = HTTPBearer(auto_error=False)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]


def get_current_user(
    db: DatabaseSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer),
    ],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Invalid or expired token. "
            "Please log in again."
        ),
        headers={
            "WWW-Authenticate": "Bearer",
        },
    )

    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
    ):
        raise unauthorized

    try:
        user_id, token_version = decode_access_token(
            credentials.credentials
        )
    except InvalidTokenError:
        raise unauthorized

    user = db.get(User, user_id)

    if (
        user is None
        or not user.is_active
        or user.token_version != token_version
    ):
        raise unauthorized

    return user


def require_roles(*allowed_roles: str):
    def check_permission(
        current_user: Annotated[
            User,
            Depends(get_current_user),
        ],
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You do not have permission "
                    "to access this."
                ),
            )

        return current_user

    return check_permission