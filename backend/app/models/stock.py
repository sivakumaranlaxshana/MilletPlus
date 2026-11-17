from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.database import Base
from app.models.harvest import Harvest


class HarvestStock(Base):
    __tablename__ = "harvest_stocks"

    __table_args__ = (
        UniqueConstraint(
            "harvest_id",
            name="uq_harvest_stocks_harvest",
        ),
        CheckConstraint(
            "received_quantity_kg > 0",
            name="ck_stock_received_positive",
        ),
        CheckConstraint(
            "quantity_on_hand >= 0",
            name="ck_stock_on_hand_nonnegative",
        ),
        CheckConstraint(
            "reserved_quantity >= 0 "
            "AND reserved_quantity <= quantity_on_hand",
            name="ck_stock_reserved_valid",
        ),
        CheckConstraint(
            "selling_price_per_kg IS NULL "
            "OR selling_price_per_kg > 0",
            name="ck_stock_price_positive",
        ),
        CheckConstraint(
            "is_active = 0 "
            "OR selling_price_per_kg IS NOT NULL",
            name="ck_stock_active_price",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    harvest_id: Mapped[int] = mapped_column(
        ForeignKey(
            "harvests.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )

    received_quantity_kg: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )

    received_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    received_by: Mapped[int] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )

    quantity_on_hand: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )

    reserved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        default=Decimal("0.00"),
        server_default="0",
        nullable=False,
    )

    selling_price_per_kg: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="0",
        nullable=False,
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

    harvest: Mapped[Harvest] = relationship(
        Harvest,
    )

    @property
    def available_quantity(self) -> Decimal:
        return (
            self.quantity_on_hand
            - self.reserved_quantity
        )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    __table_args__ = (
        CheckConstraint(
            "movement_type IN "
            "('receipt', 'adjustment', 'settings')",
            name="ck_stock_movement_type",
        ),
        CheckConstraint(
            "quantity_after >= 0",
            name="ck_stock_movement_balance",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    stock_id: Mapped[int] = mapped_column(
        ForeignKey(
            "harvest_stocks.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )

    movement_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    quantity_change: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )

    quantity_after: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
        nullable=False,
    )

    note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    performed_by: Mapped[int] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )