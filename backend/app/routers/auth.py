import secrets
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.google_auth import verify_google_credential
from app.models.user import User
from app.schemas.user import (
    GoogleLoginRequest,
    GoogleRegisterRequest,
    LoginRequest,
    LoginResponse,
    ProfileUpdateRequest,
    RegisterRequest,
    UserResponse,
)
from app.security import (
    create_access_token,
    hash_password,
    verify_password,
)


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

CurrentUser = Annotated[
    User,
    Depends(get_current_user),
]

DUMMY_PASSWORD_HASH = hash_password(
    "millet-pulse-dummy-password"
)


def login_response(user: User) -> LoginResponse:
    return LoginResponse(
        access_token=create_access_token(
            user_id=user.id,
            token_version=user.token_version,
        ),
        user=UserResponse.model_validate(user),
    )


def ensure_active(user: User) -> None:
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive.",
        )


def commit_changes(
    db: Session,
    conflict_message: str,
) -> None:
    try:
        db.commit()

    except IntegrityError as exc:
        db.rollback()

        error_args = getattr(exc.orig, "args", ())
        error_code = error_args[0] if error_args else None

        if error_code == 1062:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=conflict_message,
            ) from exc

        raise


# Email / password registration.

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: RegisterRequest,
    db: DatabaseSession,
):
    email = str(data.email).strip().lower()

    existing_user = db.scalar(
        select(User).where(
            or_(
                User.phone == data.phone,
                User.email == email,
            )
        )
    )

    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This phone number or email "
                "is already registered."
            ),
        )

    user = User(
        name=data.name,
        phone=data.phone,
        email=email,
        password_hash=hash_password(data.password),
        role=data.role,
    )

    db.add(user)

    commit_changes(
        db,
        "This phone number or email is already registered.",
    )

    db.refresh(user)
    return user


# Email / password login.

@router.post(
    "/login",
    response_model=LoginResponse,
)
def login(
    data: LoginRequest,
    db: DatabaseSession,
):
    email = str(data.email).strip().lower()

    user = db.scalar(
        select(User).where(
            User.email == email
        )
    )

    stored_hash = (
        user.password_hash
        if user is not None
        else DUMMY_PASSWORD_HASH
    )

    password_valid = verify_password(
        data.password,
        stored_hash,
    )

    if (
        user is None
        or not password_valid
        or not user.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return login_response(user)


# Login using an already linked Google account.

@router.post(
    "/google",
    response_model=LoginResponse,
)
def google_login(
    data: GoogleLoginRequest,
    db: DatabaseSession,
):
    claims = verify_google_credential(data.credential)

    google_sub = claims["sub"]
    email = claims["email"].strip().lower()

    user = db.scalar(
        select(User).where(
            User.google_sub == google_sub
        )
    )

    if user is not None:
        ensure_active(user)
        return login_response(user)

    existing_email = db.scalar(
        select(User).where(
            User.email == email
        )
    )

    if existing_email is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "GOOGLE_LINK_REQUIRED",
                "message": (
                    "Log in with your existing account first, "
                    "then link your Google account."
                ),
            },
        )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "code": "GOOGLE_REGISTRATION_REQUIRED",
            "message": (
                "Complete registration with your phone "
                "number and account type."
            ),
        },
    )


# New Google user: collect phone and role.

@router.post(
    "/google/register",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
)
def google_register(
    data: GoogleRegisterRequest,
    db: DatabaseSession,
):
    claims = verify_google_credential(data.credential)

    google_sub = claims["sub"]
    email = claims["email"].strip().lower()

    linked_user = db.scalar(
        select(User).where(
            User.google_sub == google_sub
        )
    )

    if linked_user is not None:
        ensure_active(linked_user)
        return login_response(linked_user)

    existing_email = db.scalar(
        select(User).where(
            User.email == email
        )
    )

    if existing_email is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "GOOGLE_LINK_REQUIRED",
                "message": (
                    "Log in with your existing account first, "
                    "then link your Google account."
                ),
            },
        )

    existing_phone = db.scalar(
        select(User).where(
            User.phone == data.phone
        )
    )

    if existing_phone is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This phone number is already registered.",
        )

    google_name = claims.get("name")

    name = (
        google_name.strip()
        if isinstance(google_name, str)
        else ""
    )

    name = name[:100]

    if len(name) < 2:
        name = "Millet Pulse User"

    user = User(
        name=name,
        phone=data.phone,
        email=email,
        google_sub=google_sub,
        password_hash=hash_password(
            secrets.token_urlsafe(48)
        ),
        role=data.role,
    )

    db.add(user)

    commit_changes(
        db,
        (
            "This phone number, email or Google account "
            "is already registered. Please log in."
        ),
    )

    db.refresh(user)
    return login_response(user)


# Link Google after logging into an existing account.

@router.post(
    "/google/link",
    response_model=UserResponse,
)
def link_google(
    data: GoogleLoginRequest,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    ensure_active(current_user)

    claims = verify_google_credential(data.credential)

    google_sub = claims["sub"]
    email = claims["email"].strip().lower()

    if (
        current_user.email is None
        or current_user.email.strip().lower() != email
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Choose the Google account matching "
                "your Millet Pulse email."
            ),
        )

    if (
        current_user.google_sub is not None
        and current_user.google_sub != google_sub
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A different Google account "
                "is already linked."
            ),
        )

    linked_user = db.scalar(
        select(User).where(
            User.google_sub == google_sub
        )
    )

    if (
        linked_user is not None
        and linked_user.id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This Google account is already linked "
                "to another user."
            ),
        )

    current_user.google_sub = google_sub

    commit_changes(
        db,
        "This Google account is already linked.",
    )

    db.refresh(current_user)
    return current_user


# View the logged-in user's profile.

@router.get(
    "/me",
    response_model=UserResponse,
)
def me(
    current_user: CurrentUser,
):
    return current_user


# Update the logged-in user's profile.
# Farmer, Buyer and Admin can update their own profile.

@router.patch(
    "/me",
    response_model=UserResponse,
)
def update_profile(
    data: ProfileUpdateRequest,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    changes = data.model_dump(
        exclude_unset=True,
    )

    if "phone" in changes:
        existing_phone = db.scalar(
            select(User.id).where(
                User.phone == changes["phone"],
                User.id != current_user.id,
            )
        )

        if existing_phone is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This phone number is already registered."
                ),
            )

    # Only explicitly allowed fields are updated.
    if "name" in changes:
        current_user.name = changes["name"]

    if "phone" in changes:
        current_user.phone = changes["phone"]

    if "sms_opt_in" in changes:
        current_user.sms_opt_in = changes["sms_opt_in"]

    commit_changes(
        db,
        "This phone number is already registered.",
    )

    db.refresh(current_user)
    return current_user