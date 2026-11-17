from datetime import date, datetime
from typing import Annotated

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

CropText = Annotated[
    str,
    Field(min_length=2, max_length=50),
]


class CropCycleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    farm_id: PositiveId
    variety_id: PositiveId

    planting_date: date
    growth_stage: CropText
    soil_type: CropText
    irrigation_method: CropText

    @field_validator(
        "growth_stage",
        "soil_type",
        "irrigation_method",
        mode="before",
    )
    @classmethod
    def clean_text(cls, value):
        if isinstance(value, str):
            return " ".join(value.split())

        return value


class CropCycleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variety_id: PositiveId | None = None
    planting_date: date | None = None
    growth_stage: CropText | None = None
    soil_type: CropText | None = None
    irrigation_method: CropText | None = None

    @field_validator(
        "variety_id",
        "planting_date",
        "growth_stage",
        "soil_type",
        "irrigation_method",
        mode="before",
    )
    @classmethod
    def validate_submitted_value(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null."
            )

        if isinstance(value, str):
            return " ".join(value.split())

        return value

    @model_validator(mode="after")
    def require_update_fields(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide at least one field to update."
            )

        return self


class CropCycleResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    farm_id: int
    variety_id: int

    planting_date: date
    growth_stage: str
    soil_type: str
    irrigation_method: str

    image_url: str | None = None

    created_at: datetime
    updated_at: datetime