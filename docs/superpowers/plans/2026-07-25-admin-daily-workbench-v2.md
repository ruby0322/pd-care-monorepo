# 儀表板 v2 實作計畫（設計已鎖定）

> **Design source of truth:** companion `admin-dashboard-final-overall-v16-metrics-gap.html`（月曆 `mt-auto pt-2`、全寬 7 欄 grid、Image/Users/TriangleAlert chips）
>
> **Agent execution:** Use executing-plans skill task-by-task after approval.
>
> Canonical Cursor plan: `.cursor/plans/admin_dashboard_v2_d17eaf43.plan.md` (do not edit that file during implementation; keep this docs copy in sync if the approved plan changes).

**Goal:** `/admin?date=YYYY-MM-DD` 可切換台北日；月曆選日驅動病患池與上傳次數；大螢幕病患池多欄；移除首頁縮圖牆。

**Baseline:** v1 workbench 已存在（`apps/frontend/app/admin/page.tsx` + `today-*` 元件），但 **today-only**、horizontal patient row、tier badge pills、dimmed annotated cards、`RecentUploadThumbs`。月曆僅在 `history-overview/page.tsx`（risk 染色舊版，需移出）。

See full phased plan in `.cursor/plans/admin_dashboard_v2_d17eaf43.plan.md`.

## Phases (summary)

1. Spec + plan doc 落檔
2. Backend: `local_date` + attention 欄位 + calendar metrics + pytest
3. FE: API types + hook + `DashboardDayCalendar`
4. FE: homepage wiring + patient card rewrite
5. FE: history-overview URL sync + 移除舊月曆
6. Tests + lint + smoke

## Deliberately out of scope

- Route rename（保留 `/today-attention`）
- 首頁 inline annotation modal
- 首頁 upload thumb grid
- Upload queue date filter
- 大規模 `Today*` → `Daily*` 檔名 rename
