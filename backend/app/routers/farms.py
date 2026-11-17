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
from app.models.farm import Farm
from app.models.user import User
from app.schemas.farm import (
    FarmCreate,
    FarmResponse,
    FarmUpdate,
)


router = APIRouter(
    prefix="/farms",
    tags=["Farms"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]


def get_owned_farm(
    db: Session,
    farm_id: int,
    farmer_id: int,
) -> Farm:
    farm = db.scalar(
        select(Farm).where(
            Farm.id == farm_id,
            Farm.farmer_id == farmer_id,
        )
    )

    if farm is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Farm not found.",
        )

    return farm


# Add a farm for the logged-in farmer.

@router.post(
    "",
    response_model=FarmResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_farm(
    data: FarmCreate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    farm = Farm(
        farmer_id=current_user.id,
        **data.model_dump(),
    )

    db.add(farm)
    db.commit()
    db.refresh(farm)

    return farm


# View only the logged-in farmer's farms.

@router.get(
    "",
    response_model=list[FarmResponse],
)
def list_my_farms(
    db: DatabaseSession,
    current_user: FarmerUser,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 50,
):
    statement = (
        select(Farm)
        .where(
            Farm.farmer_id == current_user.id
        )
        .order_by(Farm.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


# View one of the logged-in farmer's farms.

@router.get(
    "/{farm_id}",
    response_model=FarmResponse,
)
def get_my_farm(
    farm_id: int,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    return get_owned_farm(
        db=db,
        farm_id=farm_id,
        farmer_id=current_user.id,
    )


# Update one of the logged-in farmer's farms.

@router.patch(
    "/{farm_id}",
    response_model=FarmResponse,
)
def update_my_farm(
    farm_id: int,
    data: FarmUpdate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    farm = get_owned_farm(
        db=db,
        farm_id=farm_id,
        farmer_id=current_user.id,
    )

    changes = data.model_dump(
        exclude_unset=True,
    )

    for field_name, value in changes.items():
        setattr(farm, field_name, value)

    db.commit()
    db.refresh(farm)

    return farm