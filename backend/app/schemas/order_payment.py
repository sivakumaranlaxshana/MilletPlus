from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrderPaymentCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    request_key: UUID


class OrderPaymentResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    order_id: int
    request_key: str

    provider: str
    currency: str
    amount: Decimal

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