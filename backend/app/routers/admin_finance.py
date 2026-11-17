from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.farmer_subscription import (
    FarmerSubscription,
    FarmerSubscriptionPayment,
)
from app.models.order import Order, OrderItem
from app.models.order_payment import OrderPayment
from app.models.user import User


router = APIRouter(
    prefix="/admin/finance",
    tags=["Admin Payments / Finance"],
)

DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]

PaymentStatus = Literal[
    "pending",
    "paid",
    "failed",
    "cancelled",
    "refunded",
]

PaymentMethod = Literal["cash", "payhere"]
DateBasis = Literal["created_at", "paid_at"]

SL_TIME = timezone(timedelta(hours=5, minutes=30))


def as_utc(value):
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def day_start_utc(value: date) -> datetime:
    return (
        datetime.combine(
            value,
            time.min,
            tzinfo=SL_TIME,
        )
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )


def apply_dates(
    statement,
    column,
    date_from: date | None,
    date_to: date | None,
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            422,
            "date_from cannot be after date_to.",
        )

    try:
        if date_from:
            statement = statement.where(
                column >= day_start_utc(date_from)
            )

        if date_to:
            statement = statement.where(
                column < day_start_utc(
                    date_to + timedelta(days=1)
                )
            )
    except (OverflowError, ValueError):
        raise HTTPException(
            422,
            "Date range is outside the supported range.",
        ) from None

    return statement


def payment_data(payment):
    return {
        "payment_id": payment.id,
        "payment_method": payment.provider,
        "amount": payment.amount,
        "currency": payment.currency,
        "payment_status": payment.status,
        "reference": payment.provider_payment_id,
        "requires_review": payment.requires_review,
        "gateway_status_code": payment.gateway_status_code,
        "paid_at": as_utc(payment.paid_at),
        "closed_at": as_utc(payment.closed_at),
        "created_at": as_utc(payment.created_at),
    }


def payment_summary(
    db: Session,
    payment_model,
    filtered_ids,
):
    matching = filtered_ids.subquery()

    count, listed_amount = db.execute(
        select(
            func.count(payment_model.id),
            func.coalesce(
                func.sum(payment_model.amount), 0
            ),
        )
        .select_from(payment_model)
        .join(
            matching,
            matching.c.id == payment_model.id,
        )
    ).one()

    paid_count, paid_amount = db.execute(
        select(
            func.count(payment_model.id),
            func.coalesce(
                func.sum(payment_model.amount), 0
            ),
        )
        .select_from(payment_model)
        .join(
            matching,
            matching.c.id == payment_model.id,
        )
        .where(
            payment_model.status == "paid",
            payment_model.requires_review.is_(False),
            payment_model.currency == "LKR",
        )
    ).one()

    review_count = db.scalar(
        select(func.count(payment_model.id))
        .select_from(payment_model)
        .join(
            matching,
            matching.c.id == payment_model.id,
        )
        .where(payment_model.requires_review.is_(True))
    )

    return {
        "currency": "LKR",
        "total_records": int(count),
        "listed_payment_amount": Decimal(str(listed_amount)),
        "paid_records": int(paid_count),
        "paid_collections": Decimal(str(paid_amount)),
        "review_records": int(review_count or 0),
    }


