from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Annotated, Literal
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
    model_validator,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.farmer_payment_reversal import (
    FarmerPaymentReversal,
)
from app.models.farmer_purchase import (
    FarmerPurchase,
    FarmerPurchasePayment,
)
from app.models.stock import HarvestStock
from app.models.user import User
from app.schemas.farmer_purchase import (
    PurchaseCreate,
    PurchasePaymentCreate,
)


router = APIRouter(
    prefix="/admin/farmer-purchases",
    tags=["Admin Farmer Purchases / Debit"],
)

DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]

SL_TIME = timezone(timedelta(hours=5, minutes=30))
ZERO = Decimal("0.00")


def utc_now():
    return datetime.now(timezone.utc).replace(
        tzinfo=None,
        microsecond=0,
    )


def utc_value(value):
    return value.replace(tzinfo=timezone.utc)


def payment_not_reversed():
    return ~select(FarmerPaymentReversal.id).where(
        FarmerPaymentReversal.payment_id
        == FarmerPurchasePayment.id
    ).exists()


def total_paid(db: Session, purchase_id: int) -> Decimal:
    amount = db.scalar(
        select(
            func.coalesce(
                func.sum(FarmerPurchasePayment.amount),
                0,
            )
        ).where(
            FarmerPurchasePayment.purchase_id == purchase_id,
            payment_not_reversed(),
        )
    )

    return Decimal(str(amount))


def purchase_data(purchase: FarmerPurchase, paid: Decimal):
    balance = purchase.total_amount - paid

    if paid == 0:
        payment_status = "unpaid"
    elif balance == 0:
        payment_status = "paid"
    else:
        payment_status = "partial"

    return {
        "id": purchase.id,
        "stock_id": purchase.stock_id,
        "farmer_id": purchase.farmer_id,
        "farmer_name": purchase.farmer_name,
        "variety_id": purchase.variety_id,
        "variety_name": purchase.variety_name,
        "purchase_date": purchase.purchase_date,
        "quantity_kg": purchase.quantity_kg,
        "unit_price": purchase.unit_price,
        "total_amount": purchase.total_amount,
        "paid_amount": paid,
        "balance_amount": balance,
        "payment_status": payment_status,
        "currency": purchase.currency,
        "note": purchase.note,
        "recorded_by": purchase.recorded_by,
        "created_at": utc_value(purchase.created_at),
    }


def reversal_data(row: FarmerPaymentReversal):
    return {
        "id": row.id,
        "payment_id": row.payment_id,
        "kind": row.kind,
        "reason": row.reason,
        "return_reference": row.return_reference,
        "effective_at": utc_value(row.effective_at),
        "recorded_by": row.recorded_by,
        "created_at": utc_value(row.created_at),
    }


def payment_data(
    payment: FarmerPurchasePayment,
    reversal: FarmerPaymentReversal | None = None,
):
    return {
        "id": payment.id,
        "purchase_id": payment.purchase_id,
        "receipt_number": payment.receipt_number,
        "payment_method": payment.payment_method,
        "amount": payment.amount,
        "paid_at": utc_value(payment.paid_at),
        "note": payment.note,
        "recorded_by": payment.recorded_by,
        "created_at": utc_value(payment.created_at),
        "is_reversed": reversal is not None,
        "reversal": (
            reversal_data(reversal)
            if reversal is not None
            else None
        ),
    }


def get_purchase(
    db: Session,
    purchase_id: int,
    lock: bool = False,
):
    statement = select(FarmerPurchase).where(
        FarmerPurchase.id == purchase_id
    )

    if lock:
        statement = statement.with_for_update().execution_options(
            populate_existing=True
        )

    purchase = db.scalar(statement)

    if purchase is None:
        raise HTTPException(404, "Purchase not found.")

    return purchase


