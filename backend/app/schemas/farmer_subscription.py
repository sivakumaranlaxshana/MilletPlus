from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
)


class SubscriptionPlanResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    code: str
    name: str
    amount: Decimal
    currency: str
    duration_months: int
    is_active: bool
    created_at: datetime


class SubscriptionPlanUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    is_active: StrictBool


class SubscriptionCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    plan_id: int = Field(
        gt=0,
        strict=True,
    )

    request_key: UUID


class SubscriptionPaymentResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    subscription_id: int
    provider: str
    amount: Decimal
    currency: str

    status: Literal[
        "pending",
        "paid",
        "failed",
        "cancelled",
        "refunded",
    ]

    provider_payment_id: str | None

    paid_at: datetime | None
    closed_at: datetime | None
    created_at: datetime


class SubscriptionResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    farmer_id: int
    plan_id: int
    request_key: str

    plan_name: str
    amount: Decimal
    currency: str
    duration_months: int

    status: Literal[
        "pending",
        "active",
        "expired",
        "cancelled",
    ]

    effective_status: Literal[
        "pending",
        "active",
        "expired",
        "cancelled",
    ]

    has_access: bool

    starts_at: datetime | None
    ends_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime

    payment: SubscriptionPaymentResponse | None