import type { AdminIdentityWorkloadStats, AdminStaffSummary } from "@/lib/api/staff";

export type StaffOverviewKpi = {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: "neutral" | "warning";
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Counters that tell an admin whether assignment work is outstanding. */
export function assignmentKpis(summary: AdminStaffSummary | null): StaffOverviewKpi[] {
  const idle = summary?.idle_staff_count ?? 0;
  const unassigned = summary?.unassigned_patient_count ?? 0;
  return [
    {
      key: "unassigned_patients",
      label: "未分配病患",
      value: unassigned,
      hint: "無在職醫護負責（含僅指派給已停用帳號）",
      tone: unassigned > 0 ? "warning" : "neutral",
    },
    {
      key: "idle_staff",
      label: "空閑醫護",
      value: idle,
      hint: "在職 staff/admin 但未負責任何病患",
      tone: idle > 0 ? "warning" : "neutral",
    },
    {
      key: "active_staff",
      label: "在職醫護",
      value: summary?.active_staff_count ?? 0,
      hint: `共 ${summary?.staff_total ?? 0} 個 staff/admin 帳號`,
      tone: "neutral",
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

/** Dormant = no review activity in the last 30 days, so assigning more work is questionable. */
export function isDormantWorkload(workload: AdminIdentityWorkloadStats | null): boolean {
  return workload !== null && workload.review_count_30d === 0;
}

/** Share of this person's assigned queue that has been labelled, 0 when nothing is assigned. */
export function labeledRatioPercent(workload: AdminIdentityWorkloadStats | null): number {
  if (!workload || workload.assigned_upload_count === 0) {
    return 0;
  }
  return Math.round(workload.labeled_assigned_ratio * 100);
}
