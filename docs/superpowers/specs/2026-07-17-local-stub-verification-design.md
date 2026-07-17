# Local stub verification DX

**Date:** 2026-07-17  
**Status:** Approved for implementation

## Problem

Real LINE / LIFF login cannot target `localhost` (Endpoint URL is the deployed HTTPS host).
The existing paired stub (`stub:<id>` + `LINE_VERIFY_MODE=stub`) is correct in principle but
easy to misconfigure: Compose hostnames in `.env.example`, LIFF id copied into local env,
backend left on `line` mode, and weak discoverability.

## Goals

- One documented host-local path that works without LINE Developers.
- Infra (Postgres + SeaweedFS) via Compose; app (Next + FastAPI) via `npm run dev`.
- Fail-fast, actionable errors when FE/BE stub modes disagree.
- Simple in-browser persona switcher for role testing.

## Non-goals

- Password / built-in staff SSO
- Defaulting Compose FE/BE or K8s to stub
- Playwright e2e suite
- Auto-starting infra inside `npm run dev`

## Architecture

```text
npm run dev:infra  →  Postgres :5432 + SeaweedFS S3 :8333
npm run dev        →  Next :3000 + uvicorn :8000  (host processes)
/dev/personas      →  clear session → /login?dev_line_user_id=…  (stub tokens)
```

Auth remains the existing LIFF bypass + `LineIdentityProvider` stub mode.

## Components

1. **`npm run dev:infra`** — Compose up postgres + seaweedfs-* only.
2. **`apps/backend/.env.local.example`** — `127.0.0.1` DB/S3 + `LINE_VERIFY_MODE=stub`.
3. **`apps/frontend/.env.local.example`** — LIFF unset + `/api` proxy.
4. **Mismatch messages** in `line_provider.py` for stub↔line token mismatches.
5. **`/dev/personas`** — stub-only UI; login page link when bypass active.
6. **Docs** — README, AGENTS, `docs/ops/local-dev-without-line.md`, docs index.

## Security

- Stub and `/dev/personas` only when `NODE_ENV=development` and `NEXT_PUBLIC_LIFF_ID` unset.
- Never enable `LINE_VERIFY_MODE=stub` outside host-local development.
