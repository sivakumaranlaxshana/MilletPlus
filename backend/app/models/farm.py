from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
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
    from app.models.user import User


class Farm(Base):
    __tablename__ = "farms"

    __table_args__ = (
        CheckConstraint(
            "area_acres > 0",
            name="ck_farms_area_positive",
        ),
        CheckConstraint(
            "latitude BETWEEN -90 AND 90",
            name="ck_farms_latitude_range",
        ),
        CheckConstraint(
            "longitude BETWEEN -180 AND 180",
            name="ck_farms_longitude_range",
        ),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) "
            "OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL)",
            name="ck_farms_coordinates_pair",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    district: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    location: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    area_acres: Mapped[Decimal] = mapped_column(
        Numeric(10, 2),
        nullable=False,
    )

    latitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6),
        nullable=True,
    )

    longitude: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 6),
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

    farmer: Mapped["User"] = relationship(
        "User",
        back_populates="farms",
    )