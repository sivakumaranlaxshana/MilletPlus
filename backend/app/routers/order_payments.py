from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles

from app.models.order import Order
from app.models.order_payment import OrderPayment
from app.models.user import User

from app.schemas.order_payment import (
    OrderPaymentCreate,
    OrderPaymentResponse,
)
from app.services.order_payments import payment_rows


router = APIRouter(
    tags=["Order Payments"],
)

DB = Annotated[
    Session,
    Depends(get_db),
]

Buyer = Annotated[
    User,
    Depends(require_roles("buyer")),
]

Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]

OrderID = Annotated[
    int,
    Path(gt=0),
]


def owned_order(
    db: Session,
    order_id: int,
    buyer_id: int,
    *,
    lock=False,
) -> Order:
    statement = select(Order).where(
        Order.id == order_id,
        Order.buyer_id == buyer_id,
    )

    if lock:
        statement = (
            statement
            .with_for_update()
            .execution_options(
                populate_existing=True,
            )
        )

    order = db.scalar(statement)

    if order is None:
        raise HTTPException(
            status_code=404,
            detail="Order not found.",
        )

    return order


@router.post(
    "/orders/{order_id}/payments",
    response_model=OrderPaymentResponse,
)
def create_payment_record(
    order_id: OrderID,
    data: OrderPaymentCreate,
    db: DB,
    user: Buyer,
):
    """
    Creates a local pending payment record.

    No card is charged.
    No payment gateway request is made.
    """
    try:
        order = owned_order(
            db,
            order_id,
            user.id,
            lock=True,
        )

        rows = payment_rows(
            db,
            order.id,
        )

        key = str(data.request_key)

        previous = next(
            (
                row
                for row in rows
                if row.request_key == key
            ),
            None,
        )

        # Retrying the same request returns the
        # original payment instead of duplicating it.
        if previous is not None:
            result = OrderPaymentResponse.model_validate(
                previous
            )

            db.commit()
            return result

        if order.status != "pending":
            raise HTTPException(
                status_code=409,
                detail=(
                    "Only pending orders "
                    "can start a payment."
                ),
            )

        if any(
            row.status == "paid"
            for row in rows
        ):
            raise HTTPException(
                status_code=409,
                detail="This order is already paid.",
            )

        if any(
            row.status == "pending"
            for row in rows
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "A pending payment record already exists. "
                    "Use its original request key "
                    "or view payment history."
                ),
            )

        payment = OrderPayment(
            order_id=order.id,
            request_key=key,
            provider="payhere",
            currency="LKR",
            amount=order.total_amount,
            status="pending",
        )

        db.add(payment)
        db.flush()
        db.refresh(payment)

        result = OrderPaymentResponse.model_validate(
            payment
        )

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "Payment record conflict. "
                "Refresh payment history."
            ),
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get(
    "/orders/{order_id}/payments",
    response_model=list[OrderPaymentResponse],
)
def buyer_payment_history(
    order_id: OrderID,
    db: DB,
    user: Buyer,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
):
    owned_order(
        db,
        order_id,
        user.id,
    )

    statement = (
        select(OrderPayment)
        .where(
            OrderPayment.order_id == order_id
        )
        .order_by(
            OrderPayment.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )

    rows = db.scalars(statement).all()

    return [
        OrderPaymentResponse.model_validate(row)
        for row in rows
    ]


@router.get(
    "/admin/order-payments",
    response_model=list[OrderPaymentResponse],
)
def admin_payment_history(
    db: DB,
    user: Admin,
    order_id: Annotated[
        int | None,
        Query(gt=0),
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
):
    statement = select(OrderPayment)

    if order_id is not None:
        statement = statement.where(
            OrderPayment.order_id == order_id
        )

    statement = (
        statement
        .order_by(
            OrderPayment.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )

    rows = db.scalars(statement).all()

    return [
        OrderPaymentResponse.model_validate(row)
        for row in rows
    ]