"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getElevatedUserKpi, getSuspectedKpi } from "@/lib/admin/dashboard-kpi";
import { getReadableApiError } from "@/lib/api/client";
import { fetchAdminSuspectedSummary, fetchStaffPatients } from "@/lib/api/staff";

const PERIOD_OPTIONS = ["today", 1, 2, 3, 6, 12, 24, 36, 60] as const;
type Period = (typeof PERIOD_OPTIONS)[number];
type ChartType = "bar" | "pie";

const todayChartConfig = {
  count: { label: "筆數" },
  suspected: { label: "疑似感染", color: "#dc2626" },
  elevated: { label: "症狀高風險", color: "#f97316" },
  normal: { label: "正常", color: "#16a34a" },
  risk: { label: "風險合計", color: "#dc2626" },
} satisfies ChartConfig;

export function ClinicalPeriodPanel() {
  const [months, setMonths] = useState<Period>(1);
  const [riskChartMode, setRiskChartMode] = useState<"split" | "aggregate">("split");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [patientCount, setPatientCount] = useState(0);
  const [riskSummary, setRiskSummary] = useState<{
    total_uploads: number;
    suspected_uploads: number;
    symptom_elevated_uploads: number;
    suspected_users: number;
    symptom_elevated_users: number;
    normal_uploads: number;
    suspected_ratio: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const queryMonths = months === "today" ? 1 : months;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [patientsData, summary] = await Promise.all([
          fetchStaffPatients({
            months: queryMonths,
            infectionStatus: "all",
            isActiveFilter: "active",
            sortKey: "latest_upload",
            sortDir: "desc",
            limit: 1,
          }),
          months === "today"
            ? fetchAdminSuspectedSummary({ isActiveFilter: "active" })
            : fetchAdminSuspectedSummary({ months, isActiveFilter: "active" }),
        ]);
        if (cancelled) {
          return;
        }
        setPatientCount(patientsData.total_patients);
        setRiskSummary(summary);
      } catch (err) {
        if (!cancelled) {
          setError(getReadableApiError(err));
          setRiskSummary(null);
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
  }, [months, queryMonths]);

  const riskChartData = useMemo(() => {
    const suspected = riskSummary?.suspected_uploads ?? 0;
    const elevated = riskSummary?.symptom_elevated_uploads ?? 0;
    const normal = riskSummary?.normal_uploads ?? 0;
    if (riskChartMode === "aggregate") {
      return [
        { key: "risk", label: "風險合計", count: suspected + elevated, fill: "#dc2626" },
        { key: "normal", label: "正常", count: normal, fill: "#16a34a" },
      ];
    }
    return [
      { key: "suspected", label: "疑似感染", count: suspected, fill: "#dc2626" },
      { key: "elevated", label: "症狀高風險", count: elevated, fill: "#f97316" },
      { key: "normal", label: "正常", count: normal, fill: "#16a34a" },
    ];
  }, [riskChartMode, riskSummary]);

  const riskChartRatio = useMemo(() => {
    if (!riskSummary || riskSummary.total_uploads <= 0) {
      return 0;
    }
    if (riskChartMode === "aggregate") {
      return (riskSummary.suspected_uploads + riskSummary.symptom_elevated_uploads) / riskSummary.total_uploads;
    }
    return riskSummary.suspected_ratio;
  }, [riskChartMode, riskSummary]);

  const suspectedKpi = getSuspectedKpi(months, riskSummary?.suspected_users);
  const elevatedKpi = getElevatedUserKpi(months, riskSummary?.symptom_elevated_users);
  const uploadLabel = months === "today" ? "今日上傳次數" : `${months} 月上傳次數`;
  const chartTitle = months === "today" ? "今日疑似感染" : `${months} 月疑似感染`;

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap gap-1.5">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={String(option)}
            type="button"
            onClick={() => setMonths(option)}
            className={clsx(
              "rounded-lg px-2.5 py-1 text-xs font-medium",
              months === option ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            )}
          >
            {option === "today" ? "今日" : `${option} 月`}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-zinc-400">載入區間指標…</p> : null}
      {error ? <p className="text-sm text-zinc-500">{error}</p> : null}

      {!loading && !error ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{suspectedKpi.label}</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{suspectedKpi.value}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{elevatedKpi.label}</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{elevatedKpi.value}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{uploadLabel}</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{riskSummary?.total_uploads ?? 0}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">篩選病患數</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{patientCount}</p>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-900">{chartTitle}</h3>
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
                <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1">
                  <button
                    type="button"
                    className={clsx("rounded px-2 py-1", chartType === "bar" ? "bg-zinc-900 text-white" : "text-zinc-600")}
                    onClick={() => setChartType("bar")}
                  >
                    長條
                  </button>
                  <button
                    type="button"
                    className={clsx("rounded px-2 py-1", chartType === "pie" ? "bg-zinc-900 text-white" : "text-zinc-600")}
                    onClick={() => setChartType("pie")}
                  >
                    圓餅
                  </button>
                </div>
              </div>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              {riskChartMode === "aggregate" ? "風險比例" : "疑似比例"} {(riskChartRatio * 100).toFixed(1)}%（共{" "}
              {riskSummary?.total_uploads ?? 0} 筆）
            </p>
            <ChartContainer className="h-64 w-full" config={todayChartConfig}>
              {chartType === "bar" ? (
                <BarChart data={riskChartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={6}>
                    {riskChartData.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie data={riskChartData} dataKey="count" nameKey="label" outerRadius={90}>
                    {riskChartData.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              )}
            </ChartContainer>
          </div>
        </>
      ) : null}
    </section>
  );
}
