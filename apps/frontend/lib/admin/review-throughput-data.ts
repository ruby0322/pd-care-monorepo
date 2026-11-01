import type { AdminDailySuspectedSeriesPoint, AdminReviewThroughputResponse, AdminReviewThroughputStaff } from "@/lib/api/staff";

export type AvgReviewPoint = {
  date: string;
  shortDate: string;
  avg_per_reviewer: number;
  reviewed_uploads: number;
  reviewer_count: number;
};

export type ReviewHeatmapRow = {
  identity_id: number;
  name: string;
  total: number;
  cells: { date: string; count: number; intensity: number }[];
};

function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** Daily reviews divided by the reviewers who were actually active that day. */
export function buildAvgReviewSeries(response: AdminReviewThroughputResponse | null): AvgReviewPoint[] {
  if (!response) {
    return [];
  }
  return response.days.map((day) => ({
    date: day.date,
    shortDate: shortDate(day.date),
    // A day with no reviewers averages 0 rather than dividing by zero.
    avg_per_reviewer:
      day.reviewer_count > 0 ? Math.round((day.reviewed_uploads / day.reviewer_count) * 10) / 10 : 0,
    reviewed_uploads: day.reviewed_uploads,
    reviewer_count: day.reviewer_count,
  }));
}

function staffName(staff: AdminReviewThroughputStaff): string {
  return staff.real_name?.trim() || staff.display_name?.trim() || staff.line_user_id;
}

/**
 * Heatmap rows scaled against the busiest single cell, so one hue can carry magnitude.
 * Intensity is 0 for an empty cell and never below 0.15 for a non-empty one, so a
 * single review stays visible against the surface.
 */
export function buildReviewHeatmap(response: AdminReviewThroughputResponse | null): ReviewHeatmapRow[] {
  if (!response || response.top_staff.length === 0) {
    return [];
  }
  const dates = response.days.map((day) => day.date);
  const peak = Math.max(1, ...response.top_staff.flatMap((staff) => staff.daily_counts));
  return response.top_staff.map((staff) => ({
    identity_id: staff.identity_id,
    name: staffName(staff),
    total: staff.reviewed_uploads,
    cells: dates.map((date, index) => {
      const count = staff.daily_counts[index] ?? 0;
      return { date, count, intensity: count === 0 ? 0 : Math.max(0.15, count / peak) };
    }),
  }));
}

export type ReviewKpi = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

/** The three trailing-window review counters, formatted for display. */
export function buildReviewKpis(
  throughput: AdminReviewThroughputResponse | null,
  uploadSeries: AdminDailySuspectedSeriesPoint[],
  lookbackDays = 30
): ReviewKpi[] {
  const totalUploads = uploadSeries.reduce((sum, point) => sum + point.total_uploads, 0);
  const labeledUploads = uploadSeries.reduce((sum, point) => sum + (point.labeled_uploads ?? 0), 0);
  const avgUploadsPerDay = uploadSeries.length > 0 ? totalUploads / uploadSeries.length : 0;
  const labeledPercent = totalUploads > 0 ? Math.round((labeledUploads / totalUploads) * 100) : 0;
  const reviewers = throughput?.reviewer_count_total ?? 0;
  const reviewed = throughput?.reviewed_uploads_total ?? 0;

  return [
    {
      key: "uploads_per_day",
      label: `近 ${lookbackDays} 日平均每日上傳`,
      value: (Math.round(avgUploadsPerDay * 10) / 10).toString(),
      hint: `期間共 ${totalUploads} 張`,
    },
    {
      key: "labeled_ratio",
      label: `近 ${lookbackDays} 日審核比例`,
      value: `${labeledPercent}%`,
      hint: `已審核 ${labeledUploads} / ${totalUploads}`,
    },
    {
      key: "avg_per_reviewer",
      label: `近 ${lookbackDays} 日平均每人審核`,
      value: reviewers > 0 ? (Math.round((reviewed / reviewers) * 10) / 10).toString() : "0",
      hint: reviewers > 0 ? `${reviewed} 張 / ${reviewers} 人` : "期間無人審核",
    },
  ];
}
