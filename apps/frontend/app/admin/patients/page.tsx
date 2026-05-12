"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";

import { getReadableApiError } from "@/lib/api/client";
import { fetchStaffPatients, StaffPatientSummary, updateStaffPatientStatus } from "@/lib/api/staff";

type ActiveFilter = "all" | "active" | "inactive";

export default function AdminPatientsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patients, setPatients] = useState<StaffPatientSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [workingPatientId, setWorkingPatientId] = useState<number | null>(null);

  async function loadPatients() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchStaffPatients({
        months: 12,
        infectionStatus: "all",
        isActiveFilter: activeFilter,
        sortKey: "latest_upload",
        sortDir: "desc",
      });
      setPatients(response.items);
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPatients();
  }, [activeFilter]);

  async function togglePatientStatus(patient: StaffPatientSummary) {
    setWorkingPatientId(patient.patient_id);
    setError(null);
    try {
      await updateStaffPatientStatus(patient.patient_id, { is_active: !patient.is_active });
      await loadPatients();
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setWorkingPatientId(null);
    }
  }

  const filtered = patients.filter((item) => {
    if (!keyword.trim()) {
      return true;
    }
    const key = keyword.trim().toLowerCase();
    return (item.full_name ?? "").toLowerCase().includes(key) || item.case_number.toLowerCase().includes(key);
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">病患管理</h1>
          <p className="text-xs text-zinc-500">列表、搜尋、停權/恢復與病患詳情</p>
        </div>
        <button
          type="button"
          onClick={() => void loadPatients()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className="h-4 w-4" />
          重新整理
        </button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="w-56 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="搜尋姓名/病例號"
        />
        <select
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="all">全部狀態</option>
          <option value="active">僅啟用</option>
          <option value="inactive">僅停權</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="bg-zinc-50">
              <th className="px-4 py-3 text-left text-xs text-zinc-500">病例號</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500">姓名</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500">年齡</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500">上傳次數</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500">狀態</th>
              <th className="px-4 py-3 text-right text-xs text-zinc-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                  載入中...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-500">
                  找不到符合條件的病患
                </td>
              </tr>
            ) : (
              filtered.map((patient) => (
                <tr key={patient.patient_id}>
                  <td className="px-4 py-3 text-sm font-mono text-zinc-700">{patient.case_number}</td>
                  <td className="px-4 py-3 text-sm text-zinc-900">{patient.full_name ?? "未命名"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-700">{patient.age ?? "-"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-700">{patient.upload_count}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        patient.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {patient.is_active ? "啟用中" : "停權"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void togglePatientStatus(patient)}
                        disabled={workingPatientId === patient.patient_id}
                        className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {patient.is_active ? "停權" : "恢復"}
                      </button>
                      <Link
                        href={`/admin/patients/${patient.patient_id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        詳情
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
