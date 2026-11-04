"""add annotations.updated_at so re-labelling counts as review activity (non-destructive)

Revision ID: 20261101_09
Revises: 20261101_08
Create Date: 2026-11-01 12:00:00

upsert_annotation_for_upload updates label/comment on the existing row and never
touched created_at, so a reviewer who only re-labels existing uploads looked dormant
in the staff roster's recency and rolling-window figures. Recency now reads
COALESCE(updated_at, created_at); the column is nullable so pre-existing rows keep
falling back to created_at without a backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261101_09"
down_revision = "20261101_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "annotations" not in set(inspector.get_table_names()):
        return
    columns = {column["name"] for column in inspector.get_columns("annotations")}
    if "updated_at" not in columns:
        op.add_column("annotations", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    pass
