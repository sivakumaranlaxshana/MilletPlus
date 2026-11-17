from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


Amount = Annotated[
    Decimal,
    Field(
        gt=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    ),
]

Name = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=100,
    ),
]

Phone = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=7,
        max_length=30,
    ),
]

Address = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=5,
        max_length=500,
    ),
]


class OrderLineCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    stock_id: Annotated[
        int,
        Field(
            gt=0,
            strict=True,
        ),
    ]

    quantity_kg: Amount
    expected_unit_price: Amount


class OrderCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    request_key: UUID
    recipient_name: Name
    phone: Phone
    delivery_address: Address

    items: list[OrderLineCreate] = Field(
        min_length=1,
        max_length=50,
    )

    @model_validator(mode="after")
    def unique_stocks(self):
        ids = [
            item.stock_id
            for item in self.items
        ]

        if len(ids) != len(set(ids)):
            raise ValueError(
                "Each stock may appear only once."
            )

        return self


class OrderItemResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    stock_id: int
    variety_name: str

    quantity_kg: Decimal
    unit_price: Decimal
    line_total: Decimal


class OrderResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    buyer_id: int

    status: Literal[
        "pending",
        "completed",
        "cancelled",
    ]

    recipient_name: str
    phone: str
    delivery_address: str

    total_amount: Decimal

    created_at: datetime
    closed_at: datetime | None

    items: list[OrderItemResponse]


class OrderStatusUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    status: Literal[
        "completed",
        "cancelled",
    ]