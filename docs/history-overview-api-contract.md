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
      "infection_rate": 0.25,
      "risky_patient_count": 3,
      "has_infection_risk": true
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
    "infection_rate": 0.25
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
      "has_infection_risk": true
    }
  ]
}
```

## Semantic Rules

- Timezone for date bucketing is always `Asia/Taipei` (`UTC+8`).
- Daily KPI values are calculated from all uploads on that local date, independent from UI sorting/grouping.
- `suspected_infected_users` rule:
  - Include user if any upload has nursing label `confirmed_infection`.
  - Or include user if any upload has model result `suspected` and has no nursing label.
- Risk sort order:
  - `confirmed_infection` > `suspected` (by probability desc) > `normal` > `rejected`, then `created_at` desc.
- Group sort by infection risk:
  - first by group's highest risk tier, then by count within that tier, then latest upload time desc.