@router.post("", status_code=201)
def create_purchase(
    data: PurchaseCreate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    try:
        stock = db.scalar(
            select(HarvestStock)
            .where(HarvestStock.id == data.stock_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if stock is None:
            raise HTTPException(
                404,
                "Received stock not found.",
            )

        previous = db.scalar(
            select(FarmerPurchase)
            .where(
                FarmerPurchase.request_key
                == str(data.request_key)
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if previous is not None:
            if (
                previous.stock_id != data.stock_id
                or previous.purchase_date != data.purchase_date
                or previous.unit_price != data.unit_price
                or previous.note != data.note
            ):
                raise HTTPException(
                    409,
                    "Request key was used with different details.",
                )

            result = purchase_data(
                previous,
                total_paid(db, previous.id),
            )

            db.commit()
            return result

        existing_id = db.scalar(
            select(FarmerPurchase.id).where(
                FarmerPurchase.stock_id == stock.id
            )
        )

        if existing_id is not None:
            raise HTTPException(
                409,
                "A purchase already exists for this stock.",
            )

        crop = stock.harvest.crop_cycle
        farmer = crop.farm.farmer
        variety = crop.variety

        if farmer.role != "farmer":
            raise HTTPException(
                409,
                "Stock owner requires administrator review.",
            )

        today = datetime.now(SL_TIME).date()

        if not (
            stock.harvest.harvest_date
            <= data.purchase_date
            <= stock.received_date
            <= today
        ):
            raise HTTPException(
                422,
                "Purchase date must be on or after harvest, "
                "on or before stock receipt, and not in the future.",
            )

        with localcontext() as context:
            context.prec = 50

            amount = (
                stock.received_quantity_kg * data.unit_price
            ).quantize(
                Decimal("0.01"),
                rounding=ROUND_HALF_UP,
            )

        if amount <= 0:
            raise HTTPException(
                422,
                "Rounded purchase total must be positive.",
            )

        purchase = FarmerPurchase(
            request_key=str(data.request_key),
            stock_id=stock.id,
            farmer_id=farmer.id,
            variety_id=variety.id,
            farmer_name=farmer.name,
            variety_name=variety.name,
            purchase_date=data.purchase_date,
            quantity_kg=stock.received_quantity_kg,
            unit_price=data.unit_price,
            total_amount=amount,
            currency="LKR",
            note=data.note,
            recorded_by=admin_id,
            created_at=utc_now(),
        )

        db.add(purchase)
        db.flush()

        result = purchase_data(purchase, ZERO)

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            409,
            "Purchase conflict. Check existing purchases.",
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get("")
def list_purchases(
    db: DB,
    admin: Admin,
    farmer_id: Annotated[int | None, Query(gt=0)] = None,
    variety_id: Annotated[int | None, Query(gt=0)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment_status: Literal[
        "unpaid",
        "partial",
        "paid",
    ] | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "Invalid date range.")

    payments = (
        select(
            FarmerPurchasePayment.purchase_id.label(
                "purchase_id"
            ),
            func.sum(
                FarmerPurchasePayment.amount
            ).label("paid"),
        )
        .where(payment_not_reversed())
        .group_by(FarmerPurchasePayment.purchase_id)
        .subquery()
    )

    paid = func.coalesce(payments.c.paid, 0)

    filtered = (
        select(
            FarmerPurchase.id.label("purchase_id"),
            paid.label("paid"),
        )
        .outerjoin(
            payments,
            payments.c.purchase_id == FarmerPurchase.id,
        )
    )

    if farmer_id is not None:
        filtered = filtered.where(
            FarmerPurchase.farmer_id == farmer_id
        )

    if variety_id is not None:
        filtered = filtered.where(
            FarmerPurchase.variety_id == variety_id
        )

    if date_from:
        filtered = filtered.where(
            FarmerPurchase.purchase_date >= date_from
        )

    if date_to:
        filtered = filtered.where(
            FarmerPurchase.purchase_date <= date_to
        )

    if payment_status == "unpaid":
        filtered = filtered.where(paid == 0)
    elif payment_status == "partial":
        filtered = filtered.where(
            paid > 0,
            paid < FarmerPurchase.total_amount,
        )
    elif payment_status == "paid":
        filtered = filtered.where(
            paid == FarmerPurchase.total_amount
        )

    matching = filtered.subquery()

    count, purchased, paid_amount = db.execute(
        select(
            func.count(FarmerPurchase.id),
            func.coalesce(
                func.sum(FarmerPurchase.total_amount),
                0,
            ),
            func.coalesce(
                func.sum(matching.c.paid),
                0,
            ),
        )
        .select_from(FarmerPurchase)
        .join(
            matching,
            matching.c.purchase_id == FarmerPurchase.id,
        )
    ).one()

    rows = db.execute(
        select(FarmerPurchase, matching.c.paid)
        .join(
            matching,
            matching.c.purchase_id == FarmerPurchase.id,
        )
        .order_by(
            FarmerPurchase.purchase_date.desc(),
            FarmerPurchase.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()

    purchased = Decimal(str(purchased))
    paid_amount = Decimal(str(paid_amount))

    return {
        "currency": "LKR",
        "total_records": count,
        "total_purchase_amount": purchased,
        "total_paid_amount": paid_amount,
        "total_balance_amount": purchased - paid_amount,
        "items": [
            purchase_data(
                purchase,
                Decimal(str(amount)),
            )
            for purchase, amount in rows
        ],
    }


@router.get("/{purchase_id}")
def purchase_details(
    purchase_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
):
    purchase = get_purchase(db, purchase_id)

    return purchase_data(
        purchase,
        total_paid(db, purchase.id),
    )


@router.get("/{purchase_id}/payments")
def purchase_payment_history(
    purchase_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    get_purchase(db, purchase_id)

    rows = db.execute(
        select(
            FarmerPurchasePayment,
            FarmerPaymentReversal,
        )
        .outerjoin(
            FarmerPaymentReversal,
            FarmerPaymentReversal.payment_id
            == FarmerPurchasePayment.id,
        )
        .where(
            FarmerPurchasePayment.purchase_id == purchase_id
        )
        .order_by(
            FarmerPurchasePayment.paid_at.desc(),
            FarmerPurchasePayment.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        payment_data(payment, reversal)
        for payment, reversal in rows
    ]


@router.post("/{purchase_id}/payments", status_code=201)
def record_cash_payment(
    purchase_id: Annotated[int, Path(gt=0)],
    data: PurchasePaymentCreate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    paid_at = data.paid_at.astimezone(
        timezone.utc
    ).replace(tzinfo=None)

    try:
        purchase = get_purchase(
            db,
            purchase_id,
            lock=True,
        )

        previous = db.scalar(
            select(FarmerPurchasePayment).where(
                FarmerPurchasePayment.request_key
                == str(data.request_key)
            )
        )

        if previous is not None:
            if (
                previous.purchase_id != purchase.id
                or previous.receipt_number != data.receipt_number
                or previous.amount != data.amount
                or previous.paid_at != paid_at
                or previous.note != data.note
            ):
                raise HTTPException(
                    409,
                    "Request key was used with different payment details.",
                )

            reversal = db.scalar(
                select(FarmerPaymentReversal).where(
                    FarmerPaymentReversal.payment_id
                    == previous.id
                )
            )

            result = payment_data(previous, reversal)

            db.commit()
            return result

        if paid_at > utc_now():
            raise HTTPException(
                422,
                "Payment time cannot be in the future.",
            )

        if (
            data.paid_at.astimezone(SL_TIME).date()
            < purchase.purchase_date
        ):
            raise HTTPException(
                422,
                "Payment date cannot be before the purchase date.",
            )

        existing_receipt = db.scalar(
            select(FarmerPurchasePayment.id).where(
                FarmerPurchasePayment.receipt_number
                == data.receipt_number
            )
        )

        if existing_receipt is not None:
            raise HTTPException(
                409,
                "This payment receipt already exists.",
            )

        already_paid = total_paid(db, purchase.id)
        balance = purchase.total_amount - already_paid

        if data.amount > balance:
            raise HTTPException(
                409,
                "Payment exceeds the outstanding purchase balance.",
            )

        payment = FarmerPurchasePayment(
            request_key=str(data.request_key),
            receipt_number=data.receipt_number,
            purchase_id=purchase.id,
            amount=data.amount,
            payment_method="cash",
            paid_at=paid_at,
            note=data.note,
            recorded_by=admin_id,
            created_at=utc_now(),
        )

        db.add(payment)
        db.flush()

        result = payment_data(payment)
        result["purchase"] = purchase_data(
            purchase,
            already_paid + data.amount,
        )

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            409,
            "Payment conflict. Check existing payment records.",
        ) from None

    except Exception:
        db.rollback()
        raise


class PaymentReversalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_key: UUID

    kind: Literal[
        "recording_error",
        "cash_return",
    ]

    reason: str = Field(
        min_length=5,
        max_length=1000,
    )

    returned_at: AwareDatetime | None = None

    return_reference: str | None = Field(
        default=None,
        max_length=100,
    )

    @field_validator(
        "reason",
        "return_reference",
        mode="before",
    )
    @classmethod
    def clean_text(cls, value):
        if isinstance(value, str):
            return " ".join(value.split()) or None

        return value

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind == "cash_return":
            if (
                self.returned_at is None
                or not self.return_reference
            ):
                raise ValueError(
                    "Cash return requires returned_at "
                    "and return_reference."
                )

        elif (
            self.returned_at is not None
            or self.return_reference is not None
        ):
            raise ValueError(
                "Recording error must not include cash-return fields."
            )

        return self


@router.post(
    "/{purchase_id}/payments/{payment_id}/reversal",
    status_code=201,
)
def reverse_farmer_payment(
    purchase_id: Annotated[int, Path(gt=0)],
    payment_id: Annotated[int, Path(gt=0)],
    data: PaymentReversalCreate,
    db: DB,
    admin: Admin,
):
    admin_id = admin.id

    effective_at = (
        data.returned_at.astimezone(
            timezone.utc
        ).replace(tzinfo=None)
        if data.returned_at is not None
        else None
    )

    try:
        purchase = get_purchase(
            db,
            purchase_id,
            lock=True,
        )

        payment = db.scalar(
            select(FarmerPurchasePayment)
            .where(
                FarmerPurchasePayment.id == payment_id,
                FarmerPurchasePayment.purchase_id
                == purchase.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if payment is None:
            raise HTTPException(
                404,
                "Payment not found for this purchase.",
            )

        previous = db.scalar(
            select(FarmerPaymentReversal).where(
                FarmerPaymentReversal.request_key
                == str(data.request_key)
            )
        )

        if previous is not None:
            if (
                previous.payment_id != payment.id
                or previous.kind != data.kind
                or previous.reason != data.reason
                or previous.return_reference != data.return_reference
                or (
                    data.kind == "cash_return"
                    and previous.effective_at != effective_at
                )
            ):
                raise HTTPException(
                    409,
                    "Request key was used with different reversal details.",
                )

            result = {
                "payment": payment_data(payment, previous),
                "purchase": purchase_data(
                    purchase,
                    total_paid(db, purchase.id),
                ),
            }

            db.commit()
            return result

        existing_reversal = db.scalar(
            select(FarmerPaymentReversal.id).where(
                FarmerPaymentReversal.payment_id == payment.id
            )
        )

        if existing_reversal is not None:
            raise HTTPException(
                409,
                "This payment already has a reversal.",
            )

        now = utc_now()

        if data.kind == "cash_return":
            if (
                effective_at > now
                or effective_at < payment.paid_at
            ):
                raise HTTPException(
                    422,
                    "Return time must be between payment time and now.",
                )
        else:
            effective_at = now

        reversal = FarmerPaymentReversal(
            payment_id=payment.id,
            request_key=str(data.request_key),
            kind=data.kind,
            reason=data.reason,
            return_reference=data.return_reference,
            effective_at=effective_at,
            recorded_by=admin_id,
            created_at=now,
        )

        db.add(reversal)
        db.flush()

        result = {
            "payment": payment_data(payment, reversal),
            "purchase": purchase_data(
                purchase,
                total_paid(db, purchase.id),
            ),
        }

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            409,
            "Reversal conflict. Check payment history before retrying.",
        ) from None

    except Exception:
        db.rollback()
        raise