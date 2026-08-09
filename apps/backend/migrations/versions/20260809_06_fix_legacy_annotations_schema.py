"""fix legacy annotations schema that still requires staff_user_id

Revision ID: 20260809_06
Revises: 20260717_05
Create Date: 2026-08-09 13:55:00
"""

# allow-destructive-migration: legacy local SQLite compatibility repair

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260809_06"
down_revision = "20260717_05"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = inspect(bind)
    try:
        return {column["name"] for column in inspector.get_columns(table_name)}
    except Exception:
        return set()


def upgrade() -> None:
    # Legacy local SQLite snapshots may keep annotations.staff_user_id (NOT NULL),
    # which breaks current write path that uses reviewer_identity_id.
    table_names = set(inspect(op.get_bind()).get_table_names())
    if "annotations" not in table_names:
        return
    columns = _column_names("annotations")
    if "staff_user_id" not in columns:
        return

    bind = op.get_bind()

    unresolved_rows = bind.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM annotations
            WHERE reviewer_identity_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM liff_identities
                WHERE liff_identities.id = annotations.staff_user_id
              )
            """
        )
    ).scalar()
    if unresolved_rows and int(unresolved_rows) > 0:
        raise RuntimeError(
            "Cannot migrate annotations rows with NULL reviewer_identity_id "
            "and unmatched staff_user_id in liff_identities."
        )

    op.create_table(
        "annotations_v2",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("upload_id", sa.Integer(), sa.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_identity_id", sa.Integer(), sa.ForeignKey("liff_identities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("patient_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO annotations_v2 (
                id, patient_id, upload_id, reviewer_identity_id, label, comment, patient_read_at, created_at
            )
            SELECT
                id,
                patient_id,
                upload_id,
                COALESCE(reviewer_identity_id, staff_user_id),
                label,
                comment,
                patient_read_at,
                created_at
            FROM annotations
            """
        )
    )

    op.drop_table("annotations")
    op.rename_table("annotations_v2", "annotations")
    op.create_index("ix_annotations_patient_id", "annotations", ["patient_id"])
    op.create_index("ix_annotations_upload_id", "annotations", ["upload_id"])


def downgrade() -> None:
    # Non-destructive policy: no automatic rollback for compatibility migration.
    pass
