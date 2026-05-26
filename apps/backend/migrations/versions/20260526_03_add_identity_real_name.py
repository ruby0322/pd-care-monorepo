"""add real_name to liff_identities (non-destructive)

Revision ID: 20260526_03
Revises: 20260526_02
Create Date: 2026-05-26 17:12:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "20260526_03"
down_revision = "20260526_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("liff_identities")}
    if "real_name" not in columns:
        op.add_column("liff_identities", sa.Column("real_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    # Non-destructive policy: do not drop columns in default downgrade path.
    pass
