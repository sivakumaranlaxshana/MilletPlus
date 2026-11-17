from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    field_validator,
)


Language = Literal["ta", "en"]
AdviceText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=1000),
]


class CropHealthAdvice(BaseModel):
    observed_signs: AdviceText
    possible_problem: AdviceText
    care_steps: list[AdviceText] = Field(min_length=1, max_length=3)


class CropHealthResponse(CropHealthAdvice):
    model_config = ConfigDict(from_attributes=True)

    id: int
    crop_cycle_id: int
    language: Language
    symptoms: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def attach_utc(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

    @computed_field
    @property
    def disclaimer(self) -> str:
        if self.language == "ta":
            return (
                "இது ஆரம்ப AI ஆலோசனை. "
                "காரணத்தை உறுதிப்படுத்த வேளாண்மை நிபுணரை அணுகவும்."
            )
        return (
            "This is preliminary AI guidance. "
            "Ask an agricultural expert to confirm the cause."
        )