from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.database import Base

if TYPE_CHECKING:
    from app.models.crop_variety import CropVariety
    from app.models.farm import Farm


class CropCycle(Base):
    __tablename__ = "crop_cycles"

    __table_args__ = (
        CheckConstraint(
            "(image_url IS NULL AND image_public_id IS NULL) "
            "OR "
            "(image_url IS NOT NULL AND image_public_id IS NOT NULL)",
            name="ck_crop_cycles_image_pair",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    farm_id: Mapped[int] = mapped_column(
        ForeignKey(
            "farms.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )

    variety_id: Mapped[int] = mapped_column(
        ForeignKey(
            "crop_varieties.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )

    planting_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    growth_stage: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    soil_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    irrigation_method: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    image_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
    )

    image_public_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    farm: Mapped["Farm"] = relationship(
        "Farm",
    )

    variety: Mapped["CropVariety"] = relationship(
        "CropVariety",
    )