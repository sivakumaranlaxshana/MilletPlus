from __future__ import annotations

import logging
import re
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.user import User
from app.models.farmer_subscription import FarmerSubscription, FarmerSubscriptionPayment
from app.services.farmer_subscriptions import lock_farmer, apply_subscription_notification
from app.services.payhere_gateway import (
    SANDBOX_CHECKOUT_URL, Settings, checkout_hash, configured_url,
    notification_amount, valid_notification_signature,
)


router = APIRouter(tags=["Farmer Subscription PayHere"])
DB = Annotated[Session, Depends(get_db)]
Farmer = Annotated[User, Depends(require_roles("farmer"))]
Admin = Annotated[User, Depends(require_roles("admin"))]
PositiveID = Annotated[int, Path(gt=0)]
REFERENCE = re.compile(r"MP-SUB-([1-9][0-9]*)-([a-f0-9]{32})")
logger = logging.getLogger(__name__)


class SubscriptionCheckoutCustomer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    address: str = Field(min_length=5, max_length=500)
    city: str = Field(min_length=1, max_length=100)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid checkout email.")
        return value


class SubscriptionCheckoutResponse(BaseModel):
    subscription_id: int
    payment_id: int
    sandbox: bool
    method: str
    action_url: str
    fields: dict[str, str]


def locked_subscriptions(db: Session, farmer_id: int) -> list[FarmerSubscription]:
    return list(db.scalars(
        select(FarmerSubscription).where(FarmerSubscription.farmer_id == farmer_id)
        .order_by(FarmerSubscription.id).with_for_update()
        .execution_options(populate_existing=True)
    ).all())


@router.post("/farmer/subscriptions/{subscription_id}/checkout", response_model=SubscriptionCheckoutResponse)
def subscription_checkout(subscription_id: PositiveID, data: SubscriptionCheckoutCustomer,
                          db: DB, user: Farmer):
    settings = Settings.load()
    backend = configured_url("PAYHERE_PUBLIC_BACKEND_URL", public=True)
    frontend = configured_url("FRONTEND_URL", "http://localhost:5173")
    try:
        farmer = lock_farmer(db, user.id)
        rows = locked_subscriptions(db, farmer.id)
        subscription = next((row for row in rows if row.id == subscription_id), None)
        if subscription is None:
            raise HTTPException(404, "Subscription not found.")
        payment = db.scalar(
            select(FarmerSubscriptionPayment).where(
                FarmerSubscriptionPayment.subscription_id == subscription.id,
            ).with_for_update().execution_options(populate_existing=True)
        )
        if payment is None:
            raise HTTPException(409, "Subscription payment record is missing.")
        if not farmer.is_active or farmer.role != "farmer":
            raise HTTPException(403, "Active farmer account required.")
        if subscription.status != "pending" or payment.status != "pending":
            raise HTTPException(409, "Only pending subscriptions and payments can open checkout.")
        if (payment.provider != "payhere" or payment.currency != "LKR"
                or payment.currency != subscription.currency or payment.amount != subscription.amount):
            raise HTTPException(409, "Payment does not match the subscription.")
        if payment.requires_review or payment.provider_payment_id:
            raise HTTPException(409, "Payment is processing or requires review. Check subscription history.")
        if any(row.id != subscription.id and (row.status == "pending" or row.effective_status == "active") for row in rows):
            raise HTTPException(409, "Another pending or active subscription requires review.")
        if not farmer.phone:
            raise HTTPException(422, "Save your phone number in your profile first.")
        if subscription.duration_months < 1 or subscription.duration_months > 120:
            raise HTTPException(409, "Subscription duration requires administrator review.")
        if payment.checkout_reference is None:
            payment.checkout_reference = f"MP-SUB-{payment.id}-{uuid4().hex}"
        reference = payment.checkout_reference
        match = REFERENCE.fullmatch(reference)
        if match is None or int(match.group(1)) != payment.id:
            raise HTTPException(409, "Existing checkout reference requires administrator review.")
        fields = {
            "merchant_id": settings.merchant_id,
            "return_url": f"{frontend}/farmer/dashboard?subscription_payment=return&subscription_id={subscription.id}",
            "cancel_url": f"{frontend}/farmer/dashboard?subscription_payment=cancel&subscription_id={subscription.id}",
            "notify_url": f"{backend}/payhere/subscriptions/notify",
            "first_name": data.first_name, "last_name": data.last_name,
            "email": data.email, "phone": farmer.phone, "address": data.address,
            "city": data.city, "country": "Sri Lanka",
            "order_id": reference,
            "items": f"Millet Plus farmer plan #{subscription.id}",
            "currency": payment.currency, "amount": format(payment.amount, ".2f"),
            "hash": checkout_hash(settings.merchant_id, reference, payment.amount, payment.currency, settings.secret),
        }
        # This is a single prepaid term, not automatic recurring card charging.
        db.commit()
        return SubscriptionCheckoutResponse(subscription_id=subscription.id, payment_id=payment.id,
                                            sandbox=True, method="POST", action_url=SANDBOX_CHECKOUT_URL, fields=fields)
    except Exception:
        db.rollback()
        raise


