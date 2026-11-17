from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index,
    Numeric, String, UniqueConstraint, func, text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OrderPayment(Base):
    __tablename__ = "order_payments"
    __table_args__ = (
        UniqueConstraint("order_id", "request_key", name="uq_order_payments_request"),
        UniqueConstraint("provider", "provider_payment_id", name="uq_order_payments_provider_id"),
        CheckConstraint("amount > 0", name="ck_order_payments_amount"),
        CheckConstraint("currency = 'LKR'", name="ck_order_payments_currency"),
        CheckConstraint(
            "status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')",
            name="ck_order_payments_status",
        ),
        Index("ix_order_payments_order_status", "order_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    request_key: Mapped[str] = mapped_column(String(36))
    provider: Mapped[str] = mapped_column(String(20), default="payhere", server_default="payhere")
    currency: Mapped[str] = mapped_column(String(3), default="LKR", server_default="LKR")
    amount: Mapped[Decimal] = mapped_column(Numeric(26, 2))
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    checkout_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Last applied gateway status. -3 is a chargeback, not a normal refund.
    gateway_status_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    requires_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0"),
    )
