#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"
UVICORN_HOST="${UVICORN_HOST:-0.0.0.0}"
UVICORN_PORT="${UVICORN_PORT:-8000}"
UVICORN_WORKERS="${UVICORN_WORKERS:-1}"

if [ "${RUN_DB_MIGRATIONS:-true}" != "false" ]; then
  "${PYTHON_BIN}" -m alembic -c alembic.ini upgrade head
fi
exec "${PYTHON_BIN}" -m uvicorn app.main:app --host "${UVICORN_HOST}" --port "${UVICORN_PORT}" --workers "${UVICORN_WORKERS}"
