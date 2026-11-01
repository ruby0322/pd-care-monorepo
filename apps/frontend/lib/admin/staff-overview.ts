import type { AdminStaffOverviewItem, AdminStaffOverviewSummary } from "@/lib/api/staff";

export type StaffOverviewKpi = {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: "neutral" | "warning";
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function staffOverviewKpis(summary: AdminStaffOverviewSummary | null): StaffOverviewKpi[] {
  return [
    {
      key: "active_staff",
      label: "在職醫護",
      value: summary?.active_staff_count ?? 0,
      hint: `共 ${summary?.staff_total ?? 0} 個 staff/admin 帳號`,
      tone: "neutral",
    },
    {
      key: "pending_requests",
      label: "待審權限申請",
      value: summary?.pending_access_request_count ?? 0,
      hint: "等待 admin 核准或拒絕",
      tone: (summary?.pending_access_request_count ?? 0) > 0 ? "warning" : "neutral",
    },
    {
      key: "zero_assignment",
      label: "零指派醫護",
      value: summary?.zero_assignment_staff_count ?? 0,
      hint: "在職 staff 但未負責任何病患（admin 不計）",
      tone: (summary?.zero_assignment_staff_count ?? 0) > 0 ? "warning" : "neutral",
    },
    {
      key: "unassigned_patients",
      label: "未分配病患",
      value: summary?.unassigned_patient_count ?? 0,
      hint: "無在職醫護負責（含僅指派給已停用帳號）",
      tone: (summary?.unassigned_patient_count ?? 0) > 0 ? "warning" : "neutral",
    },
  ];
}

/** Relative label for the last review timestamp; staff with no reviews read as 從未審核. */
export function formatLastReviewAt(lastReviewAt: string | null, now: Date = new Date()): string {
  if (!lastReviewAt) {
    return "從未審核";
  }
  const reviewedAt = new Date(lastReviewAt);
  if (Number.isNaN(reviewedAt.getTime())) {
    return "從未審核";
  }
  const elapsedMs = now.getTime() - reviewedAt.getTime();
  if (elapsedMs < 0) {
    return "剛剛";
  }
  const elapsedDays = Math.floor(elapsedMs / DAY_MS);
  if (elapsedDays === 0) {
    return "今天";
  }
  if (elapsedDays === 1) {
    return "昨天";
  }
  if (elapsedDays < 30) {
    return `${elapsedDays} 天前`;
  }
  return reviewedAt.toLocaleDateString("zh-TW");
}

/** Dormant = active account that has not reviewed anything in the last 30 days. */
export function isDormantStaff(item: AdminStaffOverviewItem): boolean {
  return item.is_active && item.review_count_30d === 0;
}

export function staffRosterDisplayName(item: AdminStaffOverviewItem): string {
  return item.real_name?.trim() || item.display_name?.trim() || item.line_user_id;
}
