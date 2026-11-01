"""preserve authorization audit history when target identity is deleted (non-destructive)

Revision ID: 20261101_08
Revises: 20260821_07
Create Date: 2026-11-01 10:00:00

authorization_audit_events.target_identity_id used ON DELETE CASCADE, so the admin
user-management hard delete erased the authorization history of the user being removed.
Switch the FK to SET NULL and denormalize the target LINE user id so the row stays
readable after the identity is gone.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20261101_08"
down_revision = "20260821_07"
branch_labels = None
depends_on = None

TABLE_NAME = "authorization_audit_events"
NEW_FK_NAME = "fk_authorization_audit_events_target_identity_id"


def _existing_table() -> sa.Table:
    """Pre-migration shape, used as batch_alter_table copy_from so SQLite rebuilds exactly."""
    return sa.Table(
        TABLE_NAME,
        sa.MetaData(),
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "actor_identity_id",
            sa.Integer(),
            sa.ForeignKey("liff_identities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_role", sa.String(length=32), nullable=False),
        sa.Column(
            "target_identity_id",
            sa.Integer(),
            sa.ForeignKey("liff_identities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("target_line_user_id", sa.String(length=128), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("before_value", sa.Text(), nullable=True),
        sa.Column("after_value", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if TABLE_NAME not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if "target_line_user_id" not in columns:
        op.add_column(TABLE_NAME, sa.Column("target_line_user_id", sa.String(length=128), nullable=True))

    # Backfill existing rows while their target identities are still present.
    op.execute(
        sa.text(
            f"""
            UPDATE {TABLE_NAME}
            SET target_line_user_id = (
                SELECT line_user_id
                FROM liff_identities
                WHERE liff_identities.id = {TABLE_NAME}.target_identity_id
            )
            WHERE target_line_user_id IS NULL
            """
        )
    )

    if bind.dialect.name == "sqlite":
        # SQLite cannot alter a constraint in place; batch_alter_table rebuilds the table.
        with op.batch_alter_table(TABLE_NAME, copy_from=_existing_table()) as batch:
            batch.alter_column("target_identity_id", existing_type=sa.Integer(), nullable=True)
        return

    for foreign_key in inspector.get_foreign_keys(TABLE_NAME):
        if foreign_key.get("constrained_columns") == ["target_identity_id"] and foreign_key.get("name"):
            op.drop_constraint(foreign_key["name"], TABLE_NAME, type_="foreignkey")

    op.alter_column(TABLE_NAME, "target_identity_id", existing_type=sa.Integer(), nullable=True)
    op.create_foreign_key(
        NEW_FK_NAME,
        TABLE_NAME,
        "liff_identities",
        ["target_identity_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Non-destructive policy: rolling back would re-arm the cascade that deletes audit history.
    pass
