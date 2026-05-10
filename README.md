# PD Care Monorepo

PD Care is a peritoneal dialysis exit-site imaging and infection alert system. This repository contains the patient-facing frontend and the backend inference API used to screen uploaded images and support healthcare review workflows.

## Quick Start

Start the frontend and backend together from the repository root:

```bash
npm run dev
```

The root `npm run dev` command starts both servers at the same time and prefixes log lines with color-coded `FRONTEND` and `BACKEND` labels.

For focused development, use the app-specific commands in the `Applications` section below.

## Root Commands

```bash
npm run dev:frontend
npm run dev:backend
npm run dev
npm run build
npm run lint
npm run test
npm run docker:up
npm run docker:down
```

## Product Overview

### Objective

- Standardize exit-site image capture for peritoneal dialysis patients.
- Provide AI-assisted infection risk alerts while leaving diagnosis to physicians.
- Build a reviewable image database for clinical follow-up and research.

### User Roles

| Role | Scope | Key Requirements |
|------|-------|------------------|
| Patient | Capture images and receive alerts | Guided camera UI, alignment prompts, image upload |
| Healthcare staff | Review images and model outputs | Image history, filtering, manual annotation, alert follow-up |
| Backend admin | Operate the system | User management, model versioning, data access control |

### Workflow

1. Patients capture an image with guidance to keep the exit site aligned, visible, and well lit.
2. The backend performs upload validation and image screening.
3. If validation passes, the model returns an infection screening result for staff review.
4. Staff can review history, annotations, alerts, and exported data in the administrative workflow.

## Repository Layout

```text
apps/
  backend/   FastAPI inference API
  frontend/  Next.js application
docker-compose.yml
package.json
README.md
```

## Applications

### Frontend

The frontend is a Next.js app for patient capture and the broader PD Care web experience.

- Runs locally at `http://localhost:3000`
- Supports local API configuration through `NEXT_PUBLIC_API_BASE_URL`
- Uses the monorepo root scripts or `apps/frontend` scripts for development

`NEXT_PUBLIC_API_BASE_URL` guidance:

- Local direct backend access: `http://localhost:8000`
- Reverse-proxy / same-origin production (recommended): `/api`
- External dedicated API domain: `https://api.example.com`

Start from the monorepo root:

```bash
npm run dev:frontend
```

Or run it directly:

```bash
cd apps/frontend
npm install
npm run dev
```

### Backend

The backend is a FastAPI inference service that serves the production PyTorch checkpoint and exposes screening endpoints.

- Accepts `multipart/form-data` image uploads
- Downloads the model on startup when `MODEL_PATH` is missing
- Supports GPU-aware runtime with `DEVICE=auto`
- Includes health and readiness probes
- Returns both multiclass probabilities and binary infection screening output

Local development:

```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements-dev.txt
cp .env.example .env
set -a
. ./.env
set +a
python3 -m uvicorn app.main:app --reload
```

Important backend environment variables:

- `MODEL_URL`: checkpoint download URL
- `MODEL_PATH`: local checkpoint path
- `DEVICE`: `auto`, `cuda`, or `cpu`
- `THRESHOLD`: infection screening threshold
- `MAX_UPLOAD_MB`: maximum upload size
- `MODEL_BACKBONE`: fallback backbone for `state_dict` reconstruction
- `MODEL_ARCH`: fallback architecture when `MODEL_BACKBONE=none`

## Docker Compose

The root `docker-compose.yml` starts:

- `frontend` on `http://localhost:3000`
- `backend` on `http://localhost:8000`

Bring the full stack up with:

```bash
npm run docker:up
```

Or start a single service:

```bash
npm run docker:up:frontend
npm run docker:up:backend
```

The compose file loads backend defaults from `apps/backend/.env.example`. If you need local overrides, copy that file to `apps/backend/.env` and update your local workflow as needed.

The default compose file now works on CPU-only hosts. The backend still honors `DEVICE=auto`, so it will use CUDA automatically when GPU access is available and fall back to CPU otherwise.

To require the legacy NVIDIA runtime on a GPU host, include the GPU override file:

```bash
npm run docker:up:gpu
```

If your host only has deprecated `docker-compose` v1 and you hit `KeyError: 'ContainerConfig'` while recreating containers, use the same fallback the npm scripts use:

```bash
docker-compose down --remove-orphans
docker-compose up --build
```

That override expects:

- NVIDIA drivers must be installed on the host
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) must be configured
- Docker Compose must be able to launch the service with the NVIDIA runtime

## Backend API

### Health Endpoints

```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/readyz
```

### Predict

```bash
curl -X POST http://127.0.0.1:8000/v1/predict \
  -H "accept: application/json" \
  -F "file=@/path/to/image.jpg;type=image/jpeg"
```

Example response shape:

```json
{
  "predicted_class_index": 4,
  "predicted_class_name": "class_4",
  "predicted_probability": 0.97,
  "class_probabilities": [
    { "class_index": 0, "class_name": "class_0", "probability": 0.01 }
  ],
  "screening": {
    "infection_class_index": 4,
    "infection_class_name": "class_4",
    "infection_probability": 0.97,
    "threshold": 0.5,
    "is_infection_positive": true
  }
}
```

## Model Notes

The backend is designed around the current production checkpoint and training setup:

- 5 output classes: `class_0` through `class_4`
- `class_4` is the infection-positive class
- preprocessing uses `Resize(384) -> CenterCrop(384) -> ToTensor() -> ImageNet normalize`

If a future checkpoint is exported as a plain `state_dict`, set `MODEL_BACKBONE` and related fallback environment variables correctly so the service can reconstruct the model before loading weights.

## Sources

- [Training repository](https://github.com/ruby0322/ntuh-pd-exit-site-classification)
- [Model repository](https://huggingface.co/ruby0322/pd-exit-site-classification)
- [Next.js Documentation](https://nextjs.org/docs)
