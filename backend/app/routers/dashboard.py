from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_cycle import CropCycle
from app.models.farm import Farm
from app.models.harvest import Harvest
from app.models.user import User
from app.schemas.dashboard import (
    AdminDashboardResponse,
    FarmerDashboardResponse,
)


router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
)

DatabaseSession = Annotated[
    Session,
    Depends(get_db),
]

FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]

AdminUser = Annotated[
    User,
    Depends(require_roles("admin")),
]


@router.get(
    "/farmer",
    response_model=FarmerDashboardResponse,
)
def farmer_dashboard(
    db: DatabaseSession,
    current_user: FarmerUser,
):
    farm_count = (
        select(func.count(Farm.id))
        .where(
            Farm.farmer_id == current_user.id
        )
        .scalar_subquery()
    )

    crop_count = (
        select(func.count(CropCycle.id))
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            Farm.farmer_id == current_user.id
        )
        .scalar_subquery()
    )

    harvest_count = (
        select(func.count(Harvest.id))
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
        .scalar_subquery()
    )

    pending_count = (
        select(func.count(Harvest.id))
        .join(
            CropCycle,
            Harvest.crop_cycle_id == CropCycle.id,
        )
        .join(
            Farm,
            CropCycle.farm_id == Farm.id,
        )
        .where(
            Farm.farmer_id == current_user.id,
            Harvest.status == "pending",
        )
        .scalar_subquery()
    )

    statement = select(
        farm_count.label("total_farms"),
        crop_count.label("total_crops"),
        harvest_count.label("total_harvests"),
        pending_count.label("pending_harvests"),
    )

    return db.execute(
        statement
    ).mappings().one()


@router.get(
    "/admin",
    response_model=AdminDashboardResponse,
)
def admin_dashboard(
    db: DatabaseSession,
    current_user: AdminUser,
):
    farmer_count = (
        select(func.count(User.id))
        .where(User.role == "farmer")
        .scalar_subquery()
    )

    buyer_count = (
        select(func.count(User.id))
        .where(User.role == "buyer")
        .scalar_subquery()
    )

    farm_count = (
        select(func.count(Farm.id))
        .scalar_subquery()
    )

    crop_count = (
        select(func.count(CropCycle.id))
        .scalar_subquery()
    )

    harvest_count = (
        select(func.count(Harvest.id))
        .scalar_subquery()
    )

    pending_count = (
        select(func.count(Harvest.id))
        .where(Harvest.status == "pending")
        .scalar_subquery()
    )

    statement = select(
        farmer_count.label("total_farmers"),
        buyer_count.label("total_buyers"),
        farm_count.label("total_farms"),
        crop_count.label("total_crops"),
        harvest_count.label("total_harvests"),
        pending_count.label("pending_harvests"),
    )

    return db.execute(
        statement
    ).mappings().one()