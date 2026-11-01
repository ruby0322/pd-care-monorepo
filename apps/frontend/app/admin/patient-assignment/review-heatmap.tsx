"use client";

import { buildReviewHeatmap } from "@/lib/admin/review-throughput-data";
import type { AdminReviewThroughputResponse } from "@/lib/api/staff";

// Sequential magnitude: one hue, light to dark. Cyan matches the review series elsewhere.
const CELL_HUE = "8, 145, 178";

function cellStyle(intensity: number) {
  return intensity === 0
    ? { backgroundColor: "var(--heatmap-empty, #f4f4f5)" }
    : { backgroundColor: `rgba(${CELL_HUE}, ${intensity.toFixed(3)})` };
}

export function ReviewHeatmap({
  throughput,
  loading,
}: {
  throughput: AdminReviewThroughputResponse | null;
  loading: boolean;
}) {
  const rows = buildReviewHeatmap(throughput);
  const lookbackDays = throughput?.lookback_days ?? 30;

  return (
    <section aria-label="醫護審核熱圖" className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-medium text-zinc-900">審核量熱圖</h3>
      <p className="mt-0.5 text-xs text-zinc-500">近 {lookbackDays} 日審核最多的醫護，每格為當日審核張數</p>

      {loading && rows.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-400">載入中...</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-400">期間內無審核紀錄</p>
      ) : (
        <>
          <div className="mt-3 space-y-1">
            {rows.map((row) => (
              <div key={row.identity_id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-zinc-700" title={row.name}>
                  {row.name}
                </span>
                <div className="flex min-w-0 flex-1 gap-[2px]">
                  {row.cells.map((cell) => (
                    <div
                      key={cell.date}
                      className="h-4 min-w-0 flex-1 rounded-sm"
                      style={cellStyle(cell.intensity)}
                      title={`${row.name} · ${cell.date}：${cell.count} 張`}
                    />
                  ))}
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.total}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-zinc-400">
            <span>少</span>
            {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
              <span key={intensity} className="h-3 w-3 rounded-sm" style={cellStyle(intensity)} aria-hidden />
            ))}
            <span>多</span>
          </div>
        </>
      )}
    </section>
  );
}
