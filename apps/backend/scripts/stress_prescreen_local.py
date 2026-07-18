#!/usr/bin/env python3
"""Stress-test POST /v1/patient/prescreen against a running local backend.

Usage (backend must already be up on BASE_URL, typically npm run dev:backend):

  cd apps/backend
  set -a && . ./.env && set +a
  .venv/bin/python scripts/stress_prescreen_local.py
  .venv/bin/python scripts/stress_prescreen_local.py --concurrency 10 --rounds 3
"""

from __future__ import annotations

import argparse
import io
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

load_dotenv(_BACKEND_ROOT / ".env")

from app.core.config import get_settings
from app.db.models import LiffIdentity, Patient
from app.db.session import create_engine_from_url, create_session_factory
from app.services.auth.token_service import AuthTokenService


def _make_jpeg_bytes() -> bytes:
    image = Image.new("RGB", (384, 384), color=(120, 80, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=60)
    return buffer.getvalue()


def _ensure_patients(session_factory, count: int) -> list[str]:
    tokens: list[str] = []
    settings = get_settings()
    token_service = AuthTokenService(secret=settings.auth_token_secret)

    with session_factory() as session:
        for i in range(count):
            line_user_id = f"U_STRESS_LOCAL_{i:02d}"
            case_number = f"P-STRESS-LOCAL-{i:02d}"
            identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == line_user_id).one_or_none()
            if identity is None:
                patient = Patient(
                    case_number=case_number,
                    birth_date="1985-06-15",
                    full_name=f"Stress Patient {i:02d}",
                    is_active=True,
                )
                session.add(patient)
                session.flush()
                identity = LiffIdentity(
                    line_user_id=line_user_id,
                    display_name=f"Stress {i:02d}",
                    picture_url=None,
                    patient_id=patient.id,
                )
                session.add(identity)
                session.flush()
            tokens.append(
                token_service.issue_token(
                    identity_id=identity.id,
                    line_user_id=identity.line_user_id,
                    role="patient",
                    patient_id=identity.patient_id,
                    ttl_seconds=settings.auth_token_ttl_seconds,
                )
            )
        session.commit()
    return tokens


def _post_prescreen(
    client: httpx.Client,
    *,
    base_url: str,
    token: str,
    payload: bytes,
) -> tuple[float, int, dict | None]:
    t0 = time.perf_counter()
    response = client.post(
        f"{base_url.rstrip('/')}/v1/patient/prescreen",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("frame.jpg", payload, "image/jpeg")},
        timeout=30.0,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    body = None
    try:
        body = response.json()
    except Exception:
        body = None
    return elapsed_ms, response.status_code, body


def main() -> int:
    parser = argparse.ArgumentParser(description="Stress-test local prescreen API")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--rounds", type=int, default=1, help="Repeat burst count")
    parser.add_argument("--gap-seconds", type=float, default=0.0, help="Sleep between rounds")
    args = parser.parse_args()

    settings = get_settings()
    engine = create_engine_from_url(settings.database_url)
    session_factory = create_session_factory(engine)
    tokens = _ensure_patients(session_factory, args.concurrency)
    payload = _make_jpeg_bytes()

    ready = httpx.get(f"{args.base_url.rstrip('/')}/readyz", timeout=10.0)
    ready.raise_for_status()
    print("readyz:", ready.json())
    print(f"stress: concurrency={args.concurrency} rounds={args.rounds} base={args.base_url}")
    print()

    all_times: list[float] = []
    all_statuses: list[int] = []
    checked_true = 0
    checked_false = 0
    errors = 0

    with httpx.Client() as client:
        for round_idx in range(args.rounds):
            t_wall0 = time.perf_counter()
            round_results: list[tuple[float, int, dict | None]] = []

            with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                futures = [
                    executor.submit(
                        _post_prescreen,
                        client,
                        base_url=args.base_url,
                        token=tokens[i],
                        payload=payload,
                    )
                    for i in range(args.concurrency)
                ]
                for future in as_completed(futures):
                    round_results.append(future.result())

            wall_ms = (time.perf_counter() - t_wall0) * 1000
            times = [r[0] for r in round_results]
            statuses = [r[1] for r in round_results]
            all_times.extend(times)
            all_statuses.extend(statuses)

            for _elapsed, status, body in round_results:
                if status != 200:
                    errors += 1
                    continue
                if body and body.get("checked") is True:
                    checked_true += 1
                elif body and body.get("checked") is False:
                    checked_false += 1

            print(
                f"round {round_idx + 1}: wall={wall_ms:.0f}ms "
                f"p50={statistics.median(times):.0f} max={max(times):.0f} "
                f"statuses={statuses}"
            )
            if args.gap_seconds > 0 and round_idx + 1 < args.rounds:
                time.sleep(args.gap_seconds)

    print()
    print("=== summary ===")
    print(f"requests={len(all_times)} p50={statistics.median(all_times):.0f}ms max={max(all_times):.0f}ms")
    print(f"http_200={sum(1 for s in all_statuses if s == 200)} http_429={sum(1 for s in all_statuses if s == 429)} other_errors={errors - sum(1 for s in all_statuses if s == 429)}")
    print(f"checked_true={checked_true} checked_false={checked_false}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
