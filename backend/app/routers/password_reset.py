import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.email_service import (
    EmailDeliveryError,
    send_password_reset_otp,
)
from app.models.password_reset_token import PasswordResetToken
from app.models.user import User
from app.schemas.user import (
    ForgotPasswordRequest,
    MessageResponse,
    ResetPasswordRequest,
)
from app.security import hash_password


router = APIRouter(
    prefix="/auth",
    tags=["Password Reset"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

REQUEST_MESSAGE = (
    "If an eligible account exists, a verification code "
    "will be sent. Please check your inbox and spam folder."
)

INVALID_OTP_MESSAGE = (
    "Invalid or expired verification code. "
    "Please request a new code."
)


def utc_now() -> datetime:
    # Store timezone-naive UTC values in MySQL DateTime columns.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def otp_digest(user_id: int, otp: str) -> str:
    secret = (
        settings.JWT_SECRET_KEY
        .get_secret_value()
        .encode()
    )

    message = (
        f"millet-pulse:password-reset:{user_id}:{otp}"
    ).encode()

    return hmac.new(
        secret,
        message,
        hashlib.sha256,
    ).hexdigest()


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
)
def forgot_password(
    data: ForgotPasswordRequest,
    db: DatabaseSession,
):
    if (
        not settings.SMTP_USERNAME.strip()
        or not settings.SMTP_PASSWORD.get_secret_value().strip()
        or not settings.SMTP_FROM_EMAIL.strip()
    ):
        raise HTTPException(
            status_code=503,
            detail=(
                "Email service is not configured yet. "
                "Please try again later."
            ),
        )

    email = str(data.email).strip().lower()

    # Serialize reset requests for this account.
    user = db.scalar(
        select(User)
        .where(User.email == email)
        .with_for_update()
    )

    if user is None or not user.is_active:
        db.rollback()
        return MessageResponse(
            message=REQUEST_MESSAGE,
        )

    now = utc_now()

    latest = db.scalar(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id
        )
        .order_by(PasswordResetToken.id.desc())
        .limit(1)
    )

    if latest is not None:
        resend_after = latest.created_at + timedelta(
            seconds=settings.RESET_OTP_RESEND_SECONDS
        )

        if now < resend_after:
            db.rollback()
            return MessageResponse(
                message=REQUEST_MESSAGE,
            )

        # Resending cannot bypass the current attempt lockout.
        if (
            latest.attempts
            >= settings.RESET_OTP_MAX_ATTEMPTS
            and latest.expires_at > now
        ):
            db.rollback()
            return MessageResponse(
                message=REQUEST_MESSAGE,
            )

    # Maximum five generated codes per account per hour.
    recent_count = db.scalar(
        select(func.count())
        .select_from(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at
            >= now - timedelta(hours=1),
        )
    )

    if recent_count is not None and recent_count >= 5:
        db.rollback()
        return MessageResponse(
            message=REQUEST_MESSAGE,
        )

    otp = f"{secrets.randbelow(1_000_000):06d}"

    # Previously issued codes become invalid.
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    reset_record = PasswordResetToken(
        user_id=user.id,
        otp_hash=otp_digest(user.id, otp),
        attempts=0,
        expires_at=now + timedelta(
            minutes=settings.RESET_OTP_EXPIRE_MINUTES
        ),
        created_at=now,
    )

    db.add(reset_record)
    db.flush()

    try:
        send_password_reset_otp(
            recipient_email=email,
            otp=otp,
        )

    except EmailDeliveryError as exc:
        db.rollback()

        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to send the verification email. "
                "Please try again later."
            ),
        ) from exc

    db.commit()

    return MessageResponse(
        message=REQUEST_MESSAGE,
    )


@router.post(
    "/reset-password",
    response_model=MessageResponse,
)
def reset_password(
    data: ResetPasswordRequest,
    db: DatabaseSession,
):
    email = str(data.email).strip().lower()

    user = db.scalar(
        select(User)
        .where(User.email == email)
        .with_for_update()
    )

    if user is None or not user.is_active:
        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=INVALID_OTP_MESSAGE,
        )

    reset_record = db.scalar(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id
        )
        .order_by(PasswordResetToken.id.desc())
        .limit(1)
        .with_for_update()
    )

    now = utc_now()

    if (
        reset_record is None
        or reset_record.used_at is not None
        or reset_record.expires_at <= now
        or reset_record.attempts
        >= settings.RESET_OTP_MAX_ATTEMPTS
    ):
        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=INVALID_OTP_MESSAGE,
        )

    expected_hash = otp_digest(
        user.id,
        data.otp,
    )

    if not hmac.compare_digest(
        reset_record.otp_hash,
        expected_hash,
    ):
        reset_record.attempts += 1
        db.commit()

        raise HTTPException(
            status_code=400,
            detail=INVALID_OTP_MESSAGE,
        )

    # Set the new password.
    user.password_hash = hash_password(
        data.new_password
    )

    # Invalidate previously issued login tokens.
    user.token_version += 1

    # Consume all outstanding reset codes.
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )

    db.commit()

    return MessageResponse(
        message=(
            "Password reset successful. "
            "Please log in with your new password."
        )
    )