from decimal import Decimal
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import (
    Session,
    joinedload,
)

from app.database import get_db
from app.dependencies import require_roles

from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.harvest import Harvest
from app.models.stock import (
    HarvestStock,
    StockMovement,
)
from app.models.user import User

from app.schemas.stock import (
    StockAdjustmentRequest,
    StockMovementResponse,
    StockReceiveRequest,
    StockResponse,
    StockUpdateRequest,
)


router = APIRouter(
    prefix="/admin/stocks",
    tags=["Admin Stock"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

AdminUser = Annotated[
    User,
    Depends(require_roles("admin")),
]

MAX_QUANTITY = Decimal("9999999999.99")


def build_response(
    stock: HarvestStock,
) -> StockResponse:
    crop = stock.harvest.crop_cycle
    farmer = crop.farm.farmer

    extra_fields = {
        "variety_id",
        "variety_name",
        "farmer_id",
        "farmer_name",
    }

    stock_data = {
        field_name: getattr(stock, field_name)
        for field_name in StockResponse.model_fields
        if field_name not in extra_fields
    }

    return StockResponse(
        **stock_data,
        variety_id=crop.variety_id,
        variety_name=crop.variety.name,
        farmer_id=farmer.id,
        farmer_name=farmer.name,
    )


def get_stock(
    db: Session,
    stock_id: int,
    lock: bool = False,
) -> HarvestStock:
    statement = select(
        HarvestStock
    ).where(
        HarvestStock.id == stock_id
    )

    if lock:
        statement = statement.with_for_update()

    stock = db.scalar(statement)

    if stock is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stock not found.",
        )

    return stock


def commit_changes(
    db: Session,
) -> None:
    try:
        db.commit()

    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Stock could not be saved because "
                "of a database constraint. "
                "Refresh and try again."
            ),
        ) from exc

    except Exception:
        db.rollback()
        raise


# Receive an approved harvest into stock.
# One harvest can be received only once.

@router.post(
    "/receive",
    response_model=StockResponse,
    status_code=status.HTTP_201_CREATED,
)
def receive_stock(
    data: StockReceiveRequest,
    db: DatabaseSession,
    current_user: AdminUser,
):
    statement = (
        select(Harvest)
        .where(
            Harvest.id == data.harvest_id
        )
        .with_for_update()
    )

    harvest = db.scalar(statement)

    if harvest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Harvest not found.",
        )

    if harvest.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Only approved harvests "
                "can be received into stock."
            ),
        )

    existing_stock_id = db.scalar(
        select(HarvestStock.id).where(
            HarvestStock.harvest_id == harvest.id
        )
    )

    if existing_stock_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This harvest has already "
                "been received into stock."
            ),
        )

    if (
        data.received_quantity_kg
        > harvest.total_quantity_kg
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Received quantity cannot exceed "
                "the submitted harvest quantity."
            ),
        )

    if (
        data.received_date
        < harvest.harvest_date
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Received date cannot be "
                "before the harvest date."
            ),
        )

    stock = HarvestStock(
        harvest_id=harvest.id,
        received_quantity_kg=data.received_quantity_kg,
        received_date=data.received_date,
        received_by=current_user.id,
        quantity_on_hand=data.received_quantity_kg,
        reserved_quantity=Decimal("0.00"),
        is_active=False,
    )

    try:
        db.add(stock)
        db.flush()

        movement = StockMovement(
            stock_id=stock.id,
            movement_type="receipt",
            quantity_change=data.received_quantity_kg,
            quantity_after=data.received_quantity_kg,
            note=data.note,
            performed_by=current_user.id,
        )

        db.add(movement)

        commit_changes(db)

    except IntegrityError as exc:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Stock receiving conflicted "
                "with another update. "
                "Refresh the stock list."
            ),
        ) from exc

    except Exception:
        db.rollback()
        raise

    db.refresh(stock)

    return build_response(stock)


# View all received stock batches.

