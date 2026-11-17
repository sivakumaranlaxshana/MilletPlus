from typing import Annotated

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.farmer_crop_access import (
    FarmerCropAccess,
    utc_now,
)
from app.models.farmer_subscription import FarmerSubscription
from app.models.user import User


DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]


class AdviceAccessInput(BaseModel):
    crop_cycle_id: int = Field(gt=0)


def lock_crop_owner(
    db: Session,
    farmer_id: int,
) -> User:
    farmer = db.scalar(
        select(User)
        .where(User.id == farmer_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if farmer is None:
        raise HTTPException(404, "Farmer not found.")

    if not farmer.is_active or farmer.role != "farmer":
        raise HTTPException(
            403,
            "Active farmer account required.",
        )

    return farmer


def owned_crop(
    db: Session,
    farmer_id: int,
    crop_id: int,
) -> CropCycle:
    crop = db.scalar(
        select(CropCycle)
        .join(Farm, Farm.id == CropCycle.farm_id)
        .where(
            CropCycle.id == crop_id,
            Farm.farmer_id == farmer_id,
        )
    )

    if crop is None:
        raise HTTPException(404, "Crop not found.")

    return crop


def ensure_free_cycle_record(
    db: Session,
    farmer_id: int,
) -> FarmerCropAccess | None:
    """
    Caller must lock the User row first.

    Existing farmers receive their earliest retained crop
    as the first free cycle. Planting date is not used,
    because users can edit or backdate it.
    """
    record = db.get(FarmerCropAccess, farmer_id)

    if record is not None:
        # A NULL crop ID means the original free crop
        # was deleted. Never assign a replacement.
        return record

    first_crop_id = db.scalar(
        select(CropCycle.id)
        .join(Farm, Farm.id == CropCycle.farm_id)
        .where(Farm.farmer_id == farmer_id)
        .order_by(CropCycle.id)
        .limit(1)
    )

    if first_crop_id is None:
        return None

    record = FarmerCropAccess(
        farmer_id=farmer_id,
        free_crop_cycle_id=first_crop_id,
    )

    db.add(record)
    db.flush()

    return record


def has_paid_subscription(
    db: Session,
    farmer_id: int,
) -> bool:
    subscriptions = db.scalars(
        select(FarmerSubscription)
        .where(
            FarmerSubscription.farmer_id == farmer_id,
            FarmerSubscription.status == "active",
        )
        .execution_options(populate_existing=True)
    ).all()

    return any(
        subscription.has_access
        for subscription in subscriptions
    )


def check_crop_access(
    db: Session,
    farmer_id: int,
    crop_id: int,
    *,
    mark_used: bool = False,
) -> dict:
    """
    Locks and commits only the access-record transaction.
    This does not call the AI service.
    """
    try:
        lock_crop_owner(db, farmer_id)
        owned_crop(db, farmer_id, crop_id)

        record = ensure_free_cycle_record(
            db,
            farmer_id,
        )

        is_free_cycle = bool(
            record is not None
            and record.free_crop_cycle_id == crop_id
        )

        subscription_active = has_paid_subscription(
            db,
            farmer_id,
        )

        allowed = is_free_cycle or subscription_active

        if (
            mark_used
            and is_free_cycle
            and record.free_feature_used_at is None
        ):
            record.free_feature_used_at = utc_now()

        result = {
            "crop_cycle_id": crop_id,
            "is_free_cycle": is_free_cycle,
            "has_active_subscription": subscription_active,
            "has_access": allowed,
            "free_crop_cycle_id": (
                record.free_crop_cycle_id
                if record is not None
                else None
            ),
        }

        db.commit()
        return result

    except Exception:
        db.rollback()
        raise


async def require_ai_crop_access(
    request: Request,
    db: DatabaseSession,
    farmer: FarmerUser,
) -> None:
    """
    Protect only new AI Advice generation.

    Advice History stays readable without a subscription.
    Request is read directly so the existing request-body
    structure does not change.
    """
    if (
        request.method != "POST"
        or request.url.path.rstrip("/") != "/ai/crop-care"
    ):
        return

    try:
        body = await request.json()
    except (ValueError, UnicodeError):
        raise HTTPException(
            422,
            "Provide a valid JSON request body.",
        ) from None

    try:
        data = AdviceAccessInput.model_validate(body)
    except ValidationError:
        raise HTTPException(
            422,
            "Provide a valid crop_cycle_id.",
        ) from None

    result = await run_in_threadpool(
        check_crop_access,
        db,
        farmer.id,
        data.crop_cycle_id,
        mark_used=True,
    )

    if not result["has_access"]:
        raise HTTPException(
            status_code=403,
            detail=(
                "Your first crop cycle is free. "
                "An active subscription is required "
                "for AI advice on additional crop cycles."
            ),
        )