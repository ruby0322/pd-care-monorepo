"use client";

import { buildReviewKpis } from "@/lib/admin/review-throughput-data";
import type { AdminDailySuspectedSeriesPoint, AdminReviewThroughputResponse } from "@/lib/api/staff";

export function ReviewKpiBand({
  throughput,
  uploadSeries,
}: {
  throughput: AdminReviewThroughputResponse | null;
  uploadSeries: AdminDailySuspectedSeriesPoint[];
}) {
  return (
    <section aria-label="近三十日審核概況" className="grid grid-cols-3 gap-3">
      {buildReviewKpis(throughput, uploadSeries).map((kpi) => (
        <div key={kpi.key} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">{kpi.label}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">{kpi.value}</p>
          <p className="mt-1 text-xs text-zinc-400">{kpi.hint}</p>
        </div>
      ))}
    </section>
  );
}
