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
from app.models.order import Order
from app.models.order_payment import OrderPayment
from app.models.user import User
from app.services.payhere_gateway import (
    REFERENCE_PATTERN, SANDBOX_CHECKOUT_URL, Settings, apply_notification,
    checkout_hash, configured_url, notification_amount, valid_notification_signature,
)


router = APIRouter(tags=["PayHere Sandbox"])
DB = Annotated[Session, Depends(get_db)]
Buyer = Annotated[User, Depends(require_roles("buyer"))]
Admin = Annotated[User, Depends(require_roles("admin"))]
PositiveID = Annotated[int, Path(gt=0)]
logger = logging.getLogger(__name__)


class CheckoutCustomer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    city: str = Field(min_length=1, max_length=100)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid checkout email.")
        return value


class CheckoutResponse(BaseModel):
    payment_id: int
    order_id: int
    sandbox: bool
    method: str
    action_url: str
    fields: dict[str, str]


def locked_payments(db: Session, order_id: int) -> list[OrderPayment]:
    return list(db.scalars(
        select(OrderPayment).where(OrderPayment.order_id == order_id)
        .order_by(OrderPayment.id).with_for_update()
        .execution_options(populate_existing=True)
    ).all())


@router.post(
    "/orders/{order_id}/payments/{payment_id}/checkout",
    response_model=CheckoutResponse,
)
def create_checkout(order_id: PositiveID, payment_id: PositiveID, data: CheckoutCustomer, db: DB, user: Buyer):
    settings = Settings.load()
    backend_url = configured_url("PAYHERE_PUBLIC_BACKEND_URL", public=True)
    frontend_url = configured_url("FRONTEND_URL", "http://localhost:5173")
    try:
        order = db.scalar(
            select(Order).where(Order.id == order_id, Order.buyer_id == user.id)
            .with_for_update().execution_options(populate_existing=True)
        )
        if order is None:
            raise HTTPException(404, "Order not found.")
        rows = locked_payments(db, order.id)
        payment = next((row for row in rows if row.id == payment_id), None)
        if payment is None:
            raise HTTPException(404, "Payment not found.")
        if order.status != "pending" or payment.status != "pending":
            raise HTTPException(409, "Only a pending order and pending payment can open checkout.")
        if payment.provider != "payhere" or payment.currency != "LKR" or payment.amount != order.total_amount:
            raise HTTPException(409, "Payment does not match the order.")
        if any(row.status == "paid" for row in rows):
            raise HTTPException(409, "This order already has a paid payment.")
        if payment.requires_review or payment.provider_payment_id:
            raise HTTPException(409, "Payment is already processing or requires review. Refresh history.")
        if not order.phone or not order.delivery_address:
            raise HTTPException(422, "Order phone and delivery address are required.")
        if payment.checkout_reference is None:
            payment.checkout_reference = f"MP-PAY-{payment.id}-{uuid4().hex}"
        reference = payment.checkout_reference
        match = REFERENCE_PATTERN.fullmatch(reference)
        if match is None or int(match.group(1)) != payment.id:
            raise HTTPException(409, "Existing checkout reference requires administrator review.")
        fields = {
            "merchant_id": settings.merchant_id,
            "return_url": f"{frontend_url}/buyer/dashboard?payment=return&order_id={order.id}",
            "cancel_url": f"{frontend_url}/buyer/dashboard?payment=cancel&order_id={order.id}",
            "notify_url": f"{backend_url}/payhere/notify",
            "first_name": data.first_name,
            "last_name": data.last_name,
            "email": data.email,
            "phone": order.phone,
            "address": order.delivery_address,
            "city": data.city,
            "country": "Sri Lanka",
            "order_id": reference,
            "items": f"Millet Plus order #{order.id}",
            "currency": payment.currency,
            "amount": format(payment.amount, ".2f"),
            "hash": checkout_hash(settings.merchant_id, reference, payment.amount, payment.currency, settings.secret),
        }
        db.commit()
        return CheckoutResponse(payment_id=payment.id, order_id=order.id, sandbox=True,
                                method="POST", action_url=SANDBOX_CHECKOUT_URL, fields=fields)
    except Exception:
        db.rollback()
        raise


@router.post("/payhere/notify")
def payment_notification(
    db: DB,
    merchant_id: Annotated[str, Form(max_length=40)],
    order_id: Annotated[str, Form(max_length=255)],
    payment_id: Annotated[str, Form(min_length=1, max_length=100)],
    payhere_amount: Annotated[str, Form(max_length=40)],
    payhere_currency: Annotated[str, Form(max_length=3)],
    status_code: Annotated[str, Form(max_length=3)],
    md5sig: Annotated[str, Form(max_length=32)],
):
    # Public callback: no buyer JWT. The PayHere signature authenticates it.
    settings = Settings.load()
    values = dict(merchant_id=merchant_id, order_id=order_id, payment_id=payment_id,
                  payhere_amount=payhere_amount, payhere_currency=payhere_currency,
                  status_code=status_code, md5sig=md5sig)
    if not valid_notification_signature(values, settings.merchant_id, settings.secret):
        raise HTTPException(400, "Invalid payment notification signature.")
    if status_code not in ("2", "0", "-1", "-2", "-3"):
        raise HTTPException(400, "Unsupported payment status.")
    match = REFERENCE_PATTERN.fullmatch(order_id)
    if match is None:
        raise HTTPException(400, "Invalid checkout reference.")
    amount = notification_amount(payhere_amount)
    try:
        # Discover the parent, then use the same lock order as checkout/create.
        parent_id = db.scalar(select(OrderPayment.order_id).where(OrderPayment.id == int(match.group(1))))
        if parent_id is None:
            raise HTTPException(404, "Payment not found.")
        order = db.scalar(select(Order).where(Order.id == parent_id).with_for_update()
                          .execution_options(populate_existing=True))
        if order is None:
            raise HTTPException(404, "Order not found.")
        rows = locked_payments(db, order.id)
        payment = next((row for row in rows if row.id == int(match.group(1))), None)
        if payment is None or payment.checkout_reference != order_id:
            raise HTTPException(404, "Checkout not found.")
        if (payment.provider != "payhere" or payment.currency != payhere_currency
                or payment.amount != amount or order.total_amount != amount):
            raise HTTPException(400, "Payment amount, currency or provider mismatch.")
        other_paid = [row for row in rows if row.id != payment.id and row.status == "paid"]
        apply_notification(payment, order, status_code, payment_id, other_paid)
        needs_review = payment.requires_review
        db.commit()
        if needs_review:
            logger.warning("PayHere payment %s on order %s requires admin review", payment.id, order.id)
        return {"received": True, "requires_review": needs_review}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Provider payment ID conflict; administrator review required.") from None
    except Exception:
        db.rollback()
        raise


@router.get("/admin/order-payments/{payment_id}/gateway-status")
def admin_gateway_status(payment_id: PositiveID, db: DB, user: Admin):
    payment = db.get(OrderPayment, payment_id)
    if payment is None:
        raise HTTPException(404, "Payment not found.")
    return {
        "payment_id": payment.id, "order_id": payment.order_id, "status": payment.status,
        "gateway_status_code": payment.gateway_status_code,
        "requires_review": payment.requires_review,
        "provider_payment_id": payment.provider_payment_id,
        "paid_at": payment.paid_at, "closed_at": payment.closed_at,
    }
