from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)


ENV_FILE = (
    Path(__file__).resolve().parent.parent / ".env"
)


class Settings(BaseSettings):
    # Database configuration.
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str
    DB_PASSWORD: SecretStr
    DB_NAME: str

    # Authentication configuration.
    JWT_SECRET_KEY: SecretStr = Field(
        min_length=32,
    )

    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(
        default=60,
        gt=0,
    )

    # Email configuration.
    SMTP_HOST: str = "smtp.gmail.com"

    SMTP_PORT: int = Field(
        default=587,
        ge=1,
        le=65535,
    )

    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: SecretStr = SecretStr("")
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "Millet Pulse"

    # Password reset OTP configuration.
    RESET_OTP_EXPIRE_MINUTES: int = Field(
        default=10,
        ge=1,
        le=30,
    )

    RESET_OTP_MAX_ATTEMPTS: int = Field(
        default=5,
        ge=1,
        le=10,
    )

    RESET_OTP_RESEND_SECONDS: int = Field(
        default=60,
        ge=30,
    )

    # Cloudinary configuration.
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: SecretStr = SecretStr("")

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()