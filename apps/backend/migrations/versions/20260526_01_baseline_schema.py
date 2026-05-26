"""baseline schema (non-destructive)

Revision ID: 20260526_01
Revises:
Create Date: 2026-05-26 16:35:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260526_01"
down_revision = None
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    indexes = inspect(bind).get_indexes(table_name)
    return any(index["name"] == index_name for index in indexes)


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str], *, unique: bool = False) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    if not _has_table("patients"):
        op.create_table(
            "patients",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("case_number", sa.String(length=64), nullable=False),
            sa.Column("birth_date", sa.String(length=16), nullable=False),
            sa.Column("full_name", sa.String(length=255), nullable=True),
            sa.Column("gender", sa.String(length=16), nullable=False, server_default="unknown"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("case_number", "birth_date", name="uq_patients_case_birth"),
        )
    _create_index_if_missing("patients", "ix_patients_case_number", ["case_number"])

    if not _has_table("liff_identities"):
        op.create_table(
            "liff_identities",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("line_user_id", sa.String(length=128), nullable=False),
            sa.Column("display_name", sa.String(length=255), nullable=True),
            sa.Column("picture_url", sa.String(length=1024), nullable=True),
            sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="SET NULL"), nullable=True),
            sa.Column("role", sa.String(length=32), nullable=False, server_default="patient"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("line_user_id", name="uq_liff_identities_line_user_id"),
        )
    _create_index_if_missing("liff_identities", "ix_liff_identities_line_user_id", ["line_user_id"])

    if not _has_table("pending_bindings"):
        op.create_table(
            "pending_bindings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("line_user_id", sa.String(length=128), nullable=False),
            sa.Column("case_number", sa.String(length=64), nullable=False),
            sa.Column("birth_date", sa.String(length=16), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    _create_index_if_missing("pending_bindings", "ix_pending_bindings_line_user_id", ["line_user_id"])

    if not _has_table("staff_patient_assignments"):
        op.create_table(
            "staff_patient_assignments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "staff_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("staff_identity_id", "patient_id", name="uq_staff_patient_assignment"),
        )
    _create_index_if_missing("staff_patient_assignments", "ix_staff_patient_assignments_staff_identity_id", ["staff_identity_id"])
    _create_index_if_missing("staff_patient_assignments", "ix_staff_patient_assignments_patient_id", ["patient_id"])

    if not _has_table("uploads"):
        op.create_table(
            "uploads",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
            sa.Column("object_key", sa.String(length=512), nullable=False),
            sa.Column("content_type", sa.String(length=128), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    _create_index_if_missing("uploads", "ix_uploads_patient_id", ["patient_id"])

    if not _has_table("ai_results"):
        op.create_table(
            "ai_results",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("upload_id", sa.Integer(), sa.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False),
            sa.Column("predicted_class", sa.String(length=64), nullable=True),
            sa.Column("probability", sa.Float(), nullable=True),
            sa.Column("threshold", sa.Float(), nullable=True),
            sa.Column("screening_result", sa.String(length=32), nullable=False),
            sa.Column("model_version", sa.String(length=128), nullable=True),
            sa.Column("error_reason", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("upload_id", name="uq_ai_results_upload_id"),
        )

    if not _has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
            sa.Column("upload_id", sa.Integer(), sa.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False),
            sa.Column("ai_result_id", sa.Integer(), sa.ForeignKey("ai_results.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="new"),
            sa.Column("summary", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    _create_index_if_missing("notifications", "ix_notifications_patient_id", ["patient_id"])
    _create_index_if_missing("notifications", "ix_notifications_upload_id", ["upload_id"])

    if not _has_table("annotations"):
        op.create_table(
            "annotations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
            sa.Column("upload_id", sa.Integer(), sa.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False),
            sa.Column(
                "reviewer_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("label", sa.String(length=64), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("patient_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    _create_index_if_missing("annotations", "ix_annotations_patient_id", ["patient_id"])
    _create_index_if_missing("annotations", "ix_annotations_upload_id", ["upload_id"])

    if not _has_table("healthcare_access_requests"):
        op.create_table(
            "healthcare_access_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "requester_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("reject_reason", sa.Text(), nullable=True),
            sa.Column("decision_role", sa.String(length=32), nullable=True),
            sa.Column(
                "decided_by_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        )
    _create_index_if_missing("healthcare_access_requests", "ix_healthcare_access_requests_requester_identity_id", ["requester_identity_id"])
    _create_index_if_missing("healthcare_access_requests", "ix_healthcare_access_requests_status", ["status"])

    if not _has_table("authorization_audit_events"):
        op.create_table(
            "authorization_audit_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("actor_identity_id", sa.Integer(), sa.ForeignKey("liff_identities.id", ondelete="SET NULL"), nullable=True),
            sa.Column("actor_role", sa.String(length=32), nullable=False),
            sa.Column(
                "target_identity_id",
                sa.Integer(),
                sa.ForeignKey("liff_identities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("before_value", sa.Text(), nullable=True),
            sa.Column("after_value", sa.Text(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    # Non-destructive policy: baseline migration intentionally does not drop existing data/tables.
    pass
