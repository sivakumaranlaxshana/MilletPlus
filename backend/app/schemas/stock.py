from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


StockQuantity = Annotated[
    Decimal,
    Field(
        gt=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    ),
]

StockQuantityChange = Annotated[
    Decimal,
    Field(
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    ),
]


class StockReceiveRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    harvest_id: int = Field(
        gt=0,
        strict=True,
    )

    received_quantity_kg: StockQuantity
    received_date: date

    note: str | None = Field(
        default=None,
        max_length=2000,
    )

    @field_validator(
        "note",
        mode="before",
    )
    @classmethod
    def clean_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None

        return value

    @field_validator("received_date")
    @classmethod
    def validate_received_date(cls, value):
        if value > date.today():
            raise ValueError(
                "Received date cannot be in the future."
            )

        return value


class StockUpdateRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    selling_price_per_kg: StockQuantity | None = None

    is_active: bool | None = Field(
        default=None,
        strict=True,
    )

    @field_validator(
        "selling_price_per_kg",
        "is_active",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null."
            )

        return value

    @model_validator(mode="after")
    def require_update_fields(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide at least one field to update."
            )

        return self


class StockAdjustmentRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    quantity_change: StockQuantityChange

    reason: str = Field(
        min_length=3,
        max_length=2000,
    )

    @field_validator(
        "reason",
        mode="before",
    )
    @classmethod
    def clean_reason(cls, value):
        if isinstance(value, str):
            return value.strip()

        return value

    @field_validator("quantity_change")
    @classmethod
    def reject_zero_change(cls, value):
        if value == 0:
            raise ValueError(
                "Quantity change cannot be zero."
            )

        return value


class StockResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    harvest_id: int

    received_quantity_kg: Decimal
    received_date: date
    received_by: int

    quantity_on_hand: Decimal
    reserved_quantity: Decimal
    available_quantity: Decimal

    selling_price_per_kg: Decimal | None
    is_active: bool

    created_at: datetime
    updated_at: datetime

    variety_id: int
    variety_name: str

    farmer_id: int
    farmer_name: str


class StockMovementResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    stock_id: int

    movement_type: Literal[
        "receipt",
        "adjustment",
        "settings",
    ]

    quantity_change: Decimal
    quantity_after: Decimal

    note: str | None

    performed_by: int
    created_at: datetime