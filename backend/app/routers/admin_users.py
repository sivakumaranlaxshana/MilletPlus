from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.user import User
from app.models.user_status_history import UserStatusHistory


router = APIRouter(
    prefix="/admin/users",
    tags=["Admin Users"],
)

DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]

UserRole = Literal["farmer", "buyer", "admin"]


class UserStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool = Field(strict=True)

    reason: str = Field(
        min_length=3,
        max_length=1000,
    )

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value):
        if isinstance(value, str):
            return " ".join(value.split())
        return value


def user_data(user: User):
    # Explicit allowlist: never expose password/token fields.
    return {
        "id": user.id,
        "name": user.name,
        "phone": user.phone,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "sms_opt_in": user.sms_opt_in,
        "created_at": user.created_at,
    }


def find_user(db: Session, user_id: int):
    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(404, "User not found.")

    return user


@router.get("")
def list_users(
    db: DB,
    admin: Admin,
    search: Annotated[
        str | None,
        Query(min_length=1, max_length=100),
    ] = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    conditions = []

    if search is not None:
        search = search.strip()

        if not search:
            raise HTTPException(
                422,
                "Enter a name, phone number or email to search.",
            )

        conditions.append(
            or_(
                User.name.contains(search, autoescape=True),
                User.phone.contains(search, autoescape=True),
                User.email.contains(search, autoescape=True),
            )
        )

    if role is not None:
        conditions.append(User.role == role)

    if is_active is not None:
        conditions.append(User.is_active == is_active)

    total = db.scalar(
        select(func.count(User.id)).where(*conditions)
    )

    users = db.scalars(
        select(User)
        .where(*conditions)
        .order_by(User.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return {
        "total_records": int(total or 0),
        "limit": limit,
        "offset": offset,
        "items": [user_data(user) for user in users],
    }


@router.get("/{user_id}")
def user_details(
    user_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
):
    return user_data(find_user(db, user_id))


@router.patch("/{user_id}/status")
def change_user_status(
    user_id: Annotated[int, Path(gt=0)],
    data: UserStatusUpdate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    try:
        if user_id == admin_id:
            raise HTTPException(
                409,
                "You cannot change your own account status here.",
            )

        user = db.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if user is None:
            raise HTTPException(404, "User not found.")

        # This endpoint manages Farmer and Buyer accounts only.
        if user.role == "admin":
            raise HTTPException(
                403,
                "Admin accounts cannot be changed through this endpoint.",
            )

        # Repeating the same status does not create duplicate history.
        if user.is_active == data.is_active:
            result = {
                "changed": False,
                "user": user_data(user),
            }
            db.commit()
            return result

        changed_at = datetime.now(timezone.utc).replace(
            tzinfo=None,
            microsecond=0,
        )

        history = UserStatusHistory(
            user_id=user.id,
            previous_active=user.is_active,
            new_active=data.is_active,
            reason=data.reason,
            changed_by=admin_id,
            changed_at=changed_at,
        )

        user.is_active = data.is_active

        # Invalidate existing tokens on every actual status change.
        user.token_version += 1

        db.add(history)
        db.flush()

        result = {
            "changed": True,
            "user": user_data(user),
            "status_change": {
                "id": history.id,
                "reason": history.reason,
                "changed_by": history.changed_by,
                "changed_at": changed_at.replace(
                    tzinfo=timezone.utc
                ),
            },
        }

        db.commit()
        return result

    except Exception:
        db.rollback()
        raise


@router.get("/{user_id}/status-history")
def user_status_history(
    user_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    find_user(db, user_id)

    total = db.scalar(
        select(func.count(UserStatusHistory.id)).where(
            UserStatusHistory.user_id == user_id
        )
    )

    rows = db.execute(
        select(UserStatusHistory, User.name)
        .join(
            User,
            User.id == UserStatusHistory.changed_by,
        )
        .where(UserStatusHistory.user_id == user_id)
        .order_by(UserStatusHistory.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return {
        "total_records": int(total or 0),
        "items": [
            {
                "id": history.id,
                "user_id": history.user_id,
                "previous_active": history.previous_active,
                "new_active": history.new_active,
                "reason": history.reason,
                "changed_by": history.changed_by,
                "changed_by_name": admin_name,
                "changed_at": history.changed_at.replace(
                    tzinfo=timezone.utc
                ),
            }
            for history, admin_name in rows
        ],
    }