@router.get(
    "",
    response_model=list[StockResponse],
)
def list_stocks(
    db: DatabaseSession,
    current_user: AdminUser,
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
    statement = select(
        HarvestStock
    ).options(
        joinedload(HarvestStock.harvest)
        .joinedload(Harvest.crop_cycle)
        .joinedload(CropCycle.farm)
        .joinedload(Farm.farmer),

        joinedload(HarvestStock.harvest)
        .joinedload(Harvest.crop_cycle)
        .joinedload(CropCycle.variety),
    )

    if variety_id is not None:
        statement = (
            statement
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
            .where(
                CropCycle.variety_id == variety_id
            )
        )

    statement = (
        statement
        .order_by(HarvestStock.id.desc())
        .offset(offset)
        .limit(limit)
    )

    stocks = db.scalars(statement).all()

    return [
        build_response(stock)
        for stock in stocks
    ]


# View stock receiving, adjustments and settings history.

@router.get(
    "/{stock_id}/movements",
    response_model=list[StockMovementResponse],
)
def stock_history(
    stock_id: int,
    db: DatabaseSession,
    current_user: AdminUser,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 50,
):
    get_stock(
        db=db,
        stock_id=stock_id,
    )

    statement = (
        select(StockMovement)
        .where(
            StockMovement.stock_id == stock_id
        )
        .order_by(StockMovement.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


# View one stock batch.

@router.get(
    "/{stock_id}",
    response_model=StockResponse,
)
def stock_details(
    stock_id: int,
    db: DatabaseSession,
    current_user: AdminUser,
):
    stock = get_stock(
        db=db,
        stock_id=stock_id,
    )

    return build_response(stock)


# Update selling price and availability.

@router.patch(
    "/{stock_id}",
    response_model=StockResponse,
)
def update_stock(
    stock_id: int,
    data: StockUpdateRequest,
    db: DatabaseSession,
    current_user: AdminUser,
):
    stock = get_stock(
        db=db,
        stock_id=stock_id,
        lock=True,
    )

    changes = data.model_dump(
        exclude_unset=True,
    )

    effective_price = changes.get(
        "selling_price_per_kg",
        stock.selling_price_per_kg,
    )

    effective_active = changes.get(
        "is_active",
        stock.is_active,
    )

    if (
        effective_active
        and effective_price is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Set a selling price "
                "before activating stock."
            ),
        )

    change_notes = []

    for field_name, value in changes.items():
        previous_value = getattr(
            stock,
            field_name,
        )

        if previous_value != value:
            change_notes.append(
                f"{field_name}: "
                f"{previous_value} -> {value}"
            )

            setattr(
                stock,
                field_name,
                value,
            )

    if change_notes:
        movement = StockMovement(
            stock_id=stock.id,
            movement_type="settings",
            quantity_change=Decimal("0.00"),
            quantity_after=stock.quantity_on_hand,
            note="; ".join(change_notes),
            performed_by=current_user.id,
        )

        db.add(movement)

    commit_changes(db)
    db.refresh(stock)

    return build_response(stock)


# Correct physical stock quantity with a reason.
# Negative change reduces stock.
# Positive change increases stock.

@router.post(
    "/{stock_id}/adjustments",
    response_model=StockResponse,
)
def adjust_stock(
    stock_id: int,
    data: StockAdjustmentRequest,
    db: DatabaseSession,
    current_user: AdminUser,
):
    stock = get_stock(
        db=db,
        stock_id=stock_id,
        lock=True,
    )

    new_balance = (
        stock.quantity_on_hand
        + data.quantity_change
    )

    if new_balance < stock.reserved_quantity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Adjustment would reduce stock "
                "below the reserved quantity "
                "or below zero."
            ),
        )

    if new_balance > MAX_QUANTITY:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Stock quantity exceeds "
                "the supported maximum."
            ),
        )

    stock.quantity_on_hand = new_balance

    movement = StockMovement(
        stock_id=stock.id,
        movement_type="adjustment",
        quantity_change=data.quantity_change,
        quantity_after=new_balance,
        note=data.reason,
        performed_by=current_user.id,
    )

    db.add(movement)

    commit_changes(db)
    db.refresh(stock)

    return build_response(stock)