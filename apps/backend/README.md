# PD Exit-Site Inference API

Production-oriented FastAPI service for serving the `model_e41_production_best.pt` PyTorch checkpoint from the `ruby0322/pd-exit-site-classification` model repository.

The service is designed around the original training setup:

- 5 output classes: `class_0` through `class_4`
- `class_4` is the infection-positive class
- inference preprocessing uses `Resize(384) -> CenterCrop(384) -> ToTensor() -> ImageNet normalize`
- default response includes both multiclass probabilities and binary screening output

## Features

- FastAPI API with `multipart/form-data` image upload
- startup checkpoint download from Hugging Face when `MODEL_PATH` is missing
- GPU-aware runtime with `DEVICE=auto` and a CUDA Docker base image
- readiness probe that stays unhealthy until the model is loaded
- fallback checkpoint reconstruction path for `state_dict`-style checkpoints
- focused API smoke tests

## Project layout

```text
app/
  main.py
  api/
    errors.py
    router.py
    routes/
      health.py
      predict.py
  core/
    config.py
    logging.py
  schemas/
    health.py
    prediction.py
  services/
    model_compat.py
    model_loader.py
  config.py         compatibility shim
  logging.py        compatibility shim
  model_compat.py   compatibility shim
  model_loader.py   compatibility shim
tests/
requirements.txt
requirements-dev.txt
Dockerfile
```

## Local development

```bash
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

The first startup downloads the model to `MODEL_PATH` if it is not already present.

## API

### Health

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
    {"class_index": 0, "class_name": "class_0", "probability": 0.01}
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

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

Important settings:

- `MODEL_URL`: direct download URL for the checkpoint
- `MODEL_PATH`: local on-disk checkpoint location
- `DEVICE`: `auto`, `cuda`, or `cpu`
- `THRESHOLD`: infection probability threshold for screening output
- `MAX_UPLOAD_MB`: maximum accepted upload size
- `MODEL_BACKBONE`: fallback reconstruction backbone, default `mobilenet_v3_large`
- `MODEL_ARCH`: fallback reconstruction arch when `MODEL_BACKBONE=none`

## Docker

### Build

```bash
docker build -t pd-exit-site-inference-api .
```

### Run from monorepo root

```bash
docker-compose up --build backend
```

The root compose file now starts on CPU-only hosts by default. With `DEVICE=auto`, the app will still select CUDA automatically when GPU access is available.

If you want to force the legacy NVIDIA runtime on a GPU host, run:

```bash
docker-compose -f docker-compose.yml -f docker-compose.gpu.yml up --build backend
```

That GPU override assumes:

- NVIDIA drivers are installed on the host
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) is configured
- Docker Compose can launch the service with the NVIDIA runtime

The container uses a single Uvicorn worker by default so one process owns one GPU model copy.

## Notes on checkpoint compatibility

The original training code saved full PyTorch modules with `torch.save(model, args.model_out)`, so production loading can depend on the original Python symbol names. This project keeps the active compatibility code in `app/services/model_compat.py`, with `app/model_compat.py` retained as a compatibility shim for legacy imports.

If a future checkpoint is exported as a plain `state_dict`, set `MODEL_BACKBONE` and related fallback env vars correctly so the server can reconstruct the model before loading weights.

## Tests

```bash
pytest
```

## Sources

- [Training repository](https://github.com/ruby0322/ntuh-pd-exit-site-classification)
- [Model repository](https://huggingface.co/ruby0322/pd-exit-site-classification)

