# Admin Dashboard Homepage Renovate Implementation Plan

> **For agentic workers:** Use the approved design at `docs/superpowers/specs/2026-07-25-admin-dashboard-homepage-renovate-design.md`.

**Goal:** Replace the metric-soup `/admin` homepage with an actionable today workbench, and make `/admin/history-overview` the period analytics home (臨床 | 使用趨勢).

**Architecture:** New staff-scoped `GET /v1/staff/uploads/today-attention` returns today’s uploaders partitioned into suspected / elevated / other with sort + representative upload. Frontend rebuilds `/admin` as Layout B (left pool / right stack). Period KPIs and suspected-ratio series live in `history-overview` tabs. Compact user + upload trend charts were restored on `/admin` for admins (2026-08-18); do not remove them.

**Defaults:**
- Visible recent thumbs = 5 + `+n`
- Sidebar label 歷史總覽 → 區間分析
- Homepage usage charts admin-only; mount after workbench load
- Binding panel = summary + deep link only

## Implemented deliverables

### Backend
- Schemas: `StaffTodayAttentionPatientItem`, `StaffTodayAttentionResponse`
- Service: `list_today_attention_patients`
- Route: `GET /v1/staff/uploads/today-attention`
- Tests: `apps/backend/tests/test_staff_today_attention_api.py`

### Frontend
- `fetchTodayAttention` + types in `lib/api/staff.ts`
- Today workbench components under `app/admin/_components/`
- Rewritten `app/admin/page.tsx` (Layout B)
- `history-overview` tabs: `clinical-period-panel.tsx`, `usage-trends-tab.tsx`
- Nav rename to 區間分析 in `layout.tsx`

## Out of scope

- Notification bell removal, overdue compliance, inline bindings, thumb→review-fast, Grafana monitoring
