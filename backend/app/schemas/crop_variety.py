from datetime import datetime
from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class CropVarietyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        min_length=2,
        max_length=100,
    )

    market_price_per_kg: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=10,
        decimal_places=2,
        allow_inf_nan=False,
    )

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class CropVarietyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )

    market_price_per_kg: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=10,
        decimal_places=2,
        allow_inf_nan=False,
    )

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if value is None:
            raise ValueError(
                "Name cannot be null. "
                "Omit it to keep the current name."
            )

        if isinstance(value, str):
            return " ".join(value.split())

        return value

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide at least one field to update."
            )
        return self


class CropVarietyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    market_price_per_kg: Decimal | None
    price_updated_at: datetime | None
    