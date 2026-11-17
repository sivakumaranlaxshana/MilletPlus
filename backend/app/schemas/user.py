import re
from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)


def normalize_phone(value: str) -> str:
    phone = re.sub(r"[\s()-]", "", value)

    if phone.startswith("+94"):
        phone = "0" + phone[3:]

    if not re.fullmatch(r"07[0-9]{8}", phone):
        raise ValueError(
            "Enter a valid Sri Lankan mobile number."
        )

    # Your application's custom prefix restrictions.
    blocked_prefixes = {
        "070",
        "071",
        "072",
        "073",
        "079",
    }

    if phone[:3] in blocked_prefixes:
        raise ValueError(
            "This mobile number prefix is not supported."
        )

    return "+94" + phone[1:]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(max_length=30)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["farmer", "buyer"]

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value: str) -> str:
        return normalize_phone(value)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value


class GoogleLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str = Field(
        min_length=1,
        max_length=10000,
    )


class GoogleRegisterRequest(GoogleLoginRequest):
    phone: str = Field(max_length=30)
    role: Literal["farmer", "buyer"]

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value: str) -> str:
        return normalize_phone(value)


class ProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Omitted fields stay unchanged.
    name: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )

    phone: str | None = Field(
        default=None,
        max_length=30,
    )

    sms_opt_in: bool | None = Field(
        default=None,
        strict=True,
    )

    @field_validator(
        "name",
        "phone",
        "sms_opt_in",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError(
                "This field cannot be null. "
                "Omit it to keep its current value."
            )
        return value

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, value):
        return normalize_phone(value)

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_fields_set:
            raise ValueError(
                "Provide at least one field to update."
            )
        return self


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    email: str | None = None
    role: Literal["farmer", "buyer", "admin"]
    is_active: bool
    sms_opt_in: bool
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)

    otp: str = Field(
        min_length=6,
        max_length=6,
        pattern=r"^[0-9]{6}$",
    )

    new_password: str = Field(
        min_length=8,
        max_length=128,
    )

    confirm_password: str = Field(
        min_length=8,
        max_length=128,
    )

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(
        cls,
        value: str,
        info: ValidationInfo,
    ) -> str:
        new_password = info.data.get("new_password")

        if (
            new_password is not None
            and value != new_password
        ):
            raise ValueError(
                "Passwords do not match."
            )

        return value


class MessageResponse(BaseModel):
    message: str