from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_cycle import CropCycle
from app.models.crop_variety import CropVariety
from app.models.farm import Farm
from app.models.user import User

from app.schemas.crop_cycle import (
    CropCycleCreate,
    CropCycleResponse,
    CropCycleUpdate,
)

from app.services.crop_feature_access import (
    check_crop_access,
    ensure_free_cycle_record,
    lock_crop_owner,
)


router = APIRouter(
    prefix="/crop-cycles",
    tags=["My Crops"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]

CropID = Annotated[
    int,
    Path(gt=0),
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
            status_code=404,
            detail="Farm not found.",
        )

    return farm


def ensure_variety_exists(
    db: Session,
    variety_id: int,
) -> None:
    if db.get(CropVariety, variety_id) is None:
        raise HTTPException(
            status_code=404,
            detail="Crop variety not found.",
        )


def get_owned_crop(
    db: Session,
    crop_id: int,
    farmer_id: int,
) -> CropCycle:
    crop = db.scalar(
        select(CropCycle)
        .join(Farm, CropCycle.farm_id == Farm.id)
        .where(
            CropCycle.id == crop_id,
            Farm.farmer_id == farmer_id,
        )
    )

    if crop is None:
        raise HTTPException(
            status_code=404,
            detail="Crop not found.",
        )

    return crop


@router.post(
    "",
    response_model=CropCycleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_crop(
    data: CropCycleCreate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    farmer_id = current_user.id

    try:
        # Serialize crop creation across every farm
        # owned by this farmer.
        lock_crop_owner(db, farmer_id)

        get_owned_farm(
            db=db,
            farm_id=data.farm_id,
            farmer_id=farmer_id,
        )

        ensure_variety_exists(
            db=db,
            variety_id=data.variety_id,
        )

        # Preserve an existing farmer's first crop
        # before adding another one.
        record = ensure_free_cycle_record(
            db,
            farmer_id,
        )

        crop = CropCycle(**data.model_dump())

        db.add(crop)
        db.flush()

        if record is None:
            # The crop just created is this farmer's first.
            ensure_free_cycle_record(
                db,
                farmer_id,
            )

        db.commit()
        db.refresh(crop)

        return crop

    except Exception:
        db.rollback()
        raise


@router.get(
    "",
    response_model=list[CropCycleResponse],
)
def list_my_crops(
    db: DatabaseSession,
    current_user: FarmerUser,
    farm_id: Annotated[
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
    if farm_id is not None:
        get_owned_farm(
            db=db,
            farm_id=farm_id,
            farmer_id=current_user.id,
        )

    statement = (
        select(CropCycle)
        .join(Farm, CropCycle.farm_id == Farm.id)
        .where(Farm.farmer_id == current_user.id)
    )

    if farm_id is not None:
        statement = statement.where(
            CropCycle.farm_id == farm_id,
        )

    statement = (
        statement
        .order_by(CropCycle.id.desc())
        .offset(offset)
        .limit(limit)
    )

    return db.scalars(statement).all()


@router.get("/{crop_id}/feature-access")
def crop_feature_access(
    crop_id: CropID,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    return check_crop_access(
        db=db,
        farmer_id=current_user.id,
        crop_id=crop_id,
    )


@router.get(
    "/{crop_id}",
    response_model=CropCycleResponse,
)
def get_my_crop(
    crop_id: CropID,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    return get_owned_crop(
        db=db,
        crop_id=crop_id,
        farmer_id=current_user.id,
    )


@router.patch(
    "/{crop_id}",
    response_model=CropCycleResponse,
)
def update_my_crop(
    crop_id: CropID,
    data: CropCycleUpdate,
    db: DatabaseSession,
    current_user: FarmerUser,
):
    farmer_id = current_user.id

    try:
        lock_crop_owner(db, farmer_id)

        crop = get_owned_crop(
            db=db,
            crop_id=crop_id,
            farmer_id=farmer_id,
        )

        record = ensure_free_cycle_record(
            db,
            farmer_id,
        )

        changes = data.model_dump(
            exclude_unset=True,
        )

        free_cycle_already_used = bool(
            record is not None
            and record.free_crop_cycle_id == crop.id
            and record.free_feature_used_at is not None
        )

        if free_cycle_already_used:
            # A used free cycle cannot be repurposed
            # as another planting cycle.
            for field_name in ("planting_date", "variety_id"):
                if (
                    field_name in changes
                    and changes[field_name]
                    != getattr(crop, field_name)
                ):
                    raise HTTPException(
                        409,
                        (
                            "The planting date and variety "
                            "of a used free crop cycle cannot "
                            "be changed. Add a new crop cycle."
                        ),
                    )

        if "variety_id" in changes:
            ensure_variety_exists(
                db=db,
                variety_id=changes["variety_id"],
            )

        for field_name, value in changes.items():
            setattr(crop, field_name, value)

        db.commit()
        db.refresh(crop)

        return crop

    except Exception:
        db.rollback()
        raise