"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
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
import { fetchAdminActiveUsersSeries, fetchAdminDailySuspectedSeries } from "@/lib/api/staff";

const ACTIVE_WINDOW_OPTIONS = [3, 7, 14, 30] as const;
const LOOKBACK_OPTIONS = [30, 60, 90] as const;

const activeChartConfig = {
  active_users: { label: "活躍用戶", color: "#2563eb" },
} satisfies ChartConfig;

const dailyChartConfig = {
  suspected_uploads: { label: "疑似上傳", color: "#dc2626" },
  symptom_elevated_uploads: { label: "症狀高風險", color: "#f97316" },
  risk_total: { label: "風險合計", color: "#dc2626" },
  ratio_pct: { label: "比例 %", color: "#71717a" },
} satisfies ChartConfig;

export function UsageTrendsTab() {
  const [activeWindowDays, setActiveWindowDays] = useState<(typeof ACTIVE_WINDOW_OPTIONS)[number]>(7);
  const [activeLookbackDays, setActiveLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [activeInterval, setActiveInterval] = useState<"day" | "week">("day");
  const [dailyLookbackDays, setDailyLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [riskChartMode, setRiskChartMode] = useState<"split" | "aggregate">("split");
  const [activeUsersSeries, setActiveUsersSeries] = useState<{ date: string; active_users: number }[]>([]);
  const [dailySuspectedSeries, setDailySuspectedSeries] = useState<
    {
      date: string;
      total_uploads: number;
      suspected_uploads: number;
      symptom_elevated_uploads: number;
      suspected_ratio: number;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [activeData, dailyData] = await Promise.all([
          fetchAdminActiveUsersSeries({
            activeWindowDays,
            lookbackDays: activeLookbackDays,
            interval: activeInterval,
          }),
          fetchAdminDailySuspectedSeries({ lookbackDays: dailyLookbackDays }),
        ]);
        if (cancelled) {
          return;
        }
        setActiveUsersSeries(activeData.items);
        setDailySuspectedSeries(dailyData.items);
      } catch (err) {
        if (!cancelled) {
          setError(getReadableApiError(err));
          setActiveUsersSeries([]);
          setDailySuspectedSeries([]);
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
  }, [activeInterval, activeLookbackDays, activeWindowDays, dailyLookbackDays]);

  const activeUserChartData = useMemo(
    () =>
      activeUsersSeries.map((point) => ({
        ...point,
        shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
      })),
    [activeUsersSeries]
  );

  const dailySuspectedChartData = useMemo(
    () =>
      dailySuspectedSeries.map((point) => {
        const elevated = point.symptom_elevated_uploads ?? 0;
        const ratio =
          point.total_uploads > 0
            ? riskChartMode === "aggregate"
              ? (point.suspected_uploads + elevated) / point.total_uploads
              : point.suspected_ratio
            : 0;
        return {
          ...point,
          symptom_elevated_uploads: elevated,
          risk_total: point.suspected_uploads + elevated,
          ratio_pct: Number((ratio * 100).toFixed(1)),
          shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
        };
      }),
    [dailySuspectedSeries, riskChartMode]
  );

  return (
    <div className="space-y-4">
      {loading ? <p className="text-sm text-zinc-400">載入使用趨勢…</p> : null}
      {error ? <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">{error}</p> : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-900">活躍用戶趨勢</h3>
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
              value={activeLookbackDays}
              onChange={(event) => setActiveLookbackDays(Number(event.target.value) as (typeof LOOKBACK_OPTIONS)[number])}
            >
              {LOOKBACK_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  最近{value}天
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-zinc-200 px-2 py-1"
              value={activeInterval}
              onChange={(event) => setActiveInterval(event.target.value as "day" | "week")}
            >
              <option value="day">日</option>
              <option value="week">週</option>
            </select>
          </div>
        </div>
        <ChartContainer className="h-64 w-full" config={activeChartConfig}>
          <LineChart data={activeUserChartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="active_users" stroke="var(--color-active_users)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-900">每日疑似感染比例與數量</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1">
              <button
                type="button"
                className={clsx("rounded px-2 py-1", riskChartMode === "split" ? "bg-zinc-900 text-white" : "text-zinc-600")}
                onClick={() => setRiskChartMode("split")}
              >
                分開
              </button>
              <button
                type="button"
                className={clsx(
                  "rounded px-2 py-1",
                  riskChartMode === "aggregate" ? "bg-zinc-900 text-white" : "text-zinc-600"
                )}
                onClick={() => setRiskChartMode("aggregate")}
              >
                合計
              </button>
            </div>
            <select
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
              value={dailyLookbackDays}
              onChange={(event) => setDailyLookbackDays(Number(event.target.value) as (typeof LOOKBACK_OPTIONS)[number])}
            >
              {LOOKBACK_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  最近{value}天
                </option>
              ))}
            </select>
          </div>
        </div>
        <ChartContainer className="h-72 w-full" config={dailyChartConfig}>
          <LineChart data={dailySuspectedChartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis yAxisId="left" tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} unit="%" />
            <ChartTooltip content={<ChartTooltipContent />} />
            {riskChartMode === "aggregate" ? (
              <Line yAxisId="left" dataKey="risk_total" stroke="var(--color-risk_total)" strokeWidth={2} dot={false} />
            ) : (
              <>
                <Line
                  yAxisId="left"
                  dataKey="suspected_uploads"
                  stroke="var(--color-suspected_uploads)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="left"
                  dataKey="symptom_elevated_uploads"
                  stroke="var(--color-symptom_elevated_uploads)"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
            <Line yAxisId="right" dataKey="ratio_pct" stroke="var(--color-ratio_pct)" strokeWidth={2} dot={false} />
            <ChartLegend content={<ChartLegendContent />} />
          </LineChart>
        </ChartContainer>
      </section>
    </div>
  );
}
