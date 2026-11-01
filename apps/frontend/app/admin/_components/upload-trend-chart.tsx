"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getReadableApiError } from "@/lib/api/client";
import type { AdminDailySuspectedSeriesPoint } from "@/lib/api/staff";
import { fetchAdminDailySuspectedSeries } from "@/lib/api/staff";
import { getTaipeiTodayKey } from "@/lib/utils/upload-calendar";

import { buildUploadChartData, type UploadChartMode } from "./upload-trend-chart-data";

const LOOKBACK_OPTIONS = [30, 60, 90] as const;
const TODAY_LABELED_BAR_COLOR = "#ea580c";
const TODAY_UNLABELED_BAR_COLOR = "#fdba74";

const uploadChartConfig = {
  labeled_count: { label: "已標註", color: "#0891b2" },
  unlabeled_count: { label: "未標註", color: "#a1a1aa" },
  upload_count: { label: "總上傳", color: "#3f3f46" },
} satisfies ChartConfig;

export function UploadTrendChart() {
  const [lookbackDays, setLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [chartMode, setChartMode] = useState<UploadChartMode>("daily");
  const [series, setSeries] = useState<AdminDailySuspectedSeriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdminDailySuspectedSeries({ lookbackDays });
        if (cancelled) {
          return;
        }
        setSeries(data.items);
      } catch (err) {
        if (!cancelled) {
          setError(getReadableApiError(err));
          setSeries([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [lookbackDays]);

  const chartData = useMemo(
    () => buildUploadChartData(series, chartMode, getTaipeiTodayKey()),
    [chartMode, series]
  );

  const windowTotals = useMemo(() => {
    const total = series.reduce((sum, point) => sum + point.total_uploads, 0);
    const labeled = series.reduce((sum, point) => sum + (point.labeled_uploads ?? 0), 0);
    return { total, labeled, percent: total > 0 ? Math.round((labeled / total) * 100) : 0 };
  }, [series]);

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-900">上傳數趨勢</h3>
          <p className="text-xs text-zinc-500">
            已標註 {windowTotals.labeled} / {windowTotals.total}（{windowTotals.percent}%）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1">
            <button
              type="button"
              className={clsx(
                "rounded px-2 py-1",
                chartMode === "daily" ? "bg-zinc-900 text-white" : "text-zinc-600"
              )}
              onClick={() => setChartMode("daily")}
            >
              單日
            </button>
            <button
              type="button"
              className={clsx(
                "rounded px-2 py-1",
                chartMode === "cumulative" ? "bg-zinc-900 text-white" : "text-zinc-600"
              )}
              onClick={() => setChartMode("cumulative")}
            >
              累進
            </button>
          </div>
          <select
            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value) as (typeof LOOKBACK_OPTIONS)[number])}
          >
            {LOOKBACK_OPTIONS.map((value) => (
              <option key={value} value={value}>
                最近{value}天
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? <p className="text-sm text-zinc-400">載入上傳趨勢…</p> : null}
      {error ? <p className="mb-3 text-sm text-zinc-500">{error}</p> : null}
      <ChartContainer className="h-64 w-full" config={uploadChartConfig}>
        {chartMode === "daily" ? (
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="labeled_count" stackId="uploads" fill="var(--color-labeled_count)">
              {chartData.map((point) => (
                <Cell
                  key={point.date}
                  fill={point.isToday ? TODAY_LABELED_BAR_COLOR : "var(--color-labeled_count)"}
                />
              ))}
            </Bar>
            <Bar dataKey="unlabeled_count" stackId="uploads" fill="var(--color-unlabeled_count)" radius={[4, 4, 0, 0]}>
              {chartData.map((point) => (
                <Cell
                  key={point.date}
                  fill={point.isToday ? TODAY_UNLABELED_BAR_COLOR : "var(--color-unlabeled_count)"}
                />
              ))}
            </Bar>
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        ) : (
          <LineChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="upload_count" stroke="var(--color-upload_count)" strokeWidth={2} dot={false} />
            <Line dataKey="labeled_count" stroke="var(--color-labeled_count)" strokeWidth={2} dot={false} />
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        )}
      </ChartContainer>
    </section>
  );
}
