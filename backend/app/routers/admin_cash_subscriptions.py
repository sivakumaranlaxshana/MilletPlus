import calendar
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.farmer_subscription import (
    FarmerSubscription,
    FarmerSubscriptionPayment,
    FarmerSubscriptionPlan,
    utc_now,
)
from app.models.subscription_cash_receipt import (
    SubscriptionCashReceipt,
)
from app.models.user import User


router = APIRouter(
    prefix="/admin/cash-subscriptions",
    tags=["Admin Cash Subscriptions"],
)

DB = Annotated[Session, Depends(get_db)]

Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]


class CashSubscriptionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    farmer_id: int = Field(gt=0)
    plan_id: int = Field(gt=0)
    request_key: UUID

    receipt_number: str = Field(
        min_length=3,
        max_length=50,
        pattern=r"^[A-Z0-9][A-Z0-9/-]*$",
    )

    amount: Decimal = Field(
        gt=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    )

    received_at: AwareDatetime

    note: str | None = Field(
        default=None,
        max_length=1000,
    )

    @field_validator("receipt_number", mode="before")
    @classmethod
    def clean_receipt(cls, value):
        if isinstance(value, str):
            return value.strip().upper()

        return value

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None

        return value


def add_months(value: datetime, months: int) -> datetime:
    month_index = (
        value.year * 12
        + value.month
        - 1
        + months
    )

    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1

    day = min(
        value.day,
        calendar.monthrange(year, month)[1],
    )

    return value.replace(
        year=year,
        month=month,
        day=day,
    )


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def response_data(
    db: Session,
    receipt: SubscriptionCashReceipt,
):
    subscription = db.get(
        FarmerSubscription,
        receipt.subscription_id,
    )

    if subscription is None:
        raise HTTPException(
            409,
            "Receipt subscription is missing.",
        )

    farmer = db.get(
        User,
        receipt.farmer_id,
    )

    return {
        "receipt_id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "farmer_id": receipt.farmer_id,
        "farmer_name": farmer.name if farmer else None,
        "subscription_id": subscription.id,
        "plan_id": subscription.plan_id,
        "plan_name": subscription.plan_name,
        "payment_method": "cash",
        "amount": receipt.amount,
        "currency": subscription.currency,
        "received_at": as_utc(receipt.received_at),
        "recorded_by": receipt.recorded_by,
        "recorded_at": as_utc(receipt.created_at),
        "note": receipt.note,
        "subscription_status": subscription.effective_status,
        "has_access": subscription.has_access,
        "starts_at": as_utc(subscription.starts_at),
        "ends_at": as_utc(subscription.ends_at),
    }


