from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index,
    Numeric, String, UniqueConstraint, func, text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FarmerSubscriptionPlan(Base):
    __tablename__ = "farmer_subscription_plans"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_fs_plans_amount"),
        CheckConstraint("currency = 'LKR'", name="ck_fs_plans_currency"),
        CheckConstraint("duration_months > 0", name="ck_fs_plans_duration"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="LKR", server_default="LKR")
    duration_months: Mapped[int] = mapped_column(default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class FarmerSubscription(Base):
    __tablename__ = "farmer_subscriptions"
    __table_args__ = (
        UniqueConstraint("farmer_id", "request_key", name="uq_fs_farmer_request"),
        CheckConstraint("amount > 0", name="ck_fs_amount"),
        CheckConstraint("currency = 'LKR'", name="ck_fs_currency"),
        CheckConstraint("duration_months > 0", name="ck_fs_duration"),
        CheckConstraint("status IN ('pending', 'active', 'expired', 'cancelled')", name="ck_fs_status"),
        CheckConstraint(
            "(starts_at IS NULL AND ends_at IS NULL) OR "
            "(starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)",
            name="ck_fs_dates",
        ),
        CheckConstraint("status <> 'active' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)", name="ck_fs_active_dates"),
        Index("ix_fs_farmer_status", "farmer_id", "status"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    farmer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("farmer_subscription_plans.id", ondelete="RESTRICT"))
    request_key: Mapped[str] = mapped_column(String(36))
    plan_name: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    duration_months: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    payment: Mapped["FarmerSubscriptionPayment"] = relationship(
        back_populates="subscription", uselist=False, lazy="selectin",
    )

    @property
    def effective_status(self) -> str:
        if self.status == "active" and self.ends_at is not None and self.ends_at <= utc_now():
            return "expired"
        return self.status

    @property
    def has_access(self) -> bool:
        now = utc_now()
        return bool(
            self.status == "active"
            and self.starts_at is not None and self.starts_at <= now
            and self.ends_at is not None and self.ends_at > now
            and self.payment is not None and self.payment.status == "paid"
            and not self.payment.requires_review
            and self.payment.amount == self.amount and self.payment.currency == self.currency
            and self.payment.provider_payment_id and self.payment.paid_at is not None
        )


class FarmerSubscriptionPayment(Base):
    __tablename__ = "farmer_subscription_payments"
    __table_args__ = (
        UniqueConstraint("provider", "provider_payment_id", name="uq_fsp_provider_payment"),
        CheckConstraint("amount > 0", name="ck_fsp_amount"),
        CheckConstraint("currency = 'LKR'", name="ck_fsp_currency"),
        CheckConstraint("status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')", name="ck_fsp_status"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("farmer_subscriptions.id", ondelete="RESTRICT"), unique=True,
    )
    provider: Mapped[str] = mapped_column(String(20), default="payhere", server_default="payhere")
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="LKR", server_default="LKR")
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    checkout_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    gateway_status_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    requires_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"), nullable=False)
    subscription: Mapped[FarmerSubscription] = relationship(back_populates="payment")
