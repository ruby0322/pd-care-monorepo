"""add copilot_identity_handles (non-destructive)

Revision ID: 20261105_11
Revises: 20261104_10
Create Date: 2026-11-05 09:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261105_11"
down_revision = "20261104_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if "copilot_identity_handles" not in tables:
        op.create_table(
            "copilot_identity_handles",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "session_id",
                sa.Integer(),
                sa.ForeignKey("copilot_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("handle", sa.String(length=32), nullable=False),
            sa.Column("entity_type", sa.String(length=32), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("session_id", "handle", name="uq_copilot_identity_handles_session_handle"),
            sa.UniqueConstraint(
                "session_id", "entity_type", "entity_id", name="uq_copilot_identity_handles_session_entity"
            ),
        )
        op.create_index("ix_copilot_identity_handles_session_id", "copilot_identity_handles", ["session_id"])


def downgrade() -> None:
    pass
