from datetime import timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
)
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.farmer_subscription import (
    FarmerSubscription,
    FarmerSubscriptionPayment,
    utc_now,
)
from app.models.subscription_cash_receipt import (
    SubscriptionCashReceipt,
)
from app.models.subscription_cash_reversal import (
    SubscriptionCashReversal,
)
from app.models.user import User


router = APIRouter(
    prefix="/admin/cash-subscription-reversals",
    tags=["Admin Cash Subscription Reversals"],
)

DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]


class CashReversalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_key: UUID

    kind: Literal[
        "recording_error",
        "cash_refund",
    ]

    reason: str = Field(
        min_length=5,
        max_length=1000,
    )

    refunded_at: AwareDatetime | None = None

    refund_reference: str | None = Field(
        default=None,
        max_length=100,
    )

    @field_validator(
        "reason",
        "refund_reference",
        mode="before",
    )
    @classmethod
    def clean_text(cls, value):
        if isinstance(value, str):
            return " ".join(value.split()) or None

        return value

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind == "cash_refund":
            if (
                self.refunded_at is None
                or not self.refund_reference
            ):
                raise ValueError(
                    "Cash refund requires refunded_at "
                    "and refund_reference."
                )

        elif (
            self.refunded_at is not None
            or self.refund_reference is not None
        ):
            raise ValueError(
                "Recording error must not contain refund fields."
            )

        return self


def as_utc(value):
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def reversal_data(row):
    if row is None:
        return None

    return {
        "id": row.id,
        "receipt_id": row.receipt_id,
        "payment_id": row.payment_id,
        "kind": row.kind,
        "amount": row.amount,
        "reason": row.reason,
        "refund_reference": row.refund_reference,
        "effective_at": as_utc(row.effective_at),
        "recorded_by": row.recorded_by,
        "recorded_at": as_utc(row.created_at),
    }


def result_data(
    receipt,
    subscription,
    payment,
    reversal,
):
    return {
        "receipt_id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "farmer_id": receipt.farmer_id,
        "subscription_id": subscription.id,
        "payment_status": payment.status,
        "subscription_status": subscription.effective_status,
        "has_access": subscription.has_access,
        "is_reversed": reversal is not None,
        "reversal": reversal_data(reversal),
    }


@router.post("/{receipt_id}", status_code=201)
def reverse_cash_subscription(
    receipt_id: Annotated[int, Path(gt=0)],
    data: CashReversalCreate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    effective_at = (
        data.refunded_at.astimezone(
            timezone.utc
        ).replace(
            tzinfo=None,
            microsecond=0,
        )
        if data.refunded_at is not None
        else None
    )

    try:
        owner_id = db.scalar(
            select(
                SubscriptionCashReceipt.farmer_id
            ).where(
                SubscriptionCashReceipt.id == receipt_id
            )
        )

        if owner_id is None:
            raise HTTPException(
                404,
                "Cash subscription receipt not found.",
            )

        # Match the subscription locking order:
        # User -> Subscriptions -> Payment.
        farmer = db.scalar(
            select(User)
            .where(User.id == owner_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if farmer is None:
            raise HTTPException(
                409,
                "Receipt owner is missing.",
            )

        subscriptions = db.scalars(
            select(FarmerSubscription)
            .where(
                FarmerSubscription.farmer_id == owner_id
            )
            .order_by(FarmerSubscription.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()

        receipt = db.scalar(
            select(SubscriptionCashReceipt)
            .where(
                SubscriptionCashReceipt.id == receipt_id,
                SubscriptionCashReceipt.farmer_id == owner_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if receipt is None:
            raise HTTPException(
                404,
                "Cash subscription receipt not found.",
            )

        subscription = next(
            (
                row
                for row in subscriptions
                if row.id == receipt.subscription_id
            ),
            None,
        )

        if subscription is None:
            raise HTTPException(
                409,
                "Receipt subscription does not match its farmer.",
            )

        payment = db.scalar(
            select(FarmerSubscriptionPayment)
            .where(
                FarmerSubscriptionPayment.subscription_id
                == subscription.id
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if payment is None:
            raise HTTPException(
                409,
                "Subscription payment is missing.",
            )

        previous = db.scalar(
            select(SubscriptionCashReversal)
            .where(
                SubscriptionCashReversal.request_key
                == str(data.request_key)
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if previous is not None:
            if (
                previous.receipt_id != receipt.id
                or previous.kind != data.kind
                or previous.reason != data.reason
                or previous.refund_reference
                != data.refund_reference
                or (
                    data.kind == "cash_refund"
                    and previous.effective_at != effective_at
                )
            ):
                raise HTTPException(
                    409,
                    "Request key was used with different reversal details.",
                )

            result = result_data(
                receipt,
                subscription,
                payment,
                previous,
            )

            db.commit()
            return result

        existing_reversal = db.scalar(
            select(SubscriptionCashReversal.id)
            .where(
                SubscriptionCashReversal.receipt_id
                == receipt.id
            )
            .with_for_update()
        )

        if existing_reversal is not None:
            raise HTTPException(
                409,
                "This cash receipt already has a reversal.",
            )

        if (
            payment.provider != "cash"
            or payment.provider_payment_id
            != receipt.receipt_number
            or payment.amount != receipt.amount
            or subscription.amount != receipt.amount
            or payment.currency != "LKR"
            or subscription.currency != "LKR"
            or payment.status != "paid"
            or payment.paid_at is None
            or payment.requires_review
            or subscription.status not in {
                "active",
                "expired",
            }
        ):
            raise HTTPException(
                409,
                "Cash receipt/payment requires administrator review.",
            )

        now = utc_now().replace(microsecond=0)

        if data.kind == "cash_refund":
            if (
                effective_at > now
                or effective_at < payment.paid_at
            ):
                raise HTTPException(
                    422,
                    "Refund time must be between payment time and now.",
                )
        else:
            effective_at = now

        reversal = SubscriptionCashReversal(
            receipt_id=receipt.id,
            payment_id=payment.id,
            request_key=str(data.request_key),
            kind=data.kind,
            amount=receipt.amount,
            reason=data.reason,
            refund_reference=data.refund_reference,
            effective_at=effective_at,
            recorded_by=admin_id,
            created_at=now,
        )

        db.add(reversal)

        # Preserve the original receipt, reference and paid_at.
        payment.status = (
            "refunded"
            if data.kind == "cash_refund"
            else "cancelled"
        )
        payment.closed_at = now

        # Revoke access only for this subscription.
        subscription.status = "cancelled"
        subscription.cancelled_at = now

        db.flush()

        result = result_data(
            receipt,
            subscription,
            payment,
            reversal,
        )

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            409,
            "Reversal conflict. Check existing receipt history.",
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get("/{receipt_id}")
def cash_reversal_details(
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

    subscription = db.get(
        FarmerSubscription,
        receipt.subscription_id,
    )

    payment = db.scalar(
        select(FarmerSubscriptionPayment).where(
            FarmerSubscriptionPayment.subscription_id
            == receipt.subscription_id
        )
    )

    if subscription is None or payment is None:
        raise HTTPException(
            409,
            "Receipt subscription/payment is missing.",
        )

    reversal = db.scalar(
        select(SubscriptionCashReversal).where(
            SubscriptionCashReversal.receipt_id == receipt.id
        )
    )

    return result_data(
        receipt,
        subscription,
        payment,
        reversal,
    )