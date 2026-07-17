"""add upload symptom_cloudy_dialysate column (non-destructive)

Revision ID: 20260717_05
Revises: 20260527_04
Create Date: 2026-07-17 10:45:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260717_05"
down_revision = "20260527_04"
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
    if _has_column("uploads", "symptom_cloudy_dialysate") is False:
        op.add_column(
            "uploads",
            sa.Column(
                "symptom_cloudy_dialysate",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    # Non-destructive policy: do not drop columns in default downgrade path.
    pass
