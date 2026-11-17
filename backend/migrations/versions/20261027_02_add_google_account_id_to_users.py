"""Add Google account ID to users."""

from alembic import op
import sqlalchemy as sa


revision = "20261027_02"
down_revision = "20261027_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "google_sub",
            sa.String(length=255),
            nullable=True,
        ),
    )

    op.create_unique_constraint(
        "uq_users_google_sub",
        "users",
        ["google_sub"],
    )


def downgrade():
    op.drop_constraint(
        "uq_users_google_sub",
        "users",
        type_="unique",
    )

    op.drop_column("users", "google_sub")