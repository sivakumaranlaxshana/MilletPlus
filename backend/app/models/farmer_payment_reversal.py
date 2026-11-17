from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FarmerPaymentReversal(Base):
    __tablename__ = "farmer_payment_reversals"

    __table_args__ = (
        CheckConstraint(
            "kind IN ('recording_error', 'cash_return')",
            name="ck_fpr_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    payment_id: Mapped[int] = mapped_column(
        ForeignKey(
            "farmer_purchase_payments.id",
            ondelete="RESTRICT",
        ),
        unique=True,
    )

    request_key: Mapped[str] = mapped_column(
        String(36),
        unique=True,
    )

    kind: Mapped[str] = mapped_column(String(20))

    reason: Mapped[str] = mapped_column(String(1000))

    return_reference: Mapped[str | None] = mapped_column(
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