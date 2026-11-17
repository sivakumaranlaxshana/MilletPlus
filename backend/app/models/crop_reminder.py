from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class CropReminder(Base):
    __tablename__ = "crop_reminders"
    __table_args__ = (
        UniqueConstraint("advice_id", name="uq_crop_reminders_advice"),
        CheckConstraint(
            "status IN ('pending', 'completed')",
            name="ck_crop_reminders_status",
        ),
        CheckConstraint(
            "(status = 'pending' AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_at IS NOT NULL)",
            name="ck_crop_reminders_completion",
        ),
        Index("ix_crop_reminders_farmer_status_due", "farmer_id", "status", "remind_at"),
        Index("ix_crop_reminders_sms_due", "status", "sms_status", "remind_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    crop_cycle_id: Mapped[int] = mapped_column(
        ForeignKey("crop_cycles.id", ondelete="RESTRICT"), nullable=False,
    )
    advice_id: Mapped[int] = mapped_column(
        ForeignKey("crop_advice_history.id", ondelete="RESTRICT"), nullable=False,
    )
    task: Mapped[str] = mapped_column(String(255), nullable=False)
    remind_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now)
    sms_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="disabled", server_default="disabled",
    )
    sms_attempted_at: Mapped[datetime | None] = mapped_column(DateTime)
    sms_sent_at: Mapped[datetime | None] = mapped_column(DateTime)