from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserStatusHistory(Base):
    __tablename__ = "user_status_history"

    __table_args__ = (
        CheckConstraint(
            "previous_active <> new_active",
            name="ck_user_status_changed",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )

    previous_active: Mapped[bool] = mapped_column(Boolean)
    new_active: Mapped[bool] = mapped_column(Boolean)

    reason: Mapped[str] = mapped_column(String(1000))

    changed_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
    )

    changed_at: Mapped[datetime] = mapped_column(
        DateTime,
        index=True,
    )