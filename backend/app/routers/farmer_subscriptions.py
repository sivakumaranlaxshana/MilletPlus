from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.user import User

from app.models.farmer_subscription import (
    FarmerSubscriptionPlan,
    FarmerSubscription,
)

from app.schemas.farmer_subscription import (
    SubscriptionCreate,
    SubscriptionResponse,
    SubscriptionPlanResponse,
    SubscriptionPlanUpdate,
)

from app.services.farmer_subscriptions import (
    initialize_monthly_plan,
    create_subscription,
    cancel_subscription,
)


router = APIRouter(
    tags=["Farmer Subscriptions"],
)

DB = Annotated[
    Session,
    Depends(get_db),
]

Farmer = Annotated[
    User,
    Depends(require_roles("farmer")),
]

Admin = Annotated[
    User,
    Depends(require_roles("admin")),
]


@router.get(
    "/subscription-plans",
    response_model=list[SubscriptionPlanResponse],
)
def public_plans(
    db: DB,
):
    statement = (
        select(FarmerSubscriptionPlan)
        .where(
            FarmerSubscriptionPlan.is_active.is_(True)
        )
        .order_by(
            FarmerSubscriptionPlan.id
        )
    )

    return db.scalars(statement).all()


@router.post(
    "/admin/subscription-plans/initialize",
    response_model=SubscriptionPlanResponse,
)
def initialize_plan(
    db: DB,
    user: Admin,
):
    return initialize_monthly_plan(db)


@router.get(
    "/admin/subscription-plans",
    response_model=list[SubscriptionPlanResponse],
)
def admin_plans(
    db: DB,
    user: Admin,
):
    statement = (
        select(FarmerSubscriptionPlan)
        .order_by(
            FarmerSubscriptionPlan.id
        )
    )

    return db.scalars(statement).all()


@router.patch(
    "/admin/subscription-plans/{plan_id}",
    response_model=SubscriptionPlanResponse,
)
def update_plan(
    plan_id: Annotated[
        int,
        Path(gt=0),
    ],
    data: SubscriptionPlanUpdate,
    db: DB,
    user: Admin,
):
    try:
        plan = db.scalar(
            select(FarmerSubscriptionPlan)
            .where(
                FarmerSubscriptionPlan.id == plan_id
            )
            .with_for_update()
            .execution_options(
                populate_existing=True,
            )
        )

        if plan is None:
            raise HTTPException(
                status_code=404,
                detail="Subscription plan not found.",
            )

        plan.is_active = data.is_active

        db.flush()

        result = SubscriptionPlanResponse.model_validate(
            plan
        )

        db.commit()

        return result

    except Exception:
        db.rollback()
        raise


@router.post(
    "/farmer/subscriptions",
    response_model=SubscriptionResponse,
)
def subscribe(
    data: SubscriptionCreate,
    db: DB,
    user: Farmer,
):
    try:
        subscription = create_subscription(
            db,
            user.id,
            data,
        )

        result = SubscriptionResponse.model_validate(
            subscription
        )

        db.commit()

        return result

    except IntegrityError:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "Subscription request conflict. "
                "Refresh your history."
            ),
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get(
    "/farmer/subscriptions",
    response_model=list[SubscriptionResponse],
)
def farmer_history(
    db: DB,
    user: Farmer,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
):
    statement = (
        select(FarmerSubscription)
        .where(
            FarmerSubscription.farmer_id == user.id
        )
        .order_by(
            FarmerSubscription.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )

    rows = db.scalars(statement).all()

    return [
        SubscriptionResponse.model_validate(row)
        for row in rows
    ]


@router.patch(
    "/farmer/subscriptions/{subscription_id}/cancel",
    response_model=SubscriptionResponse,
)
def cancel_pending(
    subscription_id: Annotated[
        int,
        Path(gt=0),
    ],
    db: DB,
    user: Farmer,
):
    try:
        subscription = cancel_subscription(
            db,
            user.id,
            subscription_id,
        )

        result = SubscriptionResponse.model_validate(
            subscription
        )

        db.commit()

        return result

    except Exception:
        db.rollback()
        raise


@router.get(
    "/admin/farmer-subscriptions",
    response_model=list[SubscriptionResponse],
)
def admin_history(
    db: DB,
    user: Admin,
    farmer_id: Annotated[
        int | None,
        Query(gt=0),
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=100),
    ] = 20,
    offset: Annotated[
        int,
        Query(ge=0),
    ] = 0,
):
    statement = select(FarmerSubscription)

    if farmer_id is not None:
        statement = statement.where(
            FarmerSubscription.farmer_id == farmer_id
        )

    statement = (
        statement
        .order_by(
            FarmerSubscription.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )

    rows = db.scalars(statement).all()

    return [
        SubscriptionResponse.model_validate(row)
        for row in rows
    ]