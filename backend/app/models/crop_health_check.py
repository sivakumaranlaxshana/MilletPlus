from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CropHealthCheck(Base):
    __tablename__ = "crop_health_checks"
    __table_args__ = (
        Index(
            "ix_crop_health_checks_farmer_crop_id",
            "farmer_id",
            "crop_cycle_id",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    crop_cycle_id: Mapped[int] = mapped_column(
        ForeignKey("crop_cycles.id", ondelete="CASCADE")
    )
    language: Mapped[str] = mapped_column(String(2))
    symptoms: Mapped[str] = mapped_column(Text)
    observed_signs: Mapped[str] = mapped_column(Text)
    possible_problem: Mapped[str] = mapped_column(Text)
    care_steps: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)