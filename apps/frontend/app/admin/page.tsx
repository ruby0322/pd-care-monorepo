"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Clock3,
  Download,
  Filter,
  Link2,
  Hospital,
  Upload,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

import { useAdminNotifications } from "@/app/admin/_components/admin-notification-context";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getReadableApiError } from "@/lib/api/client";
import {
  fetchAdminActiveUsersSeries,
  fetchAdminDailySuspectedSeries,
  fetchAdminTodaySuspectedSummary,
  approvePendingBinding,
  fetchPendingBindings,
  fetchStaffPatients,
  fetchUploadQueue,
  createPatientAndLinkPendingBinding,
  linkPendingBinding,
  rejectPendingBinding,
  StaffPatientSummary,
  StaffPendingBindingItem,
  StaffUploadQueueItem,
} from "@/lib/api/staff";

const PERIOD_OPTIONS = [1, 2, 3, 6, 12, 24, 36, 60] as const;
type Period = (typeof PERIOD_OPTIONS)[number];
type InfectionStatus = "all" | "suspected" | "normal";

const INFECTION_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "suspected", label: "疑似感染" },
  { value: "normal", label: "無感染" },
] as const;

const ACTIVE_WINDOW_OPTIONS = [3, 7, 14, 30] as const;
const LOOKBACK_OPTIONS = [30, 60, 90] as const;
type ChartType = "bar" | "pie";

