from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


class PurchaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_key: UUID
    stock_id: int = Field(gt=0)
    purchase_date: date

    unit_price: Decimal = Field(
        gt=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    )

    note: str | None = Field(
        default=None, max_length=1000
    )

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class PurchasePaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_key: UUID

    receipt_number: str = Field(
        min_length=3,
        max_length=50,
        pattern=r"^[A-Z0-9][A-Z0-9/-]*$",
    )

    amount: Decimal = Field(
        gt=0,
        max_digits=26,
        decimal_places=2,
        allow_inf_nan=False,
    )

    paid_at: AwareDatetime

    note: str | None = Field(
        default=None, max_length=1000
    )

    @field_validator("receipt_number", mode="before")
    @classmethod
    def clean_receipt(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value