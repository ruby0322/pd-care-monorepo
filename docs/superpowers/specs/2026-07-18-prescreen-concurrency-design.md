# Prescreen live-guidance concurrency

**Date:** 2026-07-18  
**Status:** Approved for implementation  
**Parent:** [2026-07-17-streaming-presence-preview-design.md](./2026-07-17-streaming-presence-preview-design.md)

## Problem

Multiple different patients opening live capture at once competed for one backend process’s CLIP inference. Slow or failed polls mapped to sticky 「暫時無法自動檢查」 on the client (including HTTP 429).

## Measured baseline (prod pod, CPU)

| Scenario | Result |
| --- | --- |
| HTTP sequential | ~98 ms p50 |
| CLIP sequential | ~211 ms p50 |
| 10 concurrent on one pod | ~2.1–2.8 s wall |

Single-request latency is far below the previous 1 s guess; concurrency thrash and 429→unavailable mapping were the main UX failures.

## Goals

- Support **≥10 concurrent** patients on live presence guidance.
- Avoid sticky unavailable from transient 429.
- Cap per-process CLIP concurrency so threads do not thrash one model.
- Keep upload presence gate and fail-open shutter semantics unchanged.

## Decisions

| Topic | Choice |
| --- | --- |
| Prod backend replicas | `3` |
| Dev backend replicas | `2` |
| Prod frontend replicas | unchanged (`2`) |
| Inference semaphore | max **2** concurrent CLIP calls per process |
| Semaphore wait | **1.5 s**; then fail-open `{present:true, checked:false}` |
| Per-patient rate limit | unchanged (~1 s, process-local → 429) |
| Frontend 429 | up to **2** retries with 400 ms / 800 ms backoff |

## Architecture

```text
Capture poller (~1 Hz, stability-gated)
  → POST /v1/patient/prescreen
  → 429? retry with backoff (≤2)
  → rate limit OK → acquire inference semaphore (≤1.5s)
       → run CLIP in to_thread → {present, checked:true}
       → wait timeout → {present:true, checked:false}
```

## Non-goals

- Redis / shared rate limits across pods
- GPU or separate inference service
- Raising per-pod CPU/memory limits
- Changing final upload gate behavior

## Verification

- Backend unit: gate busy → fail-open; existing present/429/auth tests still pass
- Frontend unit: 429 retries then success / exhaust
- After deploy: `kubectl get deploy backend -n pd-care-prod` → `3/3`
