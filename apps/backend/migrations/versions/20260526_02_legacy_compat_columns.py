"""legacy compatibility columns (non-destructive)

Revision ID: 20260526_02
Revises: 20260526_01
Create Date: 2026-05-26 16:36:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

# revision identifiers, used by Alembic.
revision = "20260526_02"
down_revision = "20260526_01"
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
    # Historical compatibility fields that were previously managed by startup-time ALTER TABLE helpers.
    if _has_column("liff_identities", "role") is False:
        op.add_column(
            "liff_identities",
            sa.Column("role", sa.String(length=32), nullable=False, server_default="patient"),
        )
    if _has_column("liff_identities", "is_active") is False:
        op.add_column(
            "liff_identities",
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        )
    if _has_column("patients", "gender") is False:
        op.add_column(
            "patients",
            sa.Column("gender", sa.String(length=16), nullable=False, server_default="unknown"),
        )
    if _has_column("annotations", "reviewer_identity_id") is False:
        op.add_column(
            "annotations",
            sa.Column("reviewer_identity_id", sa.Integer(), nullable=True),
        )
        # Keep non-destructive behavior: backfill/constraint hardening is environment-specific and can be done in a later revision.
    if _has_column("annotations", "patient_read_at") is False:
        op.add_column("annotations", sa.Column("patient_read_at", sa.DateTime(timezone=True), nullable=True))

    # Equivalent to previous "drop not null" compatibility step; no-op if column does not exist.
    if _has_column("annotations", "staff_user_id"):
        bind = op.get_bind()
        if bind.dialect.name == "postgresql":
            op.execute(text("ALTER TABLE annotations ALTER COLUMN staff_user_id DROP NOT NULL"))


def downgrade() -> None:
    # Non-destructive policy: compatibility revision intentionally avoids dropping columns.
    pass
