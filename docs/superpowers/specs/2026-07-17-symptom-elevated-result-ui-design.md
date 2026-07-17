# Symptom-elevated patient result UI (Option C)

**Date:** 2026-07-17  
**Status:** Approved (companion choice C)

## Problem

When the image model returns `normal` but the patient checked high-risk symptoms
(`pain` / `pus` / `cloudy_dialysate`), the previous result page kept green
「影像判讀」 chrome with only an amber symptom advisory. Clinical intent is that
the patient experience should match infection-risk urgency, while still showing
that the model’s image verdict was normal.

## Decision

**Option C — dual-column under suspected chrome:**

1. Hero uses suspected (red) presentation:「建議處置等級」/「疑似感染風險」.
2. Bottom of the same card: green「影像模型 → 正常」| orange「症狀綜合 → 高風險」.
3. Message includes「影像模型雖判讀正常，仍以症狀為準。」
4. Amber symptom advisory + chips unchanged.
5. Red education panel (not green).

## Constraints

- Do not mutate API/DB `screening_result`.
- Dual-column only when `screening_result === "normal"` and high-risk symptoms.
- True AI `suspected` keeps existing red page without the dual-column.

## Implementation

- Helper: `isSymptomElevatedFromNormal` in `apps/frontend/lib/symptoms.ts`
- UI: `apps/frontend/app/patient/result/page.tsx`
