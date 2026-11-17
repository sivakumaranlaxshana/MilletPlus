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
from app.models.crop_cycle import CropCycle
from app.models.crop_variety import CropVariety
from app.models.farm import Farm
from app.models.harvest import Harvest
from app.schemas.harvest import PublicHarvestResponse


router = APIRouter(
    prefix="/public/harvests",
    tags=["Public Harvests"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]


def public_harvest_query():
    return (
        select(
            Harvest.id.label("id"),
            CropVariety.name.label("variety_name"),
            Farm.district.label("district"),
            Harvest.harvest_date.label("harvest_date"),
            Harvest.total_quantity_kg.label(
                "total_quantity_kg"
            ),
        )
        .join(
            CropCycle,
            Harvest.crop_cycle_id == CropCycle.id,
        )
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .join(
            CropVariety,
            CropCycle.variety_id == CropVariety.id,
        )
        .where(
            Harvest.status == "approved",
            Harvest.is_public.is_(True),
        )
    )


# Public list: no login required.

@router.get(
    "",
    response_model=list[PublicHarvestResponse],
)
def list_public_harvests(
    db: DatabaseSession,
    variety_id: Annotated[
        int | None,
        Query(gt=0),
    ] = None,
    district: Annotated[
        str | None,
        Query(min_length=2, max_length=50),
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
    statement = public_harvest_query()

    if variety_id is not None:
        statement = statement.where(
            CropCycle.variety_id == variety_id
        )

    if district is not None:
        statement = statement.where(
            Farm.district == district.strip()
        )

    statement = (
        statement
        .order_by(
            Harvest.harvest_date.desc(),
            Harvest.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    )

    return db.execute(statement).mappings().all()


# Public details: unpublished harvests return 404.

@router.get(
    "/{harvest_id}",
    response_model=PublicHarvestResponse,
)
def get_public_harvest(
    harvest_id: int,
    db: DatabaseSession,
):
    statement = public_harvest_query().where(
        Harvest.id == harvest_id
    )

    harvest = db.execute(
        statement
    ).mappings().one_or_none()

    if harvest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Harvest not found.",
        )

    return harvest