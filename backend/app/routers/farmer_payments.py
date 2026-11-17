from datetime import date
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from sqlalchemy import select
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
from app.models.user import User

from app.routers.admin_farmer_purchases import (
    list_purchases,
    purchase_data,
    total_paid,
    utc_value,
)


router = APIRouter(
    prefix="/farmer/payments",
    tags=["Farmer Sales / Payments"],
)

DB = Annotated[Session, Depends(get_db)]
Farmer = Annotated[
    User,
    Depends(require_roles("farmer")),
]


def owned_purchase(
    db: Session,
    purchase_id: int,
    farmer_id: int,
):
    purchase = db.scalar(
        select(FarmerPurchase).where(
            FarmerPurchase.id == purchase_id,
            FarmerPurchase.farmer_id == farmer_id,
        )
    )

    if purchase is None:
        raise HTTPException(
            404,
            "Purchase not found.",
        )

    return purchase


def farmer_purchase_data(row):
    return {
        key: value
        for key, value in row.items()
        if key not in {
            "note",
            "recorded_by",
        }
    }


@router.get("")
def my_purchases(
    db: DB,
    farmer: Farmer,
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
    # Reuse the query internally.
    # Farmer ID always comes from the authenticated account.
    result = list_purchases(
        db=db,
        admin=farmer,
        farmer_id=farmer.id,
        variety_id=variety_id,
        date_from=date_from,
        date_to=date_to,
        payment_status=payment_status,
        limit=limit,
        offset=offset,
    )

    result["items"] = [
        farmer_purchase_data(row)
        for row in result["items"]
    ]

    return result


@router.get("/{purchase_id}")
def my_purchase(
    purchase_id: Annotated[int, Path(gt=0)],
    db: DB,
    farmer: Farmer,
):
    purchase = owned_purchase(
        db,
        purchase_id,
        farmer.id,
    )

    return farmer_purchase_data(
        purchase_data(
            purchase,
            total_paid(db, purchase.id),
        )
    )


@router.get("/{purchase_id}/history")
def my_payment_history(
    purchase_id: Annotated[int, Path(gt=0)],
    db: DB,
    farmer: Farmer,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    owned_purchase(
        db,
        purchase_id,
        farmer.id,
    )

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
        .order_by(FarmerPurchasePayment.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        {
            "payment_id": payment.id,
            "receipt_number": payment.receipt_number,
            "amount": payment.amount,
            "payment_method": payment.payment_method,
            "paid_at": utc_value(payment.paid_at),
            "is_reversed": reversal is not None,
            "reversal_kind": (
                reversal.kind
                if reversal is not None
                else None
            ),
            "reversal_at": (
                utc_value(reversal.effective_at)
                if reversal is not None
                else None
            ),
        }
        for payment, reversal in rows
    ]