@router.post("/payhere/subscriptions/notify")
def subscription_notification(
    db: DB,
    merchant_id: Annotated[str, Form(max_length=40)],
    order_id: Annotated[str, Form(max_length=255)],
    payment_id: Annotated[str, Form(min_length=1, max_length=100)],
    payhere_amount: Annotated[str, Form(max_length=40)],
    payhere_currency: Annotated[str, Form(max_length=3)],
    status_code: Annotated[str, Form(max_length=3)],
    md5sig: Annotated[str, Form(max_length=32)],
):
    settings = Settings.load()
    values = dict(merchant_id=merchant_id, order_id=order_id, payment_id=payment_id,
                  payhere_amount=payhere_amount, payhere_currency=payhere_currency,
                  status_code=status_code, md5sig=md5sig)
    if not valid_notification_signature(values, settings.merchant_id, settings.secret):
        raise HTTPException(400, "Invalid subscription payment signature.")
    if status_code not in ("2", "0", "-1", "-2", "-3"):
        raise HTTPException(400, "Unsupported payment status.")
    match = REFERENCE.fullmatch(order_id)
    if match is None:
        raise HTTPException(400, "Invalid subscription checkout reference.")
    amount = notification_amount(payhere_amount)
    try:
        # Find the owner without locking, then lock User -> Subscriptions -> Payment.
        owner_id = db.scalar(
            select(FarmerSubscription.farmer_id).join(
                FarmerSubscriptionPayment,
                FarmerSubscriptionPayment.subscription_id == FarmerSubscription.id,
            ).where(FarmerSubscriptionPayment.id == int(match.group(1)))
        )
        if owner_id is None:
            raise HTTPException(404, "Subscription payment not found.")
        farmer = lock_farmer(db, owner_id)
        subscriptions = locked_subscriptions(db, farmer.id)
        payment = db.scalar(
            select(FarmerSubscriptionPayment).where(FarmerSubscriptionPayment.id == int(match.group(1)))
            .with_for_update().execution_options(populate_existing=True)
        )
        if payment is None or payment.checkout_reference != order_id:
            raise HTTPException(404, "Subscription checkout not found.")
        subscription = next((row for row in subscriptions if row.id == payment.subscription_id), None)
        if subscription is None:
            raise HTTPException(404, "Subscription not found.")
        if (payment.provider != "payhere" or payhere_currency != "LKR"
                or payment.currency != payhere_currency or subscription.currency != payhere_currency
                or payment.amount != amount or subscription.amount != amount):
            raise HTTPException(400, "Subscription amount, currency or provider mismatch.")
        if not 1 <= subscription.duration_months <= 120:
            raise HTTPException(409, "Subscription duration requires administrator review.")
        apply_subscription_notification(subscription, payment, farmer, status_code, payment_id,
                                        [row for row in subscriptions if row.id != subscription.id])
        review = payment.requires_review
        db.flush()
        db.commit()
        if review:
            logger.warning("Subscription payment %s requires administrator review", payment.id)
        return {"received": True, "requires_review": review}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Subscription provider payment ID conflict; administrator review required.") from None
    except Exception:
        db.rollback()
        raise


@router.get("/farmer/subscription-access")
def subscription_access(db: DB, user: Farmer):
    rows = db.scalars(
        select(FarmerSubscription).where(
            FarmerSubscription.farmer_id == user.id, FarmerSubscription.status == "active",
        ).order_by(FarmerSubscription.id.desc())
    ).all()
    subscription = next((row for row in rows if row.has_access), None)
    return {
        "has_access": bool(subscription),
        "subscription_id": subscription.id if subscription else None,
        "starts_at": subscription.starts_at if subscription else None,
        "ends_at": subscription.ends_at if subscription else None,
    }


@router.get("/admin/farmer-subscription-payments/{payment_id}/gateway-status")
def admin_subscription_gateway_status(payment_id: PositiveID, db: DB, user: Admin):
    payment = db.get(FarmerSubscriptionPayment, payment_id)
    if payment is None:
        raise HTTPException(404, "Subscription payment not found.")
    return {
        "payment_id": payment.id, "subscription_id": payment.subscription_id,
        "status": payment.status, "gateway_status_code": payment.gateway_status_code,
        "requires_review": payment.requires_review, "provider_payment_id": payment.provider_payment_id,
        "paid_at": payment.paid_at, "closed_at": payment.closed_at,
    }
