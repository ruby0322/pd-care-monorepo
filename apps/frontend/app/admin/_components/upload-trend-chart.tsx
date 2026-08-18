"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getReadableApiError } from "@/lib/api/client";
import type { AdminDailySuspectedSeriesPoint } from "@/lib/api/staff";
import { fetchAdminDailySuspectedSeries } from "@/lib/api/staff";

import { buildUploadChartData, type UploadChartMode } from "./upload-trend-chart-data";

const LOOKBACK_OPTIONS = [30, 60, 90] as const;

const uploadChartConfig = {
  upload_count: { label: "上傳數", color: "#0891b2" },
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

  const chartData = useMemo(() => buildUploadChartData(series, chartMode), [chartMode, series]);

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-900">上傳數趨勢</h3>
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
        <LineChart data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="upload_count" stroke="var(--color-upload_count)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </section>
  );
}
