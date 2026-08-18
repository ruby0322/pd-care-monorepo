"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getReadableApiError } from "@/lib/api/client";
import type { AdminActiveUsersSeriesPoint } from "@/lib/api/staff";
import { fetchAdminActiveUsersSeries } from "@/lib/api/staff";

const ACTIVE_WINDOW_OPTIONS = [3, 7, 14, 30] as const;
const LOOKBACK_OPTIONS = [30, 60, 90] as const;

const userTrendChartConfig = {
  registered_users: { label: "已綁定用戶", color: "#0f766e" },
  active_users: { label: "活躍用戶", color: "#2563eb" },
} satisfies ChartConfig;

export function UserTrendChart() {
  const [activeWindowDays, setActiveWindowDays] = useState<(typeof ACTIVE_WINDOW_OPTIONS)[number]>(7);
  const [lookbackDays, setLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [interval, setInterval] = useState<"day" | "week">("day");
  const [series, setSeries] = useState<AdminActiveUsersSeriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdminActiveUsersSeries({
          activeWindowDays,
          lookbackDays,
          interval,
        });
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
  }, [activeWindowDays, interval, lookbackDays]);

  const chartData = useMemo(
    () =>
      series.map((point) => ({
        ...point,
        shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
      })),
    [series]
  );

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-900" title="已綁定用戶為已完成 LINE 病患身分綁定的帳號，不含僅建檔未綁定病患">
          用戶趨勢
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="rounded-lg border border-zinc-200 px-2 py-1"
            value={activeWindowDays}
            onChange={(event) => setActiveWindowDays(Number(event.target.value) as (typeof ACTIVE_WINDOW_OPTIONS)[number])}
          >
            {ACTIVE_WINDOW_OPTIONS.map((value) => (
              <option key={value} value={value}>
                近{value}天活躍
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-2 py-1"
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value) as (typeof LOOKBACK_OPTIONS)[number])}
          >
            {LOOKBACK_OPTIONS.map((value) => (
              <option key={value} value={value}>
                最近{value}天
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-2 py-1"
            value={interval}
            onChange={(event) => setInterval(event.target.value as "day" | "week")}
          >
            <option value="day">日</option>
            <option value="week">週</option>
          </select>
        </div>
      </div>
      {loading ? <p className="text-sm text-zinc-400">載入用戶趨勢…</p> : null}
      {error ? <p className="mb-3 text-sm text-zinc-500">{error}</p> : null}
      <ChartContainer className="h-64 w-full" config={userTrendChartConfig}>
        <LineChart data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="registered_users" stroke="var(--color-registered_users)" strokeWidth={2} dot={false} />
          <Line dataKey="active_users" stroke="var(--color-active_users)" strokeWidth={2} dot={false} />
          <ChartLegend content={<ChartLegendContent />} />
        </LineChart>
      </ChartContainer>
    </section>
  );
}
