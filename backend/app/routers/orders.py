import hashlib
import json

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.dependencies import require_roles

from app.models.order import Order, OrderItem
from app.models.stock import HarvestStock, StockMovement
from app.models.user import User

from app.schemas.order import (
    OrderCreate,
    OrderResponse,
    OrderStatusUpdate,
)

from app.services.order_payments import (
    prepare_order_cancellation,
    require_paid_payment,
)


router = APIRouter(tags=["Orders"])

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


def conflict(message):
    raise HTTPException(
        status_code=409,
        detail=message,
    )


def response(order):
    return OrderResponse.model_validate(order)


def fingerprint(data):
    payload = {
        "recipient_name": data.recipient_name,
        "phone": data.phone,
        "delivery_address": data.delivery_address,
        "items": [
            [
                line.stock_id,
                format(line.quantity_kg, ".2f"),
                format(line.expected_unit_price, ".2f"),
            ]
            for line in sorted(
                data.items,
                key=lambda item: item.stock_id,
            )
        ],
    }

    encoded = json.dumps(
        payload,
        sort_keys=True,
    ).encode()

    return hashlib.sha256(encoded).hexdigest()


def previous_order(db, buyer_id, key, digest):
    order = db.scalar(
        select(Order).where(
            Order.buyer_id == buyer_id,
            Order.request_key == key,
        )
    )

    if (
        order is not None
        and order.request_hash != digest
    ):
        conflict(
            "This request key was already used "
            "with different order details."
        )

    return order


def lock_stocks(db, ids):
    result = {}

    # Always lock stock rows in a consistent order.
    for stock_id in sorted(ids):
        stock = db.scalar(
            select(HarvestStock)
            .where(HarvestStock.id == stock_id)
            .with_for_update()
            .execution_options(
                populate_existing=True,
            )
        )

        if stock is None:
            conflict(
                "One or more stock items "
                "are no longer available."
            )

        result[stock_id] = stock

    return result


@router.post(
    "/orders",
    response_model=OrderResponse,
    status_code=201,
)
def place_order(
    data: OrderCreate,
    db: DB,
    user: Buyer,
):
    key = str(data.request_key)
    digest = fingerprint(data)

    try:
        previous = previous_order(
            db,
            user.id,
            key,
            digest,
        )

        if previous is not None:
            return response(previous)

        order = Order(
            buyer_id=user.id,
            request_key=key,
            request_hash=digest,
            recipient_name=data.recipient_name,
            phone=data.phone,
            delivery_address=data.delivery_address,
            total_amount=Decimal("0.01"),
            status="pending",
        )

        db.add(order)
        db.flush()

        stocks = lock_stocks(
            db,
            [line.stock_id for line in data.items],
        )

        total = Decimal("0.00")

        for line in sorted(
            data.items,
            key=lambda item: item.stock_id,
        ):
            stock = stocks[line.stock_id]

            if (
                not stock.is_active
                or stock.harvest.status != "approved"
                or stock.selling_price_per_kg is None
            ):
                conflict(
                    "One or more stock items "
                    "are no longer available."
                )

            if (
                stock.selling_price_per_kg
                != line.expected_unit_price
            ):
                conflict(
                    "Price changed. Refresh stock "
                    "and review your cart."
                )

            if (
                stock.available_quantity
                < line.quantity_kg
            ):
                conflict(
                    "Not enough available stock. "
                    "Refresh and reduce the quantity."
                )

            price = stock.selling_price_per_kg

            line_total = (
                price * line.quantity_kg
            ).quantize(
                Decimal("0.01")
            )

            total += line_total

            stock.reserved_quantity += line.quantity_kg

            order.items.append(
                OrderItem(
                    stock_id=stock.id,
                    variety_name=(
                        stock.harvest
                        .crop_cycle
                        .variety
                        .name
                    ),
                    quantity_kg=line.quantity_kg,
                    unit_price=price,
                    line_total=line_total,
                )
            )

        order.total_amount = total

        db.flush()

        result = response(order)

        db.commit()
        return result

    except IntegrityError:
        db.rollback()

        previous = previous_order(
            db,
            user.id,
            key,
            digest,
        )

        if previous is not None:
            return response(previous)

        conflict(
            "Order could not be saved. "
            "Refresh and try again."
        )

    except Exception:
        db.rollback()
        raise


