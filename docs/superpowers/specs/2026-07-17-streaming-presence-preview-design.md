# Streaming presence preview (live capture)

**Date:** 2026-07-17  
**Status:** Approved for implementation

## Problem

Patient capture shows a live camera for alignment, but presence (CLIP + linear probe)
only runs on final `POST /v1/patient/uploads`. Users discover a bad frame only after
submit (`rejected`). There is no preview-time guidance.

## Goals

- While the live camera is open (before shutter), show whether the exit site looks present.
- Unlock the shutter only when presence passes.
- Poll at most ~1 Hz, and only after the camera view is stable (frontend frame-diff).
- Fail open on API/model errors so capture remains possible.
- Keep final upload presence gate authoritative (unchanged semantics).

## Non-goals

- WebSocket / SSE streaming
- Infection CNN preview
- Confidence scores in the UI
- YOLO / lighting quality gates
- Live gate on file-picker fallback
- DeviceMotion / accelerometer
- GPU or async job queues

## Product decisions

| Topic | Decision |
| --- | --- |
| When | Live camera before shutter only |
| Presence UI | 「可以拍」/「再對準一點」 |
| Stability UI | 「請握穩鏡頭」 while shaky |
| Shutter | Hard-gated until presence `ok` |
| Errors | Fail-open → unlock +「無法即時檢查」 |
| Transport | Auth’d HTTP poll (~1 Hz), stability-gated |

## Architecture

```text
CameraView
  → sample 64×64 grayscale ~150ms (MAD)
  → if shaky: show「請握穩鏡頭」, skip poll, shutter disabled
  → if stable: JPEG ~384px @0.6 → POST /v1/patient/prescreen
  → update presence status → enable shutter iff ok
Final submit → POST /v1/patient/uploads (unchanged)
```

## Backend

`POST /v1/patient/prescreen`

- Auth: patient JWT + `can_upload` (same as uploads)
- Input: multipart `file`
- Output: `{ "present": bool, "checked": bool }`
  - Model ran → `checked=true`, `present` from `is_exit_site_present`
  - Disabled / unloaded / inference error → `200 {present: true, checked: false}`
- No DB, SeaweedFS, or infection CNN
- CLIP via `asyncio.to_thread`
- Process-local per-patient min interval ~1s → `429`

## Frontend

- `prescreenPatientExitSiteImage` in `lib/api/predict.ts`
- `lib/camera-stability.ts`: MAD + stability state machine
- Capture page: status chip + hard shutter gate
- Priority: `shaky` overrides presence copy while motion is high

| State | Copy | Shutter |
| --- | --- | --- |
| shaky | 請握穩鏡頭 | disabled |
| idle | 對準出口部位… | disabled |
| ok | 可以拍 | enabled |
| realign | 再對準一點 | disabled |
| unavailable | 無法即時檢查 | enabled |

## Testing

- Backend: auth, present true/false, fail-open, 429, no persistence
- Frontend: MAD / stability unit tests; status → shutter enable mapping
