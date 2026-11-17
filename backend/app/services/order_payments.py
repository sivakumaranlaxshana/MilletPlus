from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.order_payment import OrderPayment


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def payment_rows(
    db: Session,
    order_id: int,
) -> list[OrderPayment]:
    # Caller must lock the Order before locking its payments.
    statement = (
        select(OrderPayment)
        .where(OrderPayment.order_id == order_id)
        .order_by(OrderPayment.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    return list(db.scalars(statement).all())


def require_paid_payment(
    db: Session,
    order: Order,
) -> None:
    rows = payment_rows(db, order.id)

    if any(row.requires_review for row in rows):
        raise HTTPException(
            409,
            "A payment requires administrator review. "
            "Resolve it before completing this order.",
        )

    # Another submitted checkout could still produce
    # a second payment. Resolve it before fulfillment.
    if any(
        row.status == "pending"
        and row.checkout_reference is not None
        for row in rows
    ):
        raise HTTPException(
            409,
            "A gateway checkout is still pending. "
            "Reconcile it before completing this order.",
        )

    paid = [
        row
        for row in rows
        if row.status == "paid"
    ]

    if len(paid) != 1:
        raise HTTPException(
            409,
            "Exactly one verified full payment is required "
            "before completing this order.",
        )

    payment = paid[0]

    if (
        payment.provider != "payhere"
        or payment.currency != "LKR"
        or payment.amount != order.total_amount
        or not payment.provider_payment_id
        or payment.paid_at is None
        or payment.gateway_status_code != "2"
    ):
        raise HTTPException(
            409,
            "A verified full PayHere payment matching "
            "the order amount is required before completion.",
        )


def prepare_order_cancellation(
    db: Session,
    order: Order,
) -> None:
    rows = payment_rows(db, order.id)

    if any(row.requires_review for row in rows):
        raise HTTPException(
            409,
            "A payment requires administrator review. "
            "Resolve it before cancelling this order.",
        )

    if any(row.status == "paid" for row in rows):
        raise HTTPException(
            409,
            "This order has a paid payment. "
            "A verified refund is required before cancellation.",
        )

    if any(
        row.status == "pending"
        and row.checkout_reference is not None
        for row in rows
    ):
        raise HTTPException(
            409,
            "A gateway checkout is still pending. "
            "Reconcile it before cancelling this order.",
        )

    # Cancel only unsubmitted local pending payments.
    # Caller commits alongside cancellation and stock release.
    now = utc_now()

    for row in rows:
        if row.status == "pending":
            row.status = "cancelled"
            row.closed_at = now