@router.get(
    "/orders",
    response_model=list[OrderResponse],
)
def my_orders(
    db: DB,
    user: Buyer,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
):
    statement = (
        select(Order)
        .where(Order.buyer_id == user.id)
        .options(selectinload(Order.items))
        .order_by(Order.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return [
        response(order)
        for order in db.scalars(statement).all()
    ]


@router.get(
    "/admin/orders",
    response_model=list[OrderResponse],
)
def admin_orders(
    db: DB,
    user: Admin,
    order_status: Annotated[
        Literal[
            "pending",
            "completed",
            "cancelled",
        ] | None,
        Query(),
    ] = None,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
):
    statement = (
        select(Order)
        .options(selectinload(Order.items))
    )

    if order_status is not None:
        statement = statement.where(
            Order.status == order_status
        )

    statement = (
        statement
        .order_by(Order.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return [
        response(order)
        for order in db.scalars(statement).all()
    ]


def close_order(
    db,
    order_id,
    actor,
    target,
    buyer_only=False,
):
    try:
        statement = select(Order).where(
            Order.id == order_id
        )

        if buyer_only:
            statement = statement.where(
                Order.buyer_id == actor.id
            )

        order = db.scalar(
            statement
            .with_for_update()
            .execution_options(
                populate_existing=True,
            )
        )

        if order is None:
            raise HTTPException(
                status_code=404,
                detail="Order not found.",
            )

        # Repeated requests must not deduct
        # or release the same stock twice.
        if order.status == target:
            return response(order)

        if order.status != "pending":
            conflict(
                "Only pending orders can be "
                "completed or cancelled."
            )

        # Payment checks happen before stock changes.
        if target == "completed":
            require_paid_payment(db, order)
        else:
            prepare_order_cancellation(db, order)

        stocks = lock_stocks(
            db,
            [
                item.stock_id
                for item in order.items
            ],
        )

        for item in order.items:
            stock = stocks[item.stock_id]

            if (
                stock.reserved_quantity
                < item.quantity_kg
                or stock.quantity_on_hand
                < stock.reserved_quantity
            ):
                conflict(
                    "Stock reservation is inconsistent. "
                    "Contact the administrator."
                )

            stock.reserved_quantity -= item.quantity_kg

            if target == "completed":
                stock.quantity_on_hand -= item.quantity_kg

                db.add(
                    StockMovement(
                        stock_id=stock.id,
                        movement_type="adjustment",
                        quantity_change=-item.quantity_kg,
                        quantity_after=stock.quantity_on_hand,
                        note=(
                            f"Completed order #{order.id}: "
                            "sale deduction."
                        ),
                        performed_by=actor.id,
                    )
                )

        order.status = target
        order.closed_by = actor.id

        order.closed_at = datetime.now(
            timezone.utc
        ).replace(
            tzinfo=None
        )

        db.flush()

        result = response(order)

        db.commit()
        return result

    except Exception:
        db.rollback()
        raise


@router.patch(
    "/orders/{order_id}/cancel",
    response_model=OrderResponse,
)
def cancel_my_order(
    order_id: int,
    db: DB,
    user: Buyer,
):
    return close_order(
        db,
        order_id,
        user,
        "cancelled",
        buyer_only=True,
    )


@router.patch(
    "/admin/orders/{order_id}/status",
    response_model=OrderResponse,
)
def change_order_status(
    order_id: int,
    data: OrderStatusUpdate,
    db: DB,
    user: Admin,
):
    return close_order(
        db,
        order_id,
        user,
        data.status,
    )