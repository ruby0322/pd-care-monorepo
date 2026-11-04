"""add copilot_sessions and copilot_messages (non-destructive)

Revision ID: 20261104_10
Revises: 20261101_09
Create Date: 2026-11-04 21:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261104_10"
down_revision = "20261101_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())

    if "copilot_sessions" not in tables:
        op.create_table(
            "copilot_sessions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "owner_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="新對話"),
            sa.Column("model", sa.String(length=128), nullable=False),
            sa.Column("visibility", sa.String(length=16), nullable=False, server_default="private"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_copilot_sessions_owner_identity_id", "copilot_sessions", ["owner_identity_id"])
        op.create_index("ix_copilot_sessions_visibility", "copilot_sessions", ["visibility"])

    if "copilot_messages" not in tables:
        op.create_table(
            "copilot_messages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "session_id",
                sa.Integer(),
                sa.ForeignKey("copilot_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("role", sa.String(length=16), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("model", sa.String(length=128), nullable=True),
            sa.Column("tool_trace", sa.Text(), nullable=True),
            sa.Column("prompt_tokens", sa.Integer(), nullable=True),
            sa.Column("completion_tokens", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_copilot_messages_session_id", "copilot_messages", ["session_id"])


def downgrade() -> None:
    pass
