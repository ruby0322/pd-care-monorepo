"use client";

import { assignmentKpis } from "@/lib/admin/staff-overview";
import type { AdminStaffSummary } from "@/lib/api/staff";

export function AssignmentKpiBand({ summary }: { summary: AdminStaffSummary | null }) {
  return (
    <section aria-label="分配概況" className="grid grid-cols-3 gap-3">
      {assignmentKpis(summary).map((kpi) => (
        <div key={kpi.key} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">{kpi.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${kpi.tone === "warning" ? "text-amber-700" : "text-zinc-900"}`}>
            {kpi.value}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{kpi.hint}</p>
        </div>
      ))}
    </section>
  );
}
