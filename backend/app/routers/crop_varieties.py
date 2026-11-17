from datetime import datetime, timezone
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
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import (
    get_current_user,
    require_roles,
)
from app.models.crop_variety import CropVariety
from app.models.user import User
from app.schemas.crop_variety import (
    CropVarietyCreate,
    CropVarietyResponse,
    CropVarietyUpdate,
)


router = APIRouter(
    prefix="/crop-varieties",
    tags=["Crop Varieties"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

CurrentUser = Annotated[
    User,
    Depends(get_current_user),
]

AdminUser = Annotated[
    User,
    Depends(require_roles("admin")),
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(
        tzinfo=None
    )


def get_variety_or_404(
    variety_id: int,
    db: Session,
) -> CropVariety:
    variety = db.get(
        CropVariety,
        variety_id,
    )

    if variety is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Crop variety not found.",
        )

    return variety


def commit_variety(db: Session) -> None:
    try:
        db.commit()

    except IntegrityError as exc:
        db.rollback()

        error_args = getattr(
            exc.orig,
            "args",
            (),
        )

        error_code = (
            error_args[0]
            if error_args
            else None
        )

        if error_code == 1062:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "A crop variety with this name "
                    "already exists."
                ),
            ) from exc

        raise


@router.get(
    "",
    response_model=list[CropVarietyResponse],
)
def list_crop_varieties(
    db: DatabaseSession,
    current_user: CurrentUser,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 50,
):
    varieties = db.scalars(
        select(CropVariety)
        .order_by(
            CropVariety.name,
            CropVariety.id,
        )
        .offset(offset)
        .limit(limit)
    ).all()

    return varieties


@router.get(
    "/{variety_id}",
    response_model=CropVarietyResponse,
)
def get_crop_variety(
    variety_id: int,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    return get_variety_or_404(
        variety_id,
        db,
    )


@router.post(
    "",
    response_model=CropVarietyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_crop_variety(
    data: CropVarietyCreate,
    db: DatabaseSession,
    admin: AdminUser,
):
    existing_id = db.scalar(
        select(CropVariety.id).where(
            CropVariety.name == data.name
        )
    )

    if existing_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A crop variety with this name "
                "already exists."
            ),
        )

    variety = CropVariety(
        name=data.name,
        market_price_per_kg=data.market_price_per_kg,
        price_updated_at=(
            utc_now()
            if data.market_price_per_kg is not None
            else None
        ),
    )

    db.add(variety)
    commit_variety(db)
    db.refresh(variety)

    return variety


@router.patch(
    "/{variety_id}",
    response_model=CropVarietyResponse,
)
def update_crop_variety(
    variety_id: int,
    data: CropVarietyUpdate,
    db: DatabaseSession,
    admin: AdminUser,
):
    variety = get_variety_or_404(
        variety_id,
        db,
    )

    changes = data.model_dump(
        exclude_unset=True,
    )

    if "name" in changes:
        existing_id = db.scalar(
            select(CropVariety.id).where(
                CropVariety.name == changes["name"],
                CropVariety.id != variety.id,
            )
        )

        if existing_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "A crop variety with this name "
                    "already exists."
                ),
            )

        variety.name = changes["name"]

    if "market_price_per_kg" in changes:
        new_price = changes["market_price_per_kg"]

        if new_price != variety.market_price_per_kg:
            variety.market_price_per_kg = new_price
            variety.price_updated_at = utc_now()

    commit_variety(db)
    db.refresh(variety)

    return variety