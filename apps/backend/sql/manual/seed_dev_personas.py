#!/usr/bin/env python3
"""Seed canonical dev personas for verifying login/onboarding flows without a real LINE account.

Pair with LINE_VERIFY_MODE=stub (apps/backend/.env) and the frontend dev bypass
(apps/frontend/.env.local, see apps/frontend/.env.local.example): the frontend then sends
`stub:<line_user_id>` id tokens that this script's seeded rows resolve against.

See docs/ops/local-dev-without-line.md for the full verification workflow.

Manual only; not run by app/tests. Run from repo root or apps/backend:

    cd apps/backend && python sql/manual/seed_dev_personas.py

Requires DATABASE_URL (loads apps/backend/.env when python-dotenv is installed).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.migrations import upgrade_database
from app.db.models import LiffIdentity, Patient, PendingBinding
from app.db.session import create_engine_from_url, create_session_factory

# Bindable patient record used by U_DEV_NEW to exercise a successful bind (case number + birth
# date match, no prior liff_identities row).
BINDABLE_CASE_NUMBER = "P-DEV-BIND-001"
BINDABLE_BIRTH_DATE = "1990-01-01"

# Patient record already matched to U_DEV_PAT_MATCH.
MATCHED_CASE_NUMBER = "P-DEV-MATCH-001"
MATCHED_BIRTH_DATE = "1988-03-20"

# Case number used for U_DEV_PAT_PEND's outstanding pending_bindings row (intentionally has no
# matching patients row, so the bind stays pending).
PENDING_CASE_NUMBER = "P-DEV-PENDING-001"
PENDING_BIRTH_DATE = "1975-11-11"

# Patient record backing U_DEV_DUAL's matched patient identity.
DUAL_CASE_NUMBER = "P-DEV-DUAL-001"
DUAL_BIRTH_DATE = "1970-07-07"

DEV_LINE_USER_IDS = (
    "U_DEV_PAT_PEND",
    "U_DEV_PAT_MATCH",
    "U_DEV_STAFF",
    "U_DEV_ADMIN",
    "U_DEV_DUAL",
)


def _clear_existing(session: Session) -> None:
    session.execute(delete(LiffIdentity).where(LiffIdentity.line_user_id.in_(DEV_LINE_USER_IDS)))
    session.execute(delete(PendingBinding).where(PendingBinding.line_user_id.in_(DEV_LINE_USER_IDS)))
    session.execute(
        delete(Patient).where(
            Patient.case_number.in_((BINDABLE_CASE_NUMBER, MATCHED_CASE_NUMBER, DUAL_CASE_NUMBER))
        )
    )


def _seed(session: Session) -> None:
    # Bindable patient (no identity yet) — used by U_DEV_NEW's manual bind form.
    session.add(
        Patient(
            case_number=BINDABLE_CASE_NUMBER,
            birth_date=BINDABLE_BIRTH_DATE,
            full_name="Dev Bindable Patient",
            is_active=True,
        )
    )

    # Matched patient + identity for U_DEV_PAT_MATCH.
    matched_patient = Patient(
        case_number=MATCHED_CASE_NUMBER,
        birth_date=MATCHED_BIRTH_DATE,
        full_name="Dev Matched Patient",
        is_active=True,
    )
    session.add(matched_patient)
    session.flush()

    session.add(
        LiffIdentity(
            line_user_id="U_DEV_PAT_MATCH",
            display_name="Dev Matched Patient",
            picture_url=None,
            patient_id=matched_patient.id,
            role="patient",
            is_active=True,
        )
    )

    # Patient identity with an outstanding pending binding (never matched).
    session.add(
        LiffIdentity(
            line_user_id="U_DEV_PAT_PEND",
            display_name="Dev Pending Patient",
            picture_url=None,
            patient_id=None,
            role="patient",
            is_active=False,
        )
    )
    session.add(
        PendingBinding(
            line_user_id="U_DEV_PAT_PEND",
            case_number=PENDING_CASE_NUMBER,
            birth_date=PENDING_BIRTH_DATE,
            status="pending",
        )
    )

    # Staff-only identity: routes through /apps with only the admin card.
    session.add(
        LiffIdentity(
            line_user_id="U_DEV_STAFF",
            display_name="Dev Staff",
            picture_url=None,
            patient_id=None,
            role="staff",
            is_active=True,
        )
    )

    # Admin-only identity: routes through /apps or directly to /admin.
    session.add(
        LiffIdentity(
            line_user_id="U_DEV_ADMIN",
            display_name="Dev Admin",
            picture_url=None,
            patient_id=None,
            role="admin",
            is_active=True,
        )
    )

    # Dual-role identity: admin also bound to a patient record, so /apps shows both cards.
    dual_patient = Patient(
        case_number=DUAL_CASE_NUMBER,
        birth_date=DUAL_BIRTH_DATE,
        full_name="Dev Dual-Role Patient",
        is_active=True,
    )
    session.add(dual_patient)
    session.flush()
    session.add(
        LiffIdentity(
            line_user_id="U_DEV_DUAL",
            display_name="Dev Dual-Role Admin",
            picture_url=None,
            patient_id=dual_patient.id,
            role="admin",
            is_active=True,
        )
    )


_SUMMARY_ROWS: list[tuple[str, str, str]] = [
    ("(none) U_DEV_NEW", "no liff_identities row", "landing -> role-select -> patient/admin onboarding"),
    ("U_DEV_PAT_PEND", "patient, inactive + pending_bindings", "patient '等待護理師審核' screen"),
    ("U_DEV_PAT_MATCH", f"patient, matched to {MATCHED_CASE_NUMBER}", "patient dashboard after login"),
    ("U_DEV_STAFF", "staff, active", "staff login -> /apps (admin card only)"),
    ("U_DEV_ADMIN", "admin, active", "admin login -> /apps or /admin"),
    ("U_DEV_DUAL", "admin, active + matched patient", "/apps shows both cards"),
]


def _print_summary() -> None:
    print("\nDev personas ready. Use ?dev_line_user_id=<id> or set NEXT_PUBLIC_DEV_LINE_USER_ID:\n")
    for line_user_id, state, purpose in _SUMMARY_ROWS:
        print(f"  {line_user_id:<20} {state:<45} {purpose}")
    print(f"\nBindable patient for U_DEV_NEW: case_number={BINDABLE_CASE_NUMBER} birth_date={BINDABLE_BIRTH_DATE}")
    print("See docs/ops/local-dev-without-line.md for the full workflow.\n")


def main() -> int:
    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env")

    # Prefer PDCARE_DATABASE_URL to avoid accidentally seeding local sqlite when docker
    # stacks use a dedicated compose variable namespace.
    database_url = os.getenv("PDCARE_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        print(
            "Neither PDCARE_DATABASE_URL nor DATABASE_URL is set. "
            "Set one of them or put it in apps/backend/.env",
            file=sys.stderr,
        )
        return 1

    print(f"Using database URL: {database_url}")
    engine = create_engine_from_url(database_url)
    upgrade_database(str(engine.url))
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        try:
            _clear_existing(session)
            _seed(session)
            session.commit()
        except Exception:
            session.rollback()
            raise

    _print_summary()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
