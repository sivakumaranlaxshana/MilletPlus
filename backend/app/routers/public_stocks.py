from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db

from app.models.crop_cycle import CropCycle
from app.models.crop_variety import CropVariety
from app.models.harvest import Harvest
from app.models.stock import HarvestStock

from app.schemas.public_stock import (
    PublicStockResponse,
)


router = APIRouter(
    prefix="/public/stocks",
    tags=["Public Stock"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]


def public_stock_statement():
    available = (
        HarvestStock.quantity_on_hand
        - HarvestStock.reserved_quantity
    )

    return (
        select(
            HarvestStock.id,

            CropVariety.id.label(
                "variety_id"
            ),

            CropVariety.name.label(
                "variety_name"
            ),

            available.label(
                "available_quantity"
            ),

            HarvestStock.selling_price_per_kg,

            (available > 0).label(
                "in_stock"
            ),
        )
        .select_from(HarvestStock)
        .join(
            Harvest,
            HarvestStock.harvest_id
            == Harvest.id,
        )
        .join(
            CropCycle,
            Harvest.crop_cycle_id
            == CropCycle.id,
        )
        .join(
            CropVariety,
            CropCycle.variety_id
            == CropVariety.id,
        )
        .where(
            HarvestStock.is_active.is_(True),

            Harvest.status == "approved",

            HarvestStock.selling_price_per_kg
            .is_not(None),

            HarvestStock.selling_price_per_kg > 0,
        )
    )


# Public and Buyer pages use the same stock data.
# Active batches with zero available quantity remain
# visible so the frontend can show Out of Stock.

@router.get(
    "",
    response_model=list[PublicStockResponse],
)
def list_public_stocks(
    response: Response,
    db: DatabaseSession,
    variety_id: Annotated[
        int | None,
        Query(gt=0),
    ] = None,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 50,
):
    response.headers[
        "Cache-Control"
    ] = "no-store"

    statement = public_stock_statement()

    if variety_id is not None:
        statement = statement.where(
            CropVariety.id == variety_id
        )

    statement = (
        statement
        .order_by(
            HarvestStock.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )

    rows = (
        db.execute(statement)
        .mappings()
        .all()
    )

    return [
        PublicStockResponse.model_validate(row)
        for row in rows
    ]


@router.get(
    "/{stock_id}",
    response_model=PublicStockResponse,
    responses={
        404: {
            "description": "Public stock not found."
        },
    },
)
def get_public_stock(
    stock_id: Annotated[
        int,
        Path(gt=0),
    ],
    response: Response,
    db: DatabaseSession,
):
    response.headers[
        "Cache-Control"
    ] = "no-store"

    statement = (
        public_stock_statement()
        .where(
            HarvestStock.id == stock_id
        )
    )

    row = (
        db.execute(statement)
        .mappings()
        .first()
    )

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stock not found.",
        )

    return PublicStockResponse.model_validate(
        row
    )