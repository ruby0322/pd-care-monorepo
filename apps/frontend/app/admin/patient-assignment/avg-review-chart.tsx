"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { buildAvgReviewSeries } from "@/lib/admin/review-throughput-data";
import type { AdminReviewThroughputResponse } from "@/lib/api/staff";

// Single series, so no legend: the heading names the measure.
const avgReviewChartConfig = {
  avg_per_reviewer: { label: "平均每人審核", color: "#0891b2" },
} satisfies ChartConfig;

export function AvgReviewChart({
  throughput,
  loading,
}: {
  throughput: AdminReviewThroughputResponse | null;
  loading: boolean;
}) {
  const chartData = buildAvgReviewSeries(throughput);

  return (
    <section aria-label="平均每人審核數趨勢" className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-medium text-zinc-900">平均每人審核數</h3>
      <p className="mt-0.5 text-xs text-zinc-500">每日審核張數 ÷ 當日有審核的人數</p>

      {loading && chartData.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-400">載入中...</p>
      ) : chartData.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-400">期間內無審核紀錄</p>
      ) : (
        <ChartContainer className="mt-3 h-56 w-full" config={avgReviewChartConfig}>
          <LineChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="avg_per_reviewer"
              stroke="var(--color-avg_per_reviewer)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      )}
    </section>
  );
}
