from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SubscriptionCashReversal(Base):
    __tablename__ = "subscription_cash_reversals"

    __table_args__ = (
        CheckConstraint(
            "kind IN ('recording_error', 'cash_refund')",
            name="ck_scr_kind",
        ),
        CheckConstraint(
            "amount > 0",
            name="ck_scr_amount",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    receipt_id: Mapped[int] = mapped_column(
        ForeignKey(
            "subscription_cash_receipts.id",
            ondelete="RESTRICT",
        ),
        unique=True,
    )

    payment_id: Mapped[int] = mapped_column(
        ForeignKey(
            "farmer_subscription_payments.id",
            ondelete="RESTRICT",
        ),
        unique=True,
    )

    request_key: Mapped[str] = mapped_column(
        String(36),
        unique=True,
    )

    kind: Mapped[str] = mapped_column(String(20))

    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2),
    )

    reason: Mapped[str] = mapped_column(String(1000))

    refund_reference: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    effective_at: Mapped[datetime] = mapped_column(
        DateTime,
        index=True,
    )

    recorded_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime)