from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CropVariety(Base):
    __tablename__ = "crop_varieties"

    __table_args__ = (
        CheckConstraint(
            "market_price_per_kg >= 0",
            name="ck_crop_varieties_market_price_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )

    market_price_per_kg: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2),
        nullable=True,
    )

    price_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )