"""add onboarding_guide_dismissed_at to liff_identities (non-destructive)

Revision ID: 20260821_07
Revises: 20260809_06
Create Date: 2026-08-21 17:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260821_07"
down_revision = "20260809_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("liff_identities")}
    if "onboarding_guide_dismissed_at" not in columns:
        op.add_column(
            "liff_identities",
            sa.Column("onboarding_guide_dismissed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    pass
