from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FarmerCropAccess(Base):
    __tablename__ = "farmer_crop_access"

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        primary_key=True,
    )

    free_crop_cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "crop_cycles.id",
            ondelete="SET NULL",
        ),
        nullable=True,
        unique=True,
    )

    claimed_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utc_now,
    )

    free_feature_used_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )