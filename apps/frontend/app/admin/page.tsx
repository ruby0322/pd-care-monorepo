"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Clock3,
  Download,
  Filter,
  Link2,
  Hospital,
  Upload,
  Users,
} from "lucide-react";
import clsx from "clsx";

import { useAdminNotifications } from "@/app/admin/_components/admin-notification-context";
import { getReadableApiError } from "@/lib/api/client";
import {
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
type SortKey = "case_number" | "age" | "upload_count" | "suspected_count" | "latest_upload";
type SortDir = "asc" | "desc";

const INFECTION_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "suspected", label: "疑似感染" },
  { value: "normal", label: "無感染" },
] as const;

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-zinc-300 ml-1 inline" strokeWidth={2} />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 text-zinc-600 ml-1 inline" strokeWidth={2} />
    : <ChevronDown className="w-3 h-3 text-zinc-600 ml-1 inline" strokeWidth={2} />;
}

function exportCSV(items: StaffPatientSummary[]) {
  const headers = ["病例號", "姓名", "年齡", "LINE帳號", "期間上傳次數", "疑似感染次數", "最近上傳日"];
  const rows = items.map((item) =>
    [
      item.case_number,
      item.full_name ?? "未命名",
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
  const [sortKey, setSortKey] = useState<SortKey>("latest_upload");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [patients, setPatients] = useState<StaffPatientSummary[]>([]);
  const [queue, setQueue] = useState<StaffUploadQueueItem[]>([]);
  const [pending, setPending] = useState<StaffPendingBindingItem[]>([]);
  const [stats, setStats] = useState({ totalPatients: 0, totalUploads: 0, suspectedPatients: 0 });
  const [selectedCandidate, setSelectedCandidate] = useState<Record<number, string>>({});
  const [workingPendingId, setWorkingPendingId] = useState<number | null>(null);
  const [newPatientNameByPendingId, setNewPatientNameByPendingId] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { notifications, unreadCount, markNotificationRead, markingIds, error: notificationError } = useAdminNotifications();

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const [patientsData, queueData, pendingData] = await Promise.all([
          fetchStaffPatients({
            months,
            ageMin: ageMin ? Number(ageMin) : undefined,
            ageMax: ageMax ? Number(ageMax) : undefined,
            infectionStatus,
            isActiveFilter: "active",
            sortKey,
            sortDir,
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
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [ageMax, ageMin, infectionStatus, months, sortDir, sortKey]);

  const pendingItems = useMemo(() => pending.filter((item) => item.status === "pending"), [pending]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "latest_upload" ? "desc" : "asc");
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
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleReject(item: StaffPendingBindingItem) {
    setWorkingPendingId(item.id);
    try {
      await rejectPendingBinding(item.id);
      await refreshPending();
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleLink(item: StaffPendingBindingItem) {
    const patientId = Number(selectedCandidate[item.id]);
    if (!patientId) {
      setErrorMessage("請先選擇要綁定的病患。");
      return;
    }
    setWorkingPendingId(item.id);
    try {
      await linkPendingBinding(item.id, patientId);
      await refreshPending();
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleCreateAndLink(item: StaffPendingBindingItem) {
    const fullName = (newPatientNameByPendingId[item.id] ?? "").trim();
    if (!fullName) {
      setErrorMessage("請先輸入病患姓名再建檔。");
      return;
    }
    setWorkingPendingId(item.id);
    try {
      await createPatientAndLinkPendingBinding(item.id, { full_name: fullName });
      await refreshPending();
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
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
            onClick={() => exportCSV(patients)}
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

      <div className="flex flex-wrap gap-3 items-center">
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
        <div className="bg-white border border-zinc-100 rounded-2xl p-5 flex flex-wrap gap-5">
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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

      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-50 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-900">病患列表</h2>
          <span className="text-xs text-zinc-400">{patients.length} 筆</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-50">
                <th className="px-5 py-3 text-left whitespace-nowrap">
                  <button onClick={() => handleSort("case_number")} className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700">
                    病例號
                    <SortIcon col="case_number" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-5 py-3 text-left whitespace-nowrap">姓名</th>
                <th className="px-5 py-3 text-left whitespace-nowrap">
                  <button onClick={() => handleSort("age")} className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700">
                    年齡
                    <SortIcon col="age" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-5 py-3 text-left whitespace-nowrap">
                  <button onClick={() => handleSort("upload_count")} className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700">
                    期間上傳
                    <SortIcon col="upload_count" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-5 py-3 text-left whitespace-nowrap">
                  <button onClick={() => handleSort("suspected_count")} className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700">
                    疑似感染
                    <SortIcon col="suspected_count" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-5 py-3 text-left whitespace-nowrap">
                  <button onClick={() => handleSort("latest_upload")} className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700">
                    最近上傳
                    <SortIcon col="latest_upload" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {loading && patients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-zinc-400">
                    載入中...
                  </td>
                </tr>
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-zinc-400">
                    無符合條件的病患資料
                  </td>
                </tr>
              ) : (
                patients.map((item) => (
                  <tr key={item.patient_id} className="hover:bg-zinc-50/50 transition-colors group">
                    <td className="px-5 py-3.5 text-xs font-mono text-zinc-500">{item.case_number}</td>
                    <td className="px-5 py-3.5 text-sm text-zinc-900">{item.full_name ?? "未命名"}</td>
                    <td className="px-5 py-3.5 text-sm text-zinc-600">{item.age ?? "-"}</td>
                    <td className="px-5 py-3.5 text-sm text-zinc-600">{item.upload_count}</td>
                    <td className="px-5 py-3.5 text-sm text-zinc-600">{item.suspected_count}</td>
                    <td className="px-5 py-3.5 text-xs text-zinc-400">
                      {item.latest_upload_at ? new Date(item.latest_upload_at).toLocaleDateString("zh-TW") : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/admin/patients/${item.patient_id}`}
                        className="flex items-center gap-1 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-700"
                      >
                        詳細 <ChevronRight className="w-3 h-3" strokeWidth={2} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
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
              notifications.map((item) => (
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
                        onClick={() => void markNotificationRead(item.id)}
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
        </section>

        <section className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-900">最新上傳佇列</h3>
          </div>
          <div className="divide-y divide-zinc-50">
            {queue.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有上傳資料。</p>
            ) : (
              queue.map((item) => (
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
        </section>

        <section className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-900">待審核綁定</h3>
          </div>
          <div className="divide-y divide-zinc-50">
            {pendingItems.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有待審核綁定。</p>
            ) : (
              pendingItems.map((item) => (
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
        </section>
      </div>
    </div>
  );
}
