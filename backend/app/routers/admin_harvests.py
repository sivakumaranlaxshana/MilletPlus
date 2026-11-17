from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.harvest import Harvest
from app.models.user import User
from app.schemas.harvest import (
    AdminHarvestResponse,
    HarvestPublishRequest,
    HarvestResponse,
    HarvestReviewRequest,
)


router = APIRouter(
    prefix="/admin/harvests",
    tags=["Admin Harvests"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

AdminUser = Annotated[
    User,
    Depends(require_roles("admin")),
]


def build_response(
    harvest: Harvest,
) -> AdminHarvestResponse:
    crop = harvest.crop_cycle
    farm = crop.farm
    farmer = farm.farmer
    variety = crop.variety

    harvest_data = HarvestResponse.model_validate(
        harvest
    ).model_dump()

    return AdminHarvestResponse(
        **harvest_data,
        farmer_id=farmer.id,
        farmer_name=farmer.name,
        farm_id=farm.id,
        farm_name=farm.name,
        district=farm.district,
        variety_id=variety.id,
        variety_name=variety.name,
        planting_date=crop.planting_date,
    )


def get_harvest(
    db: Session,
    harvest_id: int,
    lock: bool = False,
) -> Harvest:
    statement = select(Harvest).where(
        Harvest.id == harvest_id
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


# View harvests submitted by all farmers.

@router.get(
    "",
    response_model=list[AdminHarvestResponse],
)
def list_harvests(
    db: DatabaseSession,
    current_user: AdminUser,
    review_status: Annotated[
        Literal["pending", "approved", "rejected"] | None,
        Query(),
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
    statement = select(Harvest).options(
        joinedload(Harvest.crop_cycle)
        .joinedload(CropCycle.farm)
        .joinedload(Farm.farmer),
        joinedload(Harvest.crop_cycle)
        .joinedload(CropCycle.variety),
    )

    if review_status is not None:
        statement = statement.where(
            Harvest.status == review_status
        )

    statement = (
        statement
        .order_by(Harvest.id.desc())
        .offset(offset)
        .limit(limit)
    )

    harvests = db.scalars(statement).all()

    return [
        build_response(harvest)
        for harvest in harvests
    ]


# View harvest, farmer, farm and crop details.

@router.get(
    "/{harvest_id}",
    response_model=AdminHarvestResponse,
)
def get_harvest_details(
    harvest_id: int,
    db: DatabaseSession,
    current_user: AdminUser,
):
    harvest = get_harvest(
        db=db,
        harvest_id=harvest_id,
    )

    return build_response(harvest)


# Review a pending submission.

@router.patch(
    "/{harvest_id}/review",
    response_model=AdminHarvestResponse,
)
def review_harvest(
    harvest_id: int,
    data: HarvestReviewRequest,
    db: DatabaseSession,
    current_user: AdminUser,
):
    harvest = get_harvest(
        db=db,
        harvest_id=harvest_id,
        lock=True,
    )

    if harvest.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This harvest has already been reviewed.",
        )

    crop = harvest.crop_cycle

    if harvest.harvest_date < crop.planting_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Harvest date cannot be before "
                "the crop planting date."
            ),
        )

    harvest.status = data.status
    harvest.review_note = data.review_note
    harvest.reviewed_by = current_user.id

    # Store UTC as a naive datetime for the existing
    # MySQL DateTime columns.
    harvest.reviewed_at = datetime.now(
        timezone.utc
    ).replace(tzinfo=None)

    harvest.is_public = False

    db.commit()
    db.refresh(harvest)

    return build_response(harvest)


# Publish or hide an approved harvest.

@router.patch(
    "/{harvest_id}/publish",
    response_model=AdminHarvestResponse,
)
def publish_harvest(
    harvest_id: int,
    data: HarvestPublishRequest,
    db: DatabaseSession,
    current_user: AdminUser,
):
    harvest = get_harvest(
        db=db,
        harvest_id=harvest_id,
        lock=True,
    )

    if (
        data.is_public
        and harvest.status != "approved"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Only approved harvests "
                "can be published."
            ),
        )

    harvest.is_public = data.is_public

    db.commit()
    db.refresh(harvest)

    return build_response(harvest)