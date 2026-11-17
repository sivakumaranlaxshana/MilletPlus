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


PositiveId = Annotated[
    int,
    Field(gt=0, strict=True),
]

HarvestQuantity = Annotated[
    Decimal,
    Field(
        gt=0,
        max_digits=12,
        decimal_places=2,
        allow_inf_nan=False,
    ),
]

HarvestStatus = Literal[
    "pending",
    "approved",
    "rejected",
]


class HarvestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    crop_cycle_id: PositiveId
    harvest_date: date
    total_quantity_kg: HarvestQuantity

    notes: str | None = Field(
        default=None,
        max_length=2000,
    )

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value):
        if isinstance(value, str):
            return value.strip() or None

        return value


class HarvestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    harvest_date: date | None = None
    total_quantity_kg: HarvestQuantity | None = None

    notes: str | None = Field(
        default=None,
        max_length=2000,
    )

    @field_validator(
        "harvest_date",
        "total_quantity_kg",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null."
            )

        return value

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value):
        if isinstance(value, str):
            return value.strip() or None

        return value

    @model_validator(mode="after")
    def require_update_fields(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide at least one field to update."
            )

        return self


class HarvestReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["approved", "rejected"]

    review_note: str | None = Field(
        default=None,
        max_length=2000,
    )

    @field_validator("review_note", mode="before")
    @classmethod
    def clean_review_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None

        return value

    @model_validator(mode="after")
    def require_rejection_reason(self):
        if (
            self.status == "rejected"
            and not self.review_note
        ):
            raise ValueError(
                "Provide a reason when rejecting a harvest."
            )

        return self


class HarvestPublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_public: bool = Field(strict=True)


class HarvestResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    crop_cycle_id: int

    harvest_date: date
    total_quantity_kg: Decimal
    notes: str | None

    status: HarvestStatus
    is_public: bool

    review_note: str | None
    reviewed_by: int | None
    reviewed_at: datetime | None

    created_at: datetime
    updated_at: datetime


class AdminHarvestResponse(HarvestResponse):
    farmer_id: int
    farmer_name: str

    farm_id: int
    farm_name: str
    district: str

    variety_id: int
    variety_name: str
    planting_date: date


class PublicHarvestResponse(BaseModel):
    id: int
    variety_name: str
    district: str
    harvest_date: date
    total_quantity_kg: Decimal