@router.get("/buyer-payments")
def buyer_payments(
    db: DB,
    admin: Admin,
    buyer_id: Annotated[int | None, Query(gt=0)] = None,
    order_id: Annotated[int | None, Query(gt=0)] = None,
    payment_status: PaymentStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_basis: DateBasis = "created_at",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    filtered = (
        select(OrderPayment.id.label("id"))
        .join(Order, Order.id == OrderPayment.order_id)
    )

    if buyer_id is not None:
        filtered = filtered.where(
            Order.buyer_id == buyer_id
        )

    if order_id is not None:
        filtered = filtered.where(
            OrderPayment.order_id == order_id
        )

    if payment_status is not None:
        filtered = filtered.where(
            OrderPayment.status == payment_status
        )

    date_column = (
        OrderPayment.paid_at
        if date_basis == "paid_at"
        else OrderPayment.created_at
    )

    filtered = apply_dates(
        filtered,
        date_column,
        date_from,
        date_to,
    )

    summary = payment_summary(
        db, OrderPayment, filtered
    )

    matching = filtered.subquery()

    rows = db.execute(
        select(OrderPayment, Order, User)
        .join(Order, Order.id == OrderPayment.order_id)
        .join(User, User.id == Order.buyer_id)
        .join(
            matching,
            matching.c.id == OrderPayment.id,
        )
        .order_by(OrderPayment.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return {
        **summary,
        "date_basis": date_basis,
        "date_timezone": "Asia/Colombo",
        "items": [
            {
                **payment_data(payment),
                "order_id": order.id,
                "order_status": order.status,
                "buyer_id": buyer.id,
                "buyer_name": buyer.name,
                "details_path": (
                    "/admin/finance/buyer-payments/"
                    f"{payment.id}"
                ),
            }
            for payment, order, buyer in rows
        ],
    }


@router.get("/buyer-payments/{payment_id}")
def buyer_payment_details(
    payment_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
):
    row = db.execute(
        select(OrderPayment, Order, User)
        .join(Order, Order.id == OrderPayment.order_id)
        .join(User, User.id == Order.buyer_id)
        .where(OrderPayment.id == payment_id)
    ).first()

    if row is None:
        raise HTTPException(
            404,
            "Buyer payment not found.",
        )

    payment, order, buyer = row

    items = db.scalars(
        select(OrderItem)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id)
    ).all()

    return {
        **payment_data(payment),
        "buyer_id": buyer.id,
        "buyer_name": buyer.name,
        "order_id": order.id,
        "order_status": order.status,
        "order_total": order.total_amount,
        "recipient_name": order.recipient_name,
        "phone": order.phone,
        "delivery_address": order.delivery_address,
        "order_items": [
            {
                "stock_id": item.stock_id,
                "variety_name": item.variety_name,
                "quantity_kg": item.quantity_kg,
                "unit_price": item.unit_price,
                "line_total": item.line_total,
            }
            for item in items
        ],
    }


@router.get("/subscription-payments")
def subscription_payments(
    db: DB,
    admin: Admin,
    farmer_id: Annotated[int | None, Query(gt=0)] = None,
    payment_method: PaymentMethod | None = None,
    payment_status: PaymentStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_basis: DateBasis = "created_at",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    filtered = (
        select(
            FarmerSubscriptionPayment.id.label("id")
        )
        .join(
            FarmerSubscription,
            FarmerSubscription.id
            == FarmerSubscriptionPayment.subscription_id,
        )
    )

    if farmer_id is not None:
        filtered = filtered.where(
            FarmerSubscription.farmer_id == farmer_id
        )

    if payment_method is not None:
        filtered = filtered.where(
            FarmerSubscriptionPayment.provider
            == payment_method
        )

    if payment_status is not None:
        filtered = filtered.where(
            FarmerSubscriptionPayment.status
            == payment_status
        )

    date_column = (
        FarmerSubscriptionPayment.paid_at
        if date_basis == "paid_at"
        else FarmerSubscriptionPayment.created_at
    )

    filtered = apply_dates(
        filtered,
        date_column,
        date_from,
        date_to,
    )

    summary = payment_summary(
        db,
        FarmerSubscriptionPayment,
        filtered,
    )

    matching = filtered.subquery()

    rows = db.execute(
        select(
            FarmerSubscriptionPayment,
            FarmerSubscription,
            User,
        )
        .join(
            FarmerSubscription,
            FarmerSubscription.id
            == FarmerSubscriptionPayment.subscription_id,
        )
        .join(
            User,
            User.id == FarmerSubscription.farmer_id,
        )
        .join(
            matching,
            matching.c.id == FarmerSubscriptionPayment.id,
        )
        .order_by(FarmerSubscriptionPayment.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return {
        **summary,
        "date_basis": date_basis,
        "date_timezone": "Asia/Colombo",
        "items": [
            {
                **payment_data(payment),
                "subscription_id": subscription.id,
                "farmer_id": farmer.id,
                "farmer_name": farmer.name,
                "plan_name": subscription.plan_name,
                "subscription_status": (
                    subscription.effective_status
                ),
                "starts_at": as_utc(subscription.starts_at),
                "ends_at": as_utc(subscription.ends_at),
                "details_path": (
                    "/admin/finance/subscription-payments/"
                    f"{payment.id}"
                ),
            }
            for payment, subscription, farmer in rows
        ],
    }


@router.get("/subscription-payments/{payment_id}")
def subscription_payment_details(
    payment_id: Annotated[int, Path(gt=0)],
    db: DB,
    admin: Admin,
):
    row = db.execute(
        select(
            FarmerSubscriptionPayment,
            FarmerSubscription,
            User,
        )
        .join(
            FarmerSubscription,
            FarmerSubscription.id
            == FarmerSubscriptionPayment.subscription_id,
        )
        .join(
            User,
            User.id == FarmerSubscription.farmer_id,
        )
        .where(
            FarmerSubscriptionPayment.id == payment_id
        )
    ).first()

    if row is None:
        raise HTTPException(
            404,
            "Subscription payment not found.",
        )

    payment, subscription, farmer = row

    return {
        **payment_data(payment),
        "subscription_id": subscription.id,
        "farmer_id": farmer.id,
        "farmer_name": farmer.name,
        "plan_id": subscription.plan_id,
        "plan_name": subscription.plan_name,
        "duration_months": subscription.duration_months,
        "subscription_status": subscription.effective_status,
        "has_access": subscription.has_access,
        "starts_at": as_utc(subscription.starts_at),
        "ends_at": as_utc(subscription.ends_at),
        "cash_receipt_details_path": (
            "/admin/cash-subscriptions"
            f"?farmer_id={farmer.id}"
            if payment.provider == "cash"
            else None
        ),
    }