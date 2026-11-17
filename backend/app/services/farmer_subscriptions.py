from calendar import monthrange
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.farmer_subscription import (
    FarmerSubscriptionPlan, FarmerSubscription, FarmerSubscriptionPayment, utc_now,
)
from app.schemas.farmer_subscription import SubscriptionCreate


PLAN_CODE = "FARMER_MONTHLY_500"


def initialize_monthly_plan(db: Session) -> FarmerSubscriptionPlan:
    statement = select(FarmerSubscriptionPlan).where(FarmerSubscriptionPlan.code == PLAN_CODE)
    plan = db.scalar(statement)
    if plan is not None:
        return plan
    plan = FarmerSubscriptionPlan(
        code=PLAN_CODE, name="Farmer Monthly", amount=Decimal("500.00"),
        currency="LKR", duration_months=1, is_active=True,
    )
    try:
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan
    except IntegrityError:
        db.rollback()
        plan = db.scalar(statement)
        if plan is None:
            raise HTTPException(409, "Could not initialize the subscription plan.") from None
        return plan


def lock_farmer(db: Session, farmer_id: int) -> User:
    # All create/cancel/checkout/callback paths lock this parent first.
    user = db.scalar(
        select(User).where(User.id == farmer_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise HTTPException(404, "Farmer not found.")
    return user


def create_subscription(db: Session, farmer_id: int, data: SubscriptionCreate) -> FarmerSubscription:
    lock_farmer(db, farmer_id)
    previous = db.scalar(select(FarmerSubscription).where(
        FarmerSubscription.farmer_id == farmer_id,
        FarmerSubscription.request_key == str(data.request_key),
    ))
    if previous is not None:
        if previous.plan_id != data.plan_id:
            raise HTTPException(409, "This request key was already used with another plan.")
        return previous
    rows = db.scalars(
        select(FarmerSubscription).where(
            FarmerSubscription.farmer_id == farmer_id,
            FarmerSubscription.status.in_(["pending", "active"]),
        ).order_by(FarmerSubscription.id).with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    now = utc_now()
    for row in rows:
        if row.status == "active" and row.ends_at is not None and row.ends_at <= now:
            row.status = "expired"
        else:
            raise HTTPException(409, "You already have a pending or active subscription. View your subscription history.")
    plan = db.scalar(
        select(FarmerSubscriptionPlan).where(FarmerSubscriptionPlan.id == data.plan_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if plan is None or not plan.is_active:
        raise HTTPException(404, "Subscription plan is not available.")
    subscription = FarmerSubscription(
        farmer_id=farmer_id, plan_id=plan.id, request_key=str(data.request_key),
        plan_name=plan.name, amount=plan.amount, currency=plan.currency,
        duration_months=plan.duration_months, status="pending",
    )
    subscription.payment = FarmerSubscriptionPayment(
        provider="payhere", amount=plan.amount, currency=plan.currency, status="pending",
    )
    db.add(subscription)
    db.flush()
    db.refresh(subscription)
    return subscription


def cancel_subscription(db: Session, farmer_id: int, subscription_id: int) -> FarmerSubscription:
    lock_farmer(db, farmer_id)
    subscription = db.scalar(
        select(FarmerSubscription).where(
            FarmerSubscription.id == subscription_id, FarmerSubscription.farmer_id == farmer_id,
        ).with_for_update().execution_options(populate_existing=True)
    )
    if subscription is None:
        raise HTTPException(404, "Subscription not found.")
    if subscription.status == "cancelled":
        return subscription
    if subscription.status != "pending":
        raise HTTPException(409, "Only pending subscription requests can be cancelled here.")
    payment = db.scalar(
        select(FarmerSubscriptionPayment).where(FarmerSubscriptionPayment.subscription_id == subscription.id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if payment is None:
        raise HTTPException(409, "Subscription payment record is missing.")
    if payment.requires_review or payment.status in {"paid", "refunded"}:
        raise HTTPException(409, "This payment requires the gateway refund/cancellation flow.")
    if payment.status == "pending" and payment.checkout_reference is not None:
        raise HTTPException(409, "A gateway checkout is pending. Reconcile it before cancellation.")
    now = utc_now()
    if payment.status == "pending":
        payment.status = "cancelled"
        payment.closed_at = now
    subscription.status = "cancelled"
    subscription.cancelled_at = now
    db.flush()
    return subscription


def add_calendar_months(value: datetime, months: int) -> datetime:
    if months < 1:
        raise HTTPException(409, "Invalid subscription duration.")
    total = value.year * 12 + value.month - 1 + months
    year, zero_based_month = divmod(total, 12)
    if not 1 <= year <= 9999:
        raise HTTPException(409, "Subscription duration is out of range.")
    month = zero_based_month + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def apply_subscription_notification(subscription, payment, farmer, code: str,
                                    provider_id: str, other_open: list) -> None:
    """Call only after signature/amount verification and farmer/subscription/payment locks."""
    now = utc_now()
    if payment.provider_payment_id and payment.provider_payment_id != provider_id:
        payment.requires_review = True
        return
    if code == "0":
        if payment.status == "pending":
            payment.provider_payment_id = provider_id
            payment.gateway_status_code = code
        return
    if code == "-3":
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "failed"
        payment.closed_at = payment.closed_at or now
        payment.requires_review = True
        subscription.status = "cancelled"
        subscription.cancelled_at = subscription.cancelled_at or now
        return
    if code == "2":
        if payment.gateway_status_code == "-3" or payment.status == "refunded":
            payment.requires_review = True
            return
        already_paid = payment.status == "paid"
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "paid"
        payment.paid_at = payment.paid_at or now
        payment.closed_at = payment.closed_at or now
        # Duplicate callbacks NEVER restart or extend the paid term.
        if already_paid:
            return
        conflict = any(
            row.status == "pending" or (
                row.status == "active" and (row.ends_at is None or row.ends_at > now)
            ) for row in other_open
        )
        if (subscription.status != "pending" or subscription.starts_at is not None
                or subscription.ends_at is not None or payment.requires_review or conflict
                or not farmer.is_active or farmer.role != "farmer"):
            payment.requires_review = True
            return
        subscription.starts_at = now
        subscription.ends_at = add_calendar_months(now, subscription.duration_months)
        subscription.status = "active"
        return
    # Ignore stale failure/cancel events after a paid/chargeback/refunded result.
    if payment.status == "pending":
        payment.provider_payment_id = provider_id
        payment.gateway_status_code = code
        payment.status = "cancelled" if code == "-1" else "failed"
        payment.closed_at = now
        if subscription.status == "pending":
            subscription.status = "cancelled"
            subscription.cancelled_at = now
