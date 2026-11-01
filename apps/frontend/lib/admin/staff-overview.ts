import type { AdminIdentityWorkloadStats } from "@/lib/api/staff";

const DAY_MS = 24 * 60 * 60 * 1000;

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
