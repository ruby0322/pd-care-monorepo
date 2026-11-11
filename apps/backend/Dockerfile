# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_HOME=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash appuser

WORKDIR ${APP_HOME}

COPY requirements-core.txt ./requirements-core.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install torch==2.9.1 torchvision==0.24.1 \
      --index-url https://download.pytorch.org/whl/cpu && \
    python -m pip install -r requirements-core.txt

ARG MODEL_URL=https://huggingface.co/ruby0322/pd-exit-site-classification/resolve/main/model_e41_production_best.pt
ARG MODEL_PATH=/models/model_e41_production_best.pt
ARG PRESCREEN_MODEL_REPO_ID=ruby0322/pd-exit-site-clip-linear-probe
ARG PRESCREEN_MODEL_REVISION=
ARG PRESCREEN_MODEL_CACHE_DIR=/models/prescreen
ARG HF_HOME=/models/hf-cache

ENV MODEL_URL=${MODEL_URL} \
    MODEL_PATH=${MODEL_PATH} \
    PRESCREEN_MODEL_REPO_ID=${PRESCREEN_MODEL_REPO_ID} \
    PRESCREEN_MODEL_REVISION=${PRESCREEN_MODEL_REVISION} \
    PRESCREEN_MODEL_CACHE_DIR=${PRESCREEN_MODEL_CACHE_DIR} \
    HF_HOME=${HF_HOME} \
    TRANSFORMERS_CACHE=${HF_HOME}

# Bake the models before the app code lands. This layer is ~420 MB, and
# everything below a COPY of the app is rebuilt on every commit, so keeping
# the bake above it is what makes the layer reusable across builds.
COPY scripts ./scripts
RUN chmod +x ./scripts/start-backend.sh
# HF_TOKEN is build-time only. The secret mount keeps it out of the image
# layers, the image config and the build provenance; the inline assignment
# scopes it to this one process. Runtime reads its own HF_TOKEN from the
# deployment secret (k8s pd-care-secrets / compose PDCARE_HF_TOKEN).
RUN --mount=type=secret,id=hf_token \
    mkdir -p /models "${HF_HOME}" && \
    HF_TOKEN="$(cat /run/secrets/hf_token 2>/dev/null || true)" \
    python ./scripts/bake_models.py && \
    chown -R appuser:appuser /models

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini
RUN chown -R appuser:appuser ${APP_HOME}

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail http://127.0.0.1:8000/healthz || exit 1

CMD ["./scripts/start-backend.sh"]

