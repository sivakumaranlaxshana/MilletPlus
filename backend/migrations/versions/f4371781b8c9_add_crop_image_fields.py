"""Add crop image fields

Revision ID: f4371781b8c9
Revises: 0821401d270a
Create Date: 2026-11-02 10:42:31.301310

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4371781b8c9"

down_revision: Union[str, Sequence[str], None] = (
    "0821401d270a"
)

branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "crop_cycles",
        sa.Column(
            "image_url",
            sa.String(length=2048),
            nullable=True,
        ),
    )

    op.add_column(
        "crop_cycles",
        sa.Column(
            "image_public_id",
            sa.String(length=255),
            nullable=True,
        ),
    )

    op.create_check_constraint(
        "ck_crop_cycles_image_pair",
        "crop_cycles",
        "(image_url IS NULL AND image_public_id IS NULL) "
        "OR "
        "(image_url IS NOT NULL AND image_public_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_crop_cycles_image_pair",
        "crop_cycles",
        type_="check",
    )

    op.drop_column(
        "crop_cycles",
        "image_public_id",
    )

    op.drop_column(
        "crop_cycles",
        "image_url",
    )