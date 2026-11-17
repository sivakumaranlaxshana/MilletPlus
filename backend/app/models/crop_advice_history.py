from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CropAdviceHistory(Base):
    __tablename__ = "crop_advice_history"

    __table_args__ = (
        CheckConstraint(
            "source IN ('guidance_rule', 'ai')",
            name="ck_crop_advice_history_source",
        ),
        Index(
            "ix_crop_advice_history_farmer_crop",
            "farmer_id",
            "crop_cycle_id",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    crop_cycle_id: Mapped[int] = mapped_column(
        ForeignKey("crop_cycles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    question: Mapped[str] = mapped_column(String(500), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)

    planting_date: Mapped[date] = mapped_column(Date, nullable=False)
    task: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    source: Mapped[str] = mapped_column(String(20), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )