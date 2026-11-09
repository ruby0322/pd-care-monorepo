"""add copilot_modules (non-destructive)

Revision ID: 20261105_12
Revises: 20261105_11
Create Date: 2026-11-05 10:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261105_12"
down_revision = "20261105_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if "copilot_modules" not in tables:
        op.create_table(
            "copilot_modules",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "owner_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("html", sa.Text(), nullable=False),
            sa.Column("visibility", sa.String(length=16), nullable=False, server_default="private"),
            sa.Column(
                "source_session_id",
                sa.Integer(),
                sa.ForeignKey("copilot_sessions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "source_message_id",
                sa.Integer(),
                sa.ForeignKey("copilot_messages.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_copilot_modules_owner_identity_id", "copilot_modules", ["owner_identity_id"])
        op.create_index("ix_copilot_modules_visibility", "copilot_modules", ["visibility"])


def downgrade() -> None:
    pass
