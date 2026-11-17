from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SubscriptionCashReceipt(Base):
    __tablename__ = "subscription_cash_receipts"

    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="ck_sub_cash_amount",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    request_key: Mapped[str] = mapped_column(
        String(36),
        unique=True,
    )

    receipt_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
    )

    subscription_id: Mapped[int] = mapped_column(
        ForeignKey(
            "farmer_subscriptions.id",
            ondelete="RESTRICT",
        ),
        unique=True,
    )

    farmer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    received_at: Mapped[datetime] = mapped_column(
        DateTime,
        index=True,
    )

    recorded_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )

    note: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
    )