function exportCSV(items: StaffPatientSummary[]) {
  const headers = ["病例號", "姓名", "LINE 名稱", "年齡", "LINE 帳號", "期間上傳次數", "疑似感染次數", "最近上傳日"];
  const rows = items.map((item) =>
    [
      item.case_number,
      item.full_name ?? "未命名",
      item.line_display_name ?? "-",
      item.age ?? "-",
      item.line_user_id ?? "-",
      item.upload_count,
      item.suspected_count,
      item.latest_upload_at ? new Date(item.latest_upload_at).toLocaleDateString("zh-TW") : "-",
    ].join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pd-care-report-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AdminDashboard() {
  const [months, setMonths] = useState<Period>(12);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [infectionStatus, setInfectionStatus] = useState<InfectionStatus>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [patients, setPatients] = useState<StaffPatientSummary[]>([]);
  const [queue, setQueue] = useState<StaffUploadQueueItem[]>([]);
  const [pending, setPending] = useState<StaffPendingBindingItem[]>([]);
  const [stats, setStats] = useState({ totalPatients: 0, totalUploads: 0, suspectedPatients: 0 });
  const [selectedCandidate, setSelectedCandidate] = useState<Record<number, string>>({});
  const [workingPendingId, setWorkingPendingId] = useState<number | null>(null);
  const [newPatientNameByPendingId, setNewPatientNameByPendingId] = useState<Record<number, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [showAllPending, setShowAllPending] = useState(false);
  const [todayChartType, setTodayChartType] = useState<ChartType>("bar");
  const [activeWindowDays, setActiveWindowDays] = useState<(typeof ACTIVE_WINDOW_OPTIONS)[number]>(7);
  const [activeLookbackDays, setActiveLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [activeInterval, setActiveInterval] = useState<"day" | "week">("day");
  const [dailyLookbackDays, setDailyLookbackDays] = useState<(typeof LOOKBACK_OPTIONS)[number]>(30);
  const [todaySummary, setTodaySummary] = useState<{
    total_uploads: number;
    suspected_uploads: number;
    normal_uploads: number;
    suspected_ratio: number;
  } | null>(null);
  const [activeUsersSeries, setActiveUsersSeries] = useState<{ date: string; active_users: number }[]>([]);
  const [dailySuspectedSeries, setDailySuspectedSeries] = useState<
    { date: string; total_uploads: number; suspected_uploads: number; suspected_ratio: number }[]
  >([]);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const { notifications, unreadCount, markNotificationRead, markingIds, error: notificationError } = useAdminNotifications();

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setErrorMessage(null);
      try {
        const [patientsData, queueData, pendingData] = await Promise.all([
          fetchStaffPatients({
            months,
            ageMin: ageMin ? Number(ageMin) : undefined,
            ageMax: ageMax ? Number(ageMax) : undefined,
            infectionStatus,
            isActiveFilter: "active",
            sortKey: "latest_upload",
            sortDir: "desc",
          }),
          fetchUploadQueue({ limit: 12 }),
          fetchPendingBindings(),
        ]);
        if (cancelled) {
          return;
        }
        setPatients(patientsData.items);
        setStats({
          totalPatients: patientsData.total_patients,
          totalUploads: patientsData.total_uploads,
          suspectedPatients: patientsData.suspected_patients,
        });
        setQueue(queueData.items);
        setPending(pendingData);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(getReadableApiError(error));
        }
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [ageMax, ageMin, infectionStatus, months]);

  useEffect(() => {
    let cancelled = false;
    async function loadAnalytics() {
      setAnalyticsError(null);
      try {
        const [todayData, activeData, dailyData] = await Promise.all([
          fetchAdminTodaySuspectedSummary(),
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
        setTodaySummary(todayData);
        setActiveUsersSeries(activeData.items);
        setDailySuspectedSeries(dailyData.items);
      } catch (error) {
        if (!cancelled) {
          setAnalyticsError(getReadableApiError(error));
        }
      }
    }
    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [activeInterval, activeLookbackDays, activeWindowDays, dailyLookbackDays]);

  const pendingItems = useMemo(() => pending.filter((item) => item.status === "pending"), [pending]);
  const visibleNotifications = useMemo(
    () => (showAllNotifications ? notifications : notifications.slice(0, 3)),
    [notifications, showAllNotifications]
  );
  const visibleQueue = useMemo(() => (showAllQueue ? queue : queue.slice(0, 3)), [queue, showAllQueue]);
  const visiblePending = useMemo(
    () => (showAllPending ? pendingItems : pendingItems.slice(0, 3)),
    [pendingItems, showAllPending]
  );
  const todayChartData = useMemo(
    () => [
      { key: "suspected", label: "疑似", count: todaySummary?.suspected_uploads ?? 0, fill: "#dc2626" },
      { key: "normal", label: "非疑似", count: todaySummary?.normal_uploads ?? 0, fill: "#16a34a" },
    ],
    [todaySummary]
  );
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
      dailySuspectedSeries.map((point) => ({
        ...point,
        shortDate: new Date(point.date).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }),
        ratio_pct: Number((point.suspected_ratio * 100).toFixed(1)),
      })),
    [dailySuspectedSeries]
  );
  const todayChartConfig: ChartConfig = {
    suspected: { label: "疑似", color: "#dc2626" },
    normal: { label: "非疑似", color: "#16a34a" },
    count: { label: "筆數" },
  };
  const activeChartConfig: ChartConfig = {
    active_users: { label: "活躍用戶", color: "#2563eb" },
  };
  const dailyChartConfig: ChartConfig = {
    suspected_uploads: { label: "疑似數量", color: "#dc2626" },
    ratio_pct: { label: "疑似比例(%)", color: "#2563eb" },
  };

  async function refreshPending() {
    const items = await fetchPendingBindings();
    setPending(items);
  }

  async function handleApprove(item: StaffPendingBindingItem) {
    setWorkingPendingId(item.id);
    try {
      await approvePendingBinding(item.id);
      await refreshPending();
      toast.success("已核准綁定申請");
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleReject(item: StaffPendingBindingItem) {
    setWorkingPendingId(item.id);
    try {
      await rejectPendingBinding(item.id);
      await refreshPending();
      toast.success("已駁回綁定申請");
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleLink(item: StaffPendingBindingItem) {
    const patientId = Number(selectedCandidate[item.id]);
    if (!patientId) {
      toast.error("請先選擇要綁定的病患。");
      return;
    }
    setWorkingPendingId(item.id);
    try {
      await linkPendingBinding(item.id, patientId);
      await refreshPending();
      toast.success("已完成指定綁定");
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleCreateAndLink(item: StaffPendingBindingItem) {
    const fullName = (newPatientNameByPendingId[item.id] ?? "").trim();
    if (!fullName) {
      toast.error("請先輸入病患姓名再建檔。");
      return;
    }
    setWorkingPendingId(item.id);
    try {
      await createPatientAndLinkPendingBinding(item.id, { full_name: fullName });
      await refreshPending();
      toast.success("建檔並綁定完成");
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleMarkNotificationRead(notificationId: number) {
    try {
      await markNotificationRead(notificationId);
      toast.success("已標記為已讀");
    } catch (error) {
      toast.error(getReadableApiError(error));
    }
  }

  function handleExportReport() {
    try {
      exportCSV(patients);
      toast.success("報表已匯出");
    } catch {
      toast.error("匯出失敗，請稍後再試");
    }
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">儀表板</h1>
          <p className="text-xs text-zinc-400 mt-0.5">腹膜透析出口感染監測</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/patients"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Hospital className="h-4 w-4" />
            病患管理
          </Link>
          <button
            onClick={handleExportReport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 text-sm hover:bg-zinc-50 transition-colors"
          >
            <Download className="w-4 h-4" strokeWidth={1.5} />
            匯出報表
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}
      {notificationError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{notificationError}</div>
      ) : null}
      {analyticsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{analyticsError}</div>
      ) : null}

      <div className="flex flex-wrap gap-3 items-center order-2">
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-xl p-1 flex-wrap">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setMonths(option)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                months === option ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {option}月
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-colors",
            showFilters ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          )}
        >
          <Filter className="w-3.5 h-3.5" strokeWidth={1.5} />
          篩選
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5 flex flex-wrap gap-5 order-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">年齡區間</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="最小"
                value={ageMin}
                onChange={(event) => setAgeMin(event.target.value)}
                className="w-20 px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              />
              <span className="text-zinc-300 text-sm">–</span>
              <input
                type="number"
                placeholder="最大"
                value={ageMax}
                onChange={(event) => setAgeMax(event.target.value)}
                className="w-20 px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">感染狀態</label>
            <div className="flex items-center gap-1.5">
              {INFECTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setInfectionStatus(option.value)}
                  className={clsx(
                    "px-3 py-2 rounded-lg border text-sm transition-colors",
                    infectionStatus === option.value
                      ? "bg-zinc-900 border-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setAgeMin("");
                setAgeMax("");
                setInfectionStatus("all");
              }}
              className="px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              清除篩選
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 order-2">
        {[
          { icon: Users, label: "篩選病患數", value: stats.totalPatients, color: "zinc" },
          { icon: Upload, label: `${months} 月上傳次數`, value: stats.totalUploads, color: "zinc" },
          { icon: AlertTriangle, label: "疑似感染人數", value: stats.suspectedPatients, color: "red" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-5 flex flex-col gap-3">
            <div className={clsx("w-8 h-8 rounded-xl flex items-center justify-center", color === "red" ? "bg-red-50" : "bg-zinc-50")}>
              <Icon className={clsx("w-4 h-4", color === "red" ? "text-red-500" : "text-zinc-500")} strokeWidth={1.5} />
            </div>
            <div>
              <div className={clsx("text-2xl font-semibold", color === "red" ? "text-red-600" : "text-zinc-900")}>{value}</div>
              <div className="text-xs text-zinc-400 mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <section className="order-2 flex flex-col gap-4">
        <div className="mb-2">
          <h2 className="text-base font-semibold text-zinc-900">分析圖表</h2>
          <p className="text-xs text-zinc-500">活躍用戶與每日疑似感染趨勢</p>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-900">今日疑似感染</h3>
              <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1 text-xs">
                <button
                  className={clsx(
                    "rounded px-2 py-1",
                    todayChartType === "bar" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  )}
                  onClick={() => setTodayChartType("bar")}
                >
                  長條
                </button>
                <button
                  className={clsx(
                    "rounded px-2 py-1",
                    todayChartType === "pie" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                  )}
                  onClick={() => setTodayChartType("pie")}
                >
                  圓餅
                </button>
              </div>
            </div>
            <p className="mb-2 text-xs text-zinc-500">
              疑似比例 {((todaySummary?.suspected_ratio ?? 0) * 100).toFixed(1)}%（共 {todaySummary?.total_uploads ?? 0} 筆）
            </p>
            <ChartContainer className="h-64 w-full" config={todayChartConfig}>
              {todayChartType === "bar" ? (
                <BarChart data={todayChartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={6}>
                    {todayChartData.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie data={todayChartData} dataKey="count" nameKey="label" outerRadius={90}>
                    {todayChartData.map((item) => (
                      <Cell key={item.key} fill={item.fill} />
                    ))}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              )}
            </ChartContainer>
          </div>

          <div className="space-y-3">
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
          </div>

          <div className="space-y-3 xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-900">每日疑似感染比例與數量</h3>
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
            <ChartContainer className="h-72 w-full" config={dailyChartConfig}>
              <LineChart data={dailySuspectedChartData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="shortDate" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line yAxisId="left" dataKey="suspected_uploads" stroke="var(--color-suspected_uploads)" strokeWidth={2} dot={false} />
                <Line yAxisId="right" dataKey="ratio_pct" stroke="var(--color-ratio_pct)" strokeWidth={2} dot={false} />
                <ChartLegend content={<ChartLegendContent />} />
              </LineChart>
            </ChartContainer>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 order-1">
        <section className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-900">疑似感染通知</h3>
            </div>
            <span
              className={clsx(
                "max-w-16 whitespace-normal break-words rounded-full px-2 py-0.5 text-center text-xs leading-tight",
                unreadCount > 0 ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"
              )}
            >
              未讀 {unreadCount}
            </span>
          </div>
          <div className="divide-y divide-zinc-50">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有疑似感染通知。</p>
            ) : (
              visibleNotifications.map((item) => (
                <div key={item.id} className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm text-zinc-900">{item.patient_full_name ?? "未命名"} ({item.patient_case_number})</p>
                      <p className="text-xs text-zinc-500">{new Date(item.created_at).toLocaleString("zh-TW")}</p>
                      {item.summary ? <p className="text-xs text-zinc-500 mt-1">{item.summary}</p> : null}
                    </div>
                    <span
                      className={clsx(
                        "max-w-16 whitespace-normal break-words rounded-full px-2 py-0.5 text-center text-[11px] leading-tight",
                        item.status === "new" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"
                      )}
                    >
                      {item.status === "new" ? "新通知" : item.status === "reviewed" ? "已讀" : "已處理"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Link href={`/admin/patients/${item.patient_id}`} className="text-xs text-zinc-500 hover:text-zinc-800">
                      檢視病患
                    </Link>
                    {item.status === "new" ? (
                      <button
                        onClick={() => void handleMarkNotificationRead(item.id)}
                        disabled={Boolean(markingIds[item.id])}
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                      >
                        標記已讀
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
          {notifications.length > 3 ? (
            <button
              type="button"
              onClick={() => setShowAllNotifications((current) => !current)}
              className="w-full border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 hover:bg-zinc-50"
            >
              {showAllNotifications ? "收合" : "查看全部"}
            </button>
          ) : null}
        </section>

        <section className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock3 className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-900">最新上傳佇列</h3>
            </div>
            <Link href="/admin/review" className="text-xs text-zinc-500 hover:text-zinc-800">
              進入快速審核
            </Link>
          </div>
          <div className="divide-y divide-zinc-50">
            {queue.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有上傳資料。</p>
            ) : (
              visibleQueue.map((item) => (
                <div key={item.upload_id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-zinc-900">{item.full_name ?? "未命名"}</p>
                    <p className="text-xs text-zinc-500">
                      {item.case_number} · {item.screening_result} · {new Date(item.created_at).toLocaleString("zh-TW")}
                    </p>
                  </div>
                  <Link href={`/admin/patients/${item.patient_id}`} className="text-xs text-zinc-500 hover:text-zinc-800">
                    檢視
                  </Link>
                </div>
              ))
            )}
          </div>
          {queue.length > 3 ? (
            <button
              type="button"
              onClick={() => setShowAllQueue((current) => !current)}
              className="w-full border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 hover:bg-zinc-50"
            >
              {showAllQueue ? "收合" : "查看全部"}
            </button>
          ) : null}
        </section>

        <section className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-900">待審核綁定</h3>
            </div>
            <Link href="/admin/review" className="text-xs text-zinc-500 hover:text-zinc-800">
              進入快速審核
            </Link>
          </div>
          <div className="divide-y divide-zinc-50">
            {pendingItems.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有待審核綁定。</p>
            ) : (
              visiblePending.map((item) => (
                <div key={item.id} className="px-4 py-3 flex flex-col gap-2">
                  <p className="text-sm text-zinc-900">
                    {item.case_number} / {item.birth_date}
                  </p>
                  <p className="text-xs text-zinc-500 font-mono">{item.line_user_id}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.candidates.length > 0 ? (
                      <>
                        <select
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                          value={selectedCandidate[item.id] ?? ""}
                          onChange={(event) =>
                            setSelectedCandidate((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                        >
                          <option value="">選擇病患</option>
                          {item.candidates.map((candidate) => (
                            <option key={candidate.patient_id} value={candidate.patient_id}>
                              {candidate.case_number} - {candidate.full_name ?? "未命名"}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => void handleLink(item)}
                          disabled={workingPendingId === item.id}
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          指定綁定
                        </button>
                        <button
                          onClick={() => void handleApprove(item)}
                          disabled={workingPendingId === item.id || item.candidates.length !== 1}
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                        >
                          一鍵核准
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={newPatientNameByPendingId[item.id] ?? ""}
                          onChange={(event) =>
                            setNewPatientNameByPendingId((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                          placeholder="新病患姓名"
                        />
                        <button
                          onClick={() => void handleCreateAndLink(item)}
                          disabled={workingPendingId === item.id}
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          建檔並綁定
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => void handleReject(item)}
                      disabled={workingPendingId === item.id}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      駁回
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {pendingItems.length > 3 ? (
            <button
              type="button"
              onClick={() => setShowAllPending((current) => !current)}
              className="w-full border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 hover:bg-zinc-50"
            >
              {showAllPending ? "收合" : "查看全部"}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
