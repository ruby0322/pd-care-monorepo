# syntax=docker/dockerfile:1.7
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_HOME=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash appuser

WORKDIR ${APP_HOME}

COPY requirements.txt ./requirements.txt
RUN python3 -m pip install --upgrade pip && python3 -m pip install -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini
COPY scripts ./scripts
RUN chmod +x ./scripts/start-backend.sh

ARG MODEL_URL=https://huggingface.co/ruby0322/pd-exit-site-classification/resolve/main/model_e41_production_best.pt
ARG MODEL_PATH=/models/model_e41_production_best.pt
ARG PRESCREEN_MODEL_REPO_ID=ruby0322/pd-exit-site-clip-linear-probe
ARG PRESCREEN_MODEL_REVISION=
ARG PRESCREEN_MODEL_CACHE_DIR=/models/prescreen
ARG HF_HOME=/models/hf-cache
ARG HF_TOKEN=

ENV MODEL_URL=${MODEL_URL} \
    MODEL_PATH=${MODEL_PATH} \
    PRESCREEN_MODEL_REPO_ID=${PRESCREEN_MODEL_REPO_ID} \
    PRESCREEN_MODEL_REVISION=${PRESCREEN_MODEL_REVISION} \
    PRESCREEN_MODEL_CACHE_DIR=${PRESCREEN_MODEL_CACHE_DIR} \
    HF_HOME=${HF_HOME} \
    TRANSFORMERS_CACHE=${HF_HOME} \
    HF_TOKEN=${HF_TOKEN}

RUN mkdir -p /models "${HF_HOME}"
RUN python3 ./scripts/bake_models.py && \
    chown -R appuser:appuser ${APP_HOME} /models

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail http://127.0.0.1:8000/healthz || exit 1

CMD ["./scripts/start-backend.sh"]

