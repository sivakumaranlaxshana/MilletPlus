from datetime import date
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.harvest import Harvest
from app.models.user import User
from app.schemas.harvest import (
    HarvestCreate,
    HarvestResponse,
    HarvestUpdate,
)


router = APIRouter(
    prefix="/harvests",
    tags=["My Harvests"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]


def get_owned_crop(
    db: Session,
    crop_cycle_id: int,
    farmer_id: int,
    lock: bool = False,
) -> CropCycle:
    statement = (
        select(CropCycle)
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            CropCycle.id == crop_cycle_id,
            Farm.farmer_id == farmer_id,
        )
    )

    if lock:
        statement = statement.with_for_update()

    crop = db.scalar(statement)

    if crop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Crop not found.",
        )

    return crop


def get_owned_harvest(
    db: Session,
    harvest_id: int,
    farmer_id: int,
    lock: bool = False,
) -> Harvest:
    statement = (
        select(Harvest)
        .join(
            CropCycle,
            Harvest.crop_cycle_id == CropCycle.id,
        )
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            Harvest.id == harvest_id,
            Farm.farmer_id == farmer_id,
        )
    )

    if lock:
        statement = statement.with_for_update()

    harvest = db.scalar(statement)

    if harvest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Harvest not found.",
        )

    return harvest


def validate_harvest_date(
    harvest_date: date,
    planting_date: date,
) -> None:
    if harvest_date < planting_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Harvest date cannot be before "
                "the crop planting date."
            ),
        )


# Submit harvest details for an owned crop.

@router.post(
    "",
    response_model=HarvestResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_harvest(
    data: HarvestCreate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    crop = get_owned_crop(
        db=db,
        crop_cycle_id=data.crop_cycle_id,
        farmer_id=current_user.id,
        lock=True,
    )

    validate_harvest_date(
        harvest_date=data.harvest_date,
        planting_date=crop.planting_date,
    )

    harvest = Harvest(
        **data.model_dump(),
        status="pending",
        is_public=False,
    )

    db.add(harvest)
    db.commit()
    db.refresh(harvest)

    return harvest


# View the logged-in farmer's harvest submissions.

@router.get(
    "",
    response_model=list[HarvestResponse],
)
def list_my_harvests(
    db: DatabaseSession,
    current_user: FarmerUser,
    crop_cycle_id: Annotated[
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
    if crop_cycle_id is not None:
        get_owned_crop(
            db=db,
            crop_cycle_id=crop_cycle_id,
            farmer_id=current_user.id,
        )

    statement = (
        select(Harvest)
        .join(
            CropCycle,
            Harvest.crop_cycle_id == CropCycle.id,
        )
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            Farm.farmer_id == current_user.id
        )
    )

    if crop_cycle_id is not None:
        statement = statement.where(
            Harvest.crop_cycle_id == crop_cycle_id
        )

    statement = (
        statement
        .order_by(Harvest.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


# View one owned harvest submission.

@router.get(
    "/{harvest_id}",
    response_model=HarvestResponse,
)
def get_my_harvest(
    harvest_id: int,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    return get_owned_harvest(
        db=db,
        harvest_id=harvest_id,
        farmer_id=current_user.id,
    )


# Only pending submissions can be edited by the farmer.

@router.patch(
    "/{harvest_id}",
    response_model=HarvestResponse,
)
def update_my_harvest(
    harvest_id: int,
    data: HarvestUpdate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    harvest = get_owned_harvest(
        db=db,
        harvest_id=harvest_id,
        farmer_id=current_user.id,
        lock=True,
    )

    if harvest.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Only pending harvest submissions "
                "can be updated."
            ),
        )

    changes = data.model_dump(
        exclude_unset=True,
    )

    crop = harvest.crop_cycle

    effective_date = changes.get(
        "harvest_date",
        harvest.harvest_date,
    )

    validate_harvest_date(
        harvest_date=effective_date,
        planting_date=crop.planting_date,
    )

    for field_name, value in changes.items():
        setattr(harvest, field_name, value)

    db.commit()
    db.refresh(harvest)

    return harvest