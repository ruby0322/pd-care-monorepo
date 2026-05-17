# Agent Test Execution Policy

## Goal
Reduce wasted development time by avoiding long, repeated test runs during implementation.

## Rules
- Do not run independent test commands during normal implementation work.
- Only run tests when one of these conditions is true:
  - The user explicitly asks to run tests.
  - The agent is in final verification right before commit or push.
  - A commit/push hook triggers the checks.
- Prefer lightweight validation during development (for example, syntax checks or focused lint) when needed.

## Examples
- Forbidden during coding loop: `npm test`, `pytest`, `go test ./...` without user request.
- Allowed near integration step: run project test suite once as part of pre-commit/pre-push verification.

## Cursor Cloud specific instructions

### Services overview

| Service | How to run | Port |
|---------|-----------|------|
| Frontend (Next.js) | `npm run dev:frontend` from repo root | 3000 |
| Backend (FastAPI) | `npm run dev:backend` from repo root | 8000 |
| PostgreSQL | `docker compose up -d postgres` | 5432 |
| SeaweedFS (S3) | `docker compose up -d seaweedfs-master seaweedfs-volume seaweedfs-filer seaweedfs-s3` | 8333 |

All standard commands are in root `package.json`: `npm run dev`, `npm run lint`, `npm run test`, `npm run build`.

### Key caveats

- **Docker required**: Postgres and SeaweedFS run via `docker compose`. Start the daemon with `sudo dockerd &` if not running, then `docker compose up -d postgres seaweedfs-master seaweedfs-volume seaweedfs-filer seaweedfs-s3`.
- **Backend `.env`**: Copy `apps/backend/.env.example` to `apps/backend/.env` and change hostnames from container names to `localhost` (e.g. `postgres` → `localhost`, `seaweedfs-s3` → `localhost`).
- **MODEL_BACKBONE**: Must be set to `mobilenet_v3_large` for the production checkpoint (`model_e41_production_best.pt`).
- **MODEL_URL**: The correct HuggingFace URL is `https://huggingface.co/ruby0322/pd-exit-site-classification/resolve/main/model_e41_production_best.pt`.
- **Postgres password sync**: If Docker volumes already exist from a prior session, the password set in compose won't override. Reset with: `docker exec <postgres-container> psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'pdcare-local-dev-change-me';"`.
- **CPU-only PyTorch**: For Cloud Agent VMs without GPU, install torch/torchvision from the CPU index (`--extra-index-url https://download.pytorch.org/whl/cpu`) and set `DEVICE=cpu` in `.env`.
- **NEXT_PUBLIC_LIFF_ID**: Set to `1657724367-uzPg8SgK` when running the frontend locally (pass as env var or add to `apps/frontend/.env.local`).
- **LIFF endpoint URL**: The LIFF app's endpoint is `https://pd.lu.im.ntu.edu.tw/patient`. LINE's OAuth only accepts redirect URIs under that domain. For local dev LINE login, either update the LIFF endpoint URL in LINE Developers Console to your tunnel URL, or access the app from the production domain.
- **Backend env priority**: When injected secrets exist (e.g. `LINE_CHANNEL_ID`, `PILOT_ADMIN_IDENTITY_IDS`), do NOT set those in `apps/backend/.env` or they will be overridden to empty values. Remove from `.env` any variable that comes from injected secrets.
- **Pre-commit/pre-push hooks**: Both run `npm run lint` (ESLint on frontend). Use `--no-verify` to bypass.
- **Frontend builds fine standalone**: `npm run build` compiles the Next.js app without needing a running backend.

