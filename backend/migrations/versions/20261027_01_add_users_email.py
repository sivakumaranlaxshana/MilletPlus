"""Add email to the existing users table."""

from alembic import op
import sqlalchemy as sa


revision = "20261027_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "email",
            sa.String(length=254),
            nullable=True,
        ),
    )

    op.create_unique_constraint(
        "uq_users_email",
        "users",
        ["email"],
    )


def downgrade():
    op.drop_constraint(
        "uq_users_email",
        "users",
        type_="unique",
    )

    op.drop_column("users", "email")