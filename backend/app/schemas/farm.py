from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


FarmName = Annotated[
    str,
    Field(min_length=2, max_length=100),
]

District = Annotated[
    str,
    Field(min_length=2, max_length=50),
]

Location = Annotated[
    str,
    Field(min_length=2, max_length=255),
]

AreaAcres = Annotated[
    Decimal,
    Field(
        gt=0,
        max_digits=10,
        decimal_places=2,
        allow_inf_nan=False,
    ),
]

Latitude = Annotated[
    Decimal,
    Field(
        ge=-90,
        le=90,
        max_digits=9,
        decimal_places=6,
        allow_inf_nan=False,
    ),
]

Longitude = Annotated[
    Decimal,
    Field(
        ge=-180,
        le=180,
        max_digits=9,
        decimal_places=6,
        allow_inf_nan=False,
    ),
]


class FarmCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FarmName
    district: District
    location: Location
    area_acres: AreaAcres

    latitude: Latitude | None = None
    longitude: Longitude | None = None

    @field_validator(
        "name",
        "district",
        "location",
        mode="before",
    )
    @classmethod
    def clean_text(cls, value):
        if isinstance(value, str):
            return " ".join(value.split())

        return value

    @model_validator(mode="after")
    def validate_coordinates(self):
        if (
            (self.latitude is None)
            != (self.longitude is None)
        ):
            raise ValueError(
                "Provide both latitude and longitude, "
                "or leave both empty."
            )

        return self


class FarmUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FarmName | None = None
    district: District | None = None
    location: Location | None = None
    area_acres: AreaAcres | None = None

    latitude: Latitude | None = None
    longitude: Longitude | None = None

    @field_validator(
        "name",
        "district",
        "location",
        "area_acres",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null."
            )

        if isinstance(value, str):
            return " ".join(value.split())

        return value

    @model_validator(mode="after")
    def validate_update(self):
        submitted = self.model_fields_set

        if not submitted:
            raise ValueError(
                "Provide at least one field to update."
            )

        coordinates = {"latitude", "longitude"}

        if submitted & coordinates:
            if not coordinates.issubset(submitted):
                raise ValueError(
                    "Send latitude and longitude together."
                )

            if (
                (self.latitude is None)
                != (self.longitude is None)
            ):
                raise ValueError(
                    "Provide both coordinates, "
                    "or set both to null."
                )

        return self


class FarmResponse(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    farmer_id: int

    name: str
    district: str
    location: str
    area_acres: Decimal

    latitude: Decimal | None
    longitude: Decimal | None

    created_at: datetime
    updated_at: datetime