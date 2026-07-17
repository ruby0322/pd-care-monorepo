# Staff History Overview API Contract

This document freezes the request/response contract for the admin `歷史總覽` feature.

## Endpoints

### `GET /v1/staff/uploads/history-overview/days`

Returns all available Taiwan-local dates with per-day KPI summary.

Response shape:

```json
{
  "items": [
    {
      "local_date": "2026-05-29",
      "upload_count": 34,
      "uploaded_users": 12,
      "suspected_infected_users": 3,
      "symptom_elevated_users": 2,
      "infection_rate": 0.4167,
      "risky_patient_count": 3,
      "has_infection_risk": true,
      "symptom_elevated_patient_count": 2,
      "has_symptom_elevated_risk": true
    }
  ]
}
```

### `GET /v1/staff/uploads/history-overview`

Query params:

- `local_date` (required, `YYYY-MM-DD`, Taiwan local date)
- `sort_by` (`timeline` | `risk`, default `timeline`)
- `group_by_user` (`true` | `false`, default `false`)
- `group_sort_by` (`uploads` | `age` | `infection_risk`, default `infection_risk`)

Response shape:

```json
{
  "local_date": "2026-05-29",
  "sort_by": "risk",
  "group_by_user": true,
  "group_sort_by": "infection_risk",
  "kpi": {
    "uploaded_users": 12,
    "uploads": 34,
    "suspected_infected_users": 3,
    "symptom_elevated_users": 2,
    "infection_rate": 0.4167
  },
  "items": [],
  "groups": [
    {
      "patient_id": 101,
      "case_number": "P123456",
      "patient_full_name": "王小明",
      "gender": "male",
      "age": 42,
      "line_user_id": "Uxxxx",
      "line_display_name": "Ming",
      "real_name": "王小明",
      "picture_url": "https://...",
      "upload_count": 10,
      "highest_risk_rank": 0,
      "highest_risk_count": 2,
      "latest_upload_at": "2026-05-29T11:20:00Z",
      "uploads": [
        {
          "upload_id": 999,
          "patient_id": 101,
          "case_number": "P123456",
          "patient_full_name": "王小明",
          "gender": "male",
          "line_user_id": "Uxxxx",
          "line_display_name": "Ming",
          "real_name": "王小明",
          "picture_url": "https://...",
          "created_at": "2026-05-29T11:20:00Z",
          "screening_result": "suspected",
          "probability": 0.87,
          "symptom_pain": true,
          "symptom_discharge": false,
          "symptom_pus": false,
          "symptom_cloudy_dialysate": false,
          "has_high_risk_symptoms": true,
          "symptom_aware_priority": "suspected",
          "annotation_label": "confirmed_infection",
          "annotation_comment": "doctor reviewed",
          "risk_rank": 0
        }
      ]
    }
  ]
}
```

### `GET /v1/staff/uploads/history-overview/calendar`

Query params:

- `year` (required)
- `month` (required, `1-12`)

Response shape:

```json
{
  "year": 2026,
  "month": 5,
  "items": [
    {
      "local_date": "2026-05-29",
      "risky_patient_count": 3,
      "has_infection_risk": true,
      "symptom_elevated_patient_count": 2,
      "has_symptom_elevated_risk": true
    }
  ]
}
```

## Semantic Rules

- Timezone for date bucketing is always `Asia/Taipei` (`UTC+8`).
- Daily KPI values are calculated from all uploads on that local date, independent from UI sorting/grouping.
- Risk tiers use shared `calendar_risk_tier`:
  - **suspected (red):** risky nursing label (`suspected` / `confirmed_infection`) OR image AI `suspected`.
  - **elevated (orange):** high-risk symptoms (pain / pus / cloudy dialysate) unless annotated `normal`, and not already suspected.
  - **none:** everything else (including elevated cleared by annotation `normal`).
- `suspected_infected_users` / `risky_patient_count` / `has_infection_risk`: patients with ≥1 **suspected**-tier upload that day.
- `symptom_elevated_users` / `symptom_elevated_patient_count` / `has_symptom_elevated_risk`: patients with ≥1 **elevated**-tier upload that day and **no** suspected-tier upload that day (mutually exclusive with suspected).
- `infection_rate`: `|patients with any upload where tier ∈ {suspected, elevated}| / uploaded_users` (union; no double-count).
- Risk sort order (`risk_rank`, lower = higher priority):
  - `confirmed_infection` (0) > annotation/AI `suspected` (1) > elevated symptoms (2) > `normal` (3) > `rejected`/other (4), then probability desc, then `created_at` desc.
- Group sort by infection risk:
  - first by group's highest risk tier (`risk_rank`), then by count within that tier, then latest upload time desc.
