# Patient result page redesign (v6)

**Date:** 2026-07-17  
**Status:** Approved (companion iteration C → v6)  
**Visual reference:** [assets/2026-07-17-patient-result-page-v6.html](assets/2026-07-17-patient-result-page-v6.html)

## Problem

The patient `/patient/result` page used stacked colored hero cards, scattered meta (confidence / upload id / symptoms), and redundant CTAs. Patients need a quieter layout (closer to admin patient-assignment chrome) with clearer hierarchy: what happened, what it means, what to do next — while keeping nurse-required education links.

## Decision

**Explain-then-act (structure C), refined through v6:**

1. Header: `分析結果` + timestamp + compact status chip (not a giant status hero).
2. Upload preview (4:3, `rounded-xl`, zinc border) with **always-visible** `上傳 #N` top-right when `uploadId` is present.
3. `本次症狀紀錄` directly under the preview (user input), chips with `gap-2`; empty → `無症狀回報`.
4. `這代表什麼` narrative + signal tile(s).
5. `建議下一步` advisory (copy only for seek-care; no new contact button).
6. Education block (nurse-required) for normal / suspected / elevated; omit for rejected / technical_error.
7. Primary CTA + secondary link + medical disclaimer.

### Signal tiles

- Rounded-square color badge **after** the title (`影像模型` / `症狀綜合`).
- Green = reassuring image signal; orange = elevated symptom risk; amber/zinc for rejected/error when shown.
- Confidence as muted `(N%)` after the **影像模型** verdict only (no standalone 確信度 card).
- Dual tiles **only** when symptom-elevated: `screening_result === "normal"` and high-risk symptoms (`pain` or `pus`, including query `cloudyDialysate` folded into pus for display compatibility).
- True AI `suspected`: single suspected narrative + single tile path (no dual strip).
- Normal (no high-risk symptoms): single `影像模型` tile.

### CTAs

| Display state | Primary | Secondary |
| --- | --- | --- |
| Normal / suspected / elevated | 回到追蹤日曆 | 查看本次上傳明細 (if `uploadId`) |
| Rejected / technical_error | 重新拍攝 | 回到追蹤日曆 (+ detail if `uploadId`) |

Deduplicate the old dual “calendar + home” links that both pointed at `/patient`.

### Education

Preserve existing `EDUCATION_MATERIALS` YouTube links:

- Normal → emerald panel
- Suspected / elevated → red panel
- Rejected / technical_error → omit

## Constraints

- Do **not** mutate API/DB `screening_result`. Elevated chrome is display-only.
- No contact / LINE / phone deep-link CTA in this redesign.
- Preview loads via `fetchPatientUploadDetail(uploadId)`; failure must not block the rest of the page.
- No backend changes.

## States

| State | Status chip | Dual tiles | Education |
| --- | --- | --- | --- |
| `normal` (no high-risk symptoms) | 判讀傷口正常 (emerald) | No — single model tile | Emerald |
| `normal` + high-risk symptoms (elevated) | 疑似感染風險 (red) | Yes — 影像正常 + 症狀高風險 | Red |
| `suspected` | 疑似感染 (red) | No | Red |
| `rejected` | 影像不符合判讀條件 (amber) | No | None |
| `technical_error` | 系統暫時無法完成判讀 (zinc) | No | None |

## Non-goals

- Redesigning upload detail or day timeline pages
- Changing symptom persistence or classifier thresholds
- Adding interactive contact actions
