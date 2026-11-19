import re
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.user import User
from app.routers.admin_users import user_data
from app.schemas.user import RegisterRequest
from app.security import hash_password


router = APIRouter(
    prefix="/admin/users",
    tags=["Admin User Editor"],
)

DB = Annotated[
    Session,
    Depends(get_db),
]

Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]


class AdminUserEdit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )

    name: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )

    email: str | None = Field(
        default=None,
        min_length=3,
        max_length=254,
    )

    @field_validator(
        "name",
        "email",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null."
            )
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value):
        if not re.fullmatch(
            r"[^@\s]+@[^@\s]+\.[^@\s]+",
            value,
        ):
            raise ValueError(
                "Enter a valid email address."
            )

        return value.lower()

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide a name or email to update."
            )
        return self


def conflict_or_raise(
    db: Session,
    exc: IntegrityError,
):
    db.rollback()

    args = getattr(exc.orig, "args", ())

    if args and args[0] == 1062:
        raise HTTPException(
            409,
            "Phone number or email already exists.",
        ) from exc

    raise exc


@router.post("", status_code=201)
def create_user(
    data: RegisterRequest,
    db: DB,
    admin: Admin,
):
    if data.role not in ("farmer", "buyer"):
        raise HTTPException(
            403,
            "Only farmer and buyer accounts "
            "can be created here.",
        )

    email = str(data.email).strip().lower()

    try:
        existing = db.scalar(
            select(User.id).where(
                or_(
                    User.phone == data.phone,
                    User.email == email,
                )
            )
        )

        if existing is not None:
            raise HTTPException(
                409,
                "Phone number or email already exists.",
            )

        user = User(
            name=data.name,
            phone=data.phone,
            email=email,
            password_hash=hash_password(
                data.password
            ),
            role=data.role,
            is_active=True,
            sms_opt_in=False,
            token_version=0,
        )

        db.add(user)
        db.flush()
        db.refresh(user)

        result = user_data(user)

        db.commit()

        return result

    except IntegrityError as exc:
        conflict_or_raise(db, exc)

    except Exception:
        db.rollback()
        raise


@router.patch("/{user_id}")
def edit_user(
    user_id: Annotated[int, Path(gt=0)],
    data: AdminUserEdit,
    db: DB,
    admin: Admin,
):
    try:
        user = db.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(
                populate_existing=True
            )
        )

        if user is None:
            raise HTTPException(
                404,
                "User not found.",
            )

        if user.role == "admin":
            raise HTTPException(
                403,
                "Admin accounts cannot be edited here.",
            )

        changes = data.model_dump(
            exclude_unset=True
        )

        email = changes.get("email")

        if (
            email is not None
            and email != user.email
        ):
            if user.google_sub:
                raise HTTPException(
                    409,
                    "A linked Google account email "
                    "cannot be changed here. "
                    "You may edit the name separately.",
                )

            duplicate = db.scalar(
                select(User.id).where(
                    User.email == email,
                    User.id != user.id,
                )
            )

            if duplicate is not None:
                raise HTTPException(
                    409,
                    "Email already exists.",
                )

            user.email = email

            # Existing access tokens become invalid.
            user.token_version += 1

        if "name" in changes:
            user.name = changes["name"]

        db.flush()

        result = user_data(user)

        db.commit()

        return result

    except IntegrityError as exc:
        conflict_or_raise(db, exc)

    except Exception:
        db.rollback()
        raise