from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FarmerPurchase(Base):
    __tablename__ = "farmer_purchases"

    __table_args__ = (
        CheckConstraint(
            "quantity_kg > 0 AND unit_price > 0 AND total_amount > 0",
            name="ck_fp_positive",
        ),
        CheckConstraint(
            "currency = 'LKR'",
            name="ck_fp_currency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    request_key: Mapped[str] = mapped_column(
        String(36), unique=True
    )

    stock_id: Mapped[int] = mapped_column(
        ForeignKey("harvest_stocks.id", ondelete="RESTRICT"),
        unique=True,
    )

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )

    variety_id: Mapped[int] = mapped_column(
        ForeignKey("crop_varieties.id", ondelete="RESTRICT"),
        index=True,
    )

    farmer_name: Mapped[str] = mapped_column(String(100))
    variety_name: Mapped[str] = mapped_column(String(100))

    purchase_date: Mapped[date] = mapped_column(
        Date, index=True
    )

    quantity_kg: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(26, 2))

    currency: Mapped[str] = mapped_column(
        String(3), default="LKR"
    )

    note: Mapped[str | None] = mapped_column(
        String(1000), nullable=True
    )

    recorded_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime)


class FarmerPurchasePayment(Base):
    __tablename__ = "farmer_purchase_payments"

    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="ck_fpp_amount",
        ),
        CheckConstraint(
            "payment_method = 'cash'",
            name="ck_fpp_cash",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    request_key: Mapped[str] = mapped_column(
        String(36), unique=True
    )

    receipt_number: Mapped[str] = mapped_column(
        String(50), unique=True
    )

    purchase_id: Mapped[int] = mapped_column(
        ForeignKey("farmer_purchases.id", ondelete="RESTRICT"),
        index=True,
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(26, 2))

    payment_method: Mapped[str] = mapped_column(
        String(20), default="cash"
    )

    paid_at: Mapped[datetime] = mapped_column(
        DateTime, index=True
    )

    note: Mapped[str | None] = mapped_column(
        String(1000), nullable=True
    )

    recorded_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime)