from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
)
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_roles
from app.models.crop_advice_history import CropAdviceHistory
from app.models.crop_cycle import CropCycle
from app.models.crop_reminder import CropReminder, utc_now
from app.models.farm import Farm
from app.models.user import User
from app.services.crop_feature_access import (
    ensure_free_cycle_record,
    has_paid_subscription,
    lock_crop_owner,
)


router = APIRouter(
    prefix="/crop-reminders",
    tags=["Crop Reminders"],
)

DatabaseSession = Annotated[Session, Depends(get_db)]
FarmerUser = Annotated[
    User,
    Depends(require_roles("farmer")),
]
ReminderStatus = Literal["pending", "completed"]


class ReminderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    advice_id: int = Field(gt=0)
    remind_at: AwareDatetime
    send_sms: bool = False


class ReminderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remind_at: AwareDatetime | None = None
    status: Literal["completed"] | None = None

    @model_validator(mode="after")
    def require_one_action(self):
        if (self.remind_at is None) == (self.status is None):
            raise ValueError(
                "Provide either remind_at or status='completed'."
            )
        return self


class ReminderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    crop_cycle_id: int
    advice_id: int
    task: str
    remind_at: AwareDatetime
    status: ReminderStatus
    completed_at: AwareDatetime | None
    created_at: AwareDatetime
    sms_status: str
    sms_sent_at: AwareDatetime | None

    @field_validator(
        "remind_at",
        "completed_at",
        "created_at",
        "sms_sent_at",
        mode="before",
    )
    @classmethod
    def add_utc_to_database_values(cls, value):
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


def future_utc(value: datetime) -> datetime:
    try:
        result = value.astimezone(timezone.utc).replace(
            tzinfo=None,
            microsecond=0,
        )
    except (OverflowError, ValueError):
        raise HTTPException(
            422,
            "Invalid reminder date and time.",
        ) from None

    if result <= utc_now():
        raise HTTPException(
            422,
            "Choose a reminder time in the future.",
        )

    return result


def owned_reminders(farmer_id: int):
    return (
        select(CropReminder)
        .join(
            CropCycle,
            CropCycle.id == CropReminder.crop_cycle_id,
        )
        .join(Farm, Farm.id == CropCycle.farm_id)
        .where(
            CropReminder.farmer_id == farmer_id,
            Farm.farmer_id == farmer_id,
        )
    )


def require_sms_access(
    db: Session,
    farmer: User,
    crop_cycle_id: int,
) -> None:
    """
    The caller must lock the farmer's User row first.

    This helper does not commit. Reminder creation or update
    commits the access record and reminder together.
    """
    if not farmer.sms_opt_in:
        raise HTTPException(
            422,
            "Enable SMS in your profile first.",
        )

    access = ensure_free_cycle_record(db, farmer.id)

    is_free_cycle = (
        access is not None
        and access.free_crop_cycle_id == crop_cycle_id
    )

    if not is_free_cycle and not has_paid_subscription(
        db,
        farmer.id,
    ):
        raise HTTPException(
            403,
            (
                "Your first crop cycle is free. "
                "An active subscription is required "
                "for SMS reminders on additional crop cycles."
            ),
        )

    if (
        is_free_cycle
        and access.free_feature_used_at is None
    ):
        access.free_feature_used_at = utc_now()


@router.post(
    "",
    response_model=ReminderResponse,
    status_code=201,
)
def create_reminder(
    data: ReminderCreate,
    db: DatabaseSession,
    farmer: FarmerUser,
):
    farmer_id = farmer.id

    try:
        # Use the same farmer lock as crop/subscription operations.
        locked_farmer = lock_crop_owner(db, farmer_id)

        advice = db.scalar(
            select(CropAdviceHistory)
            .join(
                CropCycle,
                CropCycle.id == CropAdviceHistory.crop_cycle_id,
            )
            .join(Farm, Farm.id == CropCycle.farm_id)
            .where(
                CropAdviceHistory.id == data.advice_id,
                CropAdviceHistory.farmer_id == farmer_id,
                Farm.farmer_id == farmer_id,
            )
        )

        if advice is None:
            raise HTTPException(404, "Advice not found.")

        if not advice.task or advice.suggested_date is None:
            raise HTTPException(
                422,
                "This advice has no scheduled task.",
            )

        remind_at = future_utc(data.remind_at)

        if data.send_sms:
            require_sms_access(
                db,
                locked_farmer,
                advice.crop_cycle_id,
            )

        reminder = CropReminder(
            farmer_id=farmer_id,
            crop_cycle_id=advice.crop_cycle_id,
            advice_id=advice.id,
            task=advice.task,
            remind_at=remind_at,
            status="pending",
            sms_status=(
                "queued" if data.send_sms else "disabled"
            ),
        )

        db.add(reminder)
        db.flush()

        result = ReminderResponse.model_validate(reminder)
        db.commit()

        return result

    except IntegrityError:
        db.rollback()

        existing_id = db.scalar(
            select(CropReminder.id).where(
                CropReminder.advice_id == data.advice_id,
                CropReminder.farmer_id == farmer_id,
            )
        )
        db.rollback()

        if existing_id is not None:
            raise HTTPException(
                409,
                "A reminder already exists for this advice.",
            ) from None

        raise HTTPException(
            409,
            "Reminder record conflict. Refresh your reminders.",
        ) from None

    except Exception:
        db.rollback()
        raise


@router.get(
    "",
    response_model=list[ReminderResponse],
)
def list_reminders(
    db: DatabaseSession,
    farmer: FarmerUser,
    status: ReminderStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    query = owned_reminders(farmer.id)

    if status is not None:
        query = query.where(CropReminder.status == status)

    return db.scalars(
        query.order_by(
            CropReminder.remind_at,
            CropReminder.id,
        )
        .offset(offset)
        .limit(limit)
    ).all()


@router.patch(
    "/{reminder_id}",
    response_model=ReminderResponse,
)
def update_reminder(
    reminder_id: Annotated[int, Path(gt=0)],
    data: ReminderUpdate,
    db: DatabaseSession,
    farmer: FarmerUser,
):
    farmer_id = farmer.id

    try:
        # Always lock User before locking the reminder.
        locked_farmer = lock_crop_owner(db, farmer_id)

        reminder = db.scalar(
            owned_reminders(farmer_id)
            .where(CropReminder.id == reminder_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if reminder is None:
            raise HTTPException(404, "Reminder not found.")

        if reminder.status == "completed":
            if data.status == "completed":
                result = ReminderResponse.model_validate(reminder)
                db.commit()
                return result

            raise HTTPException(
                409,
                "A completed reminder cannot be rescheduled.",
            )

        if reminder.sms_status == "sending":
            raise HTTPException(
                409,
                "SMS is being processed. Try again shortly.",
            )

        if data.remind_at is not None:
            remind_at = future_utc(data.remind_at)

            if reminder.sms_status == "queued":
                require_sms_access(
                    db,
                    locked_farmer,
                    reminder.crop_cycle_id,
                )

            reminder.remind_at = remind_at

            # Rescheduling does not resend an already sent SMS.
        else:
            reminder.status = "completed"
            reminder.completed_at = utc_now()

            if reminder.sms_status == "queued":
                reminder.sms_status = "skipped"

        db.flush()

        result = ReminderResponse.model_validate(reminder)
        db.commit()

        return result

    except Exception:
        db.rollback()
        raise