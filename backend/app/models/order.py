from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.database import Base


class Order(Base):
    __tablename__ = "orders"

    __table_args__ = (
        UniqueConstraint(
            "buyer_id",
            "request_key",
            name="uq_orders_buyer_request",
        ),
        CheckConstraint(
            "status IN ('pending', 'completed', 'cancelled')",
            name="ck_orders_status",
        ),
        CheckConstraint(
            "total_amount > 0",
            name="ck_orders_total",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    buyer_id: Mapped[int] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
        ),
        index=True,
    )

    request_key: Mapped[str] = mapped_column(
        String(36),
    )

    request_hash: Mapped[str] = mapped_column(
        String(64),
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        server_default="pending",
        index=True,
    )

    recipient_name: Mapped[str] = mapped_column(
        String(100),
    )

    phone: Mapped[str] = mapped_column(
        String(30),
    )

    delivery_address: Mapped[str] = mapped_column(
        String(500),
    )

    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(26, 2),
    )

    closed_by: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
    )

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order",
        order_by="OrderItem.id",
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    __table_args__ = (
        UniqueConstraint(
            "order_id",
            "stock_id",
            name="uq_order_items_stock",
        ),
        CheckConstraint(
            "quantity_kg > 0 "
            "AND unit_price > 0 "
            "AND line_total > 0",
            name="ck_order_items_positive",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    order_id: Mapped[int] = mapped_column(
        ForeignKey(
            "orders.id",
            ondelete="RESTRICT",
        ),
        index=True,
    )

    stock_id: Mapped[int] = mapped_column(
        ForeignKey(
            "harvest_stocks.id",
            ondelete="RESTRICT",
        ),
        index=True,
    )

    variety_name: Mapped[str] = mapped_column(
        String(100),
    )

    quantity_kg: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    line_total: Mapped[Decimal] = mapped_column(
        Numeric(26, 2),
    )

    order: Mapped[Order] = relationship(
        back_populates="items",
    )