@router.post("", status_code=201)
def record_cash_subscription(
    data: CashSubscriptionCreate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    received_at = (
        data.received_at
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )

    try:
        # Lock User first, matching subscription operations.
        farmer = db.scalar(
            select(User)
            .where(User.id == data.farmer_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if farmer is None or farmer.role != "farmer":
            raise HTTPException(
                404,
                "Farmer not found.",
            )

        previous = db.scalar(
            select(SubscriptionCashReceipt).where(
                SubscriptionCashReceipt.request_key
                == str(data.request_key)
            )
        )

        # An identical retry returns the existing receipt.
        if previous is not None:
            subscription = db.get(
                FarmerSubscription,
                previous.subscription_id,
            )

            if (
                previous.farmer_id != data.farmer_id
                or subscription is None
                or subscription.plan_id != data.plan_id
                or previous.receipt_number != data.receipt_number
                or previous.amount != data.amount
                or previous.received_at != received_at
                or previous.note != data.note
            ):
                raise HTTPException(
                    409,
                    "Request key was used with different details.",
                )

            result = response_data(db, previous)
            db.commit()

            return result

        if not farmer.is_active:
            raise HTTPException(
                409,
                "Activate this farmer account first.",
            )

        if received_at > utc_now():
            raise HTTPException(
                422,
                "Received time cannot be in the future.",
            )

        existing_receipt_id = db.scalar(
            select(SubscriptionCashReceipt.id).where(
                SubscriptionCashReceipt.receipt_number
                == data.receipt_number
            )
        )

        if existing_receipt_id is not None:
            raise HTTPException(
                409,
                "This cash receipt number already exists.",
            )

        subscriptions = db.scalars(
            select(FarmerSubscription)
            .where(
                FarmerSubscription.farmer_id == farmer.id
            )
            .order_by(FarmerSubscription.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()

        for existing in subscriptions:
            if existing.status == "pending":
                raise HTTPException(
                    409,
                    "A pending subscription already exists. "
                    "Resolve it before recording a new cash subscription.",
                )

            if existing.effective_status == "active":
                raise HTTPException(
                    409,
                    "An active subscription already exists. "
                    "Early renewal is not supported by this endpoint.",
                )

            if (
                existing.status == "active"
                and existing.effective_status == "expired"
            ):
                existing.status = "expired"

        if any(
            row.request_key == str(data.request_key)
            for row in subscriptions
        ):
            raise HTTPException(
                409,
                "This request key belongs to another subscription.",
            )

        plan = db.scalar(
            select(FarmerSubscriptionPlan)
            .where(
                FarmerSubscriptionPlan.id == data.plan_id
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if plan is None or not plan.is_active:
            raise HTTPException(
                404,
                "Active subscription plan not found.",
            )

        if (
            plan.currency != "LKR"
            or not 1 <= plan.duration_months <= 120
        ):
            raise HTTPException(
                409,
                "Plan requires administrator review.",
            )

        if data.amount != plan.amount:
            raise HTTPException(
                422,
                "Received amount must equal the selected plan amount.",
            )

        # Use an explicit UTC timestamp for all new records.
        recorded_at = utc_now()
        starts_at = recorded_at

        try:
            ends_at = add_months(
                starts_at,
                plan.duration_months,
            )
        except (ValueError, OverflowError):
            raise HTTPException(
                422,
                "Invalid subscription duration.",
            ) from None

        subscription = FarmerSubscription(
            farmer_id=farmer.id,
            plan_id=plan.id,
            request_key=str(data.request_key),
            plan_name=plan.name,
            amount=plan.amount,
            currency=plan.currency,
            duration_months=plan.duration_months,
            status="active",
            starts_at=starts_at,
            ends_at=ends_at,
            created_at=recorded_at,
        )

        subscription.payment = FarmerSubscriptionPayment(
            provider="cash",
            amount=plan.amount,
            currency=plan.currency,
            status="paid",
            provider_payment_id=data.receipt_number,
            paid_at=received_at,
            closed_at=recorded_at,
            requires_review=False,
            created_at=recorded_at,
        )

        db.add(subscription)
        db.flush()

        receipt = SubscriptionCashReceipt(
            request_key=str(data.request_key),
            receipt_number=data.receipt_number,
            subscription_id=subscription.id,
            farmer_id=farmer.id,
            amount=plan.amount,
            received_at=received_at,
            recorded_by=admin_id,
            note=data.note,
            created_at=recorded_at,
        )

        db.add(receipt)
        db.flush()

        result = response_data(db, receipt)

        db.commit()

        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            409,
            "Receipt or subscription conflict. "
            "Check existing cash receipts before retrying.",
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get("")
def list_cash_subscriptions(
    db: DB,
    admin: Admin,
    farmer_id: Annotated[int | None, Query(gt=0)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    statement = select(SubscriptionCashReceipt)

    if farmer_id is not None:
        statement = statement.where(
            SubscriptionCashReceipt.farmer_id == farmer_id
        )

    rows = db.scalars(
        statement.order_by(
            SubscriptionCashReceipt.id.desc()
        )
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        response_data(db, row)
        for row in rows
    ]


@router.get("/{receipt_id}")
def cash_subscription_details(
    receipt_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
):
    receipt = db.get(
        SubscriptionCashReceipt,
        receipt_id,
    )

    if receipt is None:
        raise HTTPException(
            404,
            "Cash subscription receipt not found.",
        )

    return response_data(db, receipt)