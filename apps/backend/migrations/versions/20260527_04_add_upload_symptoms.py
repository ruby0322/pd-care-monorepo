"""add upload symptom columns (non-destructive)

Revision ID: 20260527_04
Revises: 20260526_03
Create Date: 2026-05-27 12:40:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260527_04"
down_revision = "20260526_03"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = inspect(bind)
    try:
        columns = {column["name"] for column in inspector.get_columns(table_name)}
    except Exception:
        return False
    return column_name in columns


def upgrade() -> None:
    if _has_column("uploads", "symptom_pain") is False:
        op.add_column(
            "uploads",
            sa.Column("symptom_pain", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
    if _has_column("uploads", "symptom_discharge") is False:
        op.add_column(
            "uploads",
            sa.Column("symptom_discharge", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
    if _has_column("uploads", "symptom_pus") is False:
        op.add_column(
            "uploads",
            sa.Column("symptom_pus", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )


def downgrade() -> None:
    # Non-destructive policy: do not drop columns in default downgrade path.
    pass
