"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Download,
  Users,
  Upload,
  AlertTriangle,
  Filter,
  ChevronsUpDown,
} from "lucide-react";
import clsx from "clsx";
import { filterPatients, getPeriodRecords, getStats } from "@/lib/mock-data";
import { Patient } from "@/lib/types";

const PERIOD_OPTIONS = [1, 2, 3, 6, 12, 24, 36, 60] as const;
type Period = (typeof PERIOD_OPTIONS)[number];

const GENDER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "male", label: "男" },
  { value: "female", label: "女" },
] as const;

const INFECTION_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "suspected", label: "疑似感染" },
  { value: "normal", label: "無感染" },
] as const;

type SortKey = "caseNumber" | "name" | "age" | "gender" | "uploadCount" | "suspectedCount" | "latestUpload";
type SortDir = "asc" | "desc";

function exportCSV(patients: Patient[], months: number) {
  const headers = ["病例號", "姓名", "年齡", "性別", "LINE帳號", "期間上傳次數", "疑似感染次數", "最近上傳日"];
  const rows = patients.map((p) => {
    const recs = getPeriodRecords(p, months);
    const suspectedCount = recs.filter((r) => r.aiResult.classification === "suspected").length;
    const latestUpload = [...recs].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
    return [
      p.caseNumber,
      p.name,
      p.age,
      p.gender === "male" ? "男" : "女",
      p.lineUsername,
      recs.length,
      suspectedCount,
      latestUpload ? new Date(latestUpload.uploadedAt).toLocaleDateString("zh-TW") : "-",
    ].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pd-care-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-zinc-300 ml-1 inline" strokeWidth={2} />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 text-zinc-600 ml-1 inline" strokeWidth={2} />
    : <ChevronDown className="w-3 h-3 text-zinc-600 ml-1 inline" strokeWidth={2} />;
}

export default function AdminDashboard() {
  const [months, setMonths] = useState<Period>(12);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [gender, setGender] = useState<"all" | "male" | "female">("all");
  const [infectionStatus, setInfectionStatus] = useState<"all" | "suspected" | "normal">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    return filterPatients({
      months,
      ageMin: ageMin ? Number(ageMin) : undefined,
      ageMax: ageMax ? Number(ageMax) : undefined,
      gender,
      infectionStatus,
    });
  }, [months, ageMin, ageMax, gender, infectionStatus]);

  const stats = useMemo(() => getStats(filtered, months), [filtered, months]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const recsA = getPeriodRecords(a, months);
      const recsB = getPeriodRecords(b, months);

      let valA: string | number;
      let valB: string | number;

      switch (sortKey) {
        case "caseNumber": valA = a.caseNumber; valB = b.caseNumber; break;
        case "name": valA = a.name; valB = b.name; break;
        case "age": valA = a.age; valB = b.age; break;
        case "gender": valA = a.gender; valB = b.gender; break;
        case "uploadCount": valA = recsA.length; valB = recsB.length; break;
        case "suspectedCount":
          valA = recsA.filter((r) => r.aiResult.classification === "suspected").length;
          valB = recsB.filter((r) => r.aiResult.classification === "suspected").length;
          break;
        case "latestUpload": {
          const latA = [...recsA].sort((x, y) => new Date(y.uploadedAt).getTime() - new Date(x.uploadedAt).getTime())[0];
          const latB = [...recsB].sort((x, y) => new Date(y.uploadedAt).getTime() - new Date(x.uploadedAt).getTime())[0];
          valA = latA ? new Date(latA.uploadedAt).getTime() : 0;
          valB = latB ? new Date(latB.uploadedAt).getTime() : 0;
          break;
        }
        default: return 0;
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir, months]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: "caseNumber", label: "病例號" },
    { key: "name", label: "姓名" },
    { key: "age", label: "年齡" },
    { key: "gender", label: "性別" },
    { key: "uploadCount", label: "期間上傳" },
    { key: "suspectedCount", label: "疑似感染" },
    { key: "latestUpload", label: "最近上傳" },
  ];

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">儀表板</h1>
          <p className="text-xs text-zinc-400 mt-0.5">腹膜透析出口感染監測</p>
        </div>
        <button
          onClick={() => exportCSV(filtered, months)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 text-zinc-700 text-sm hover:bg-zinc-50 transition-colors"
        >
          <Download className="w-4 h-4" strokeWidth={1.5} />
          匯出報表
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-xl p-1 flex-wrap">
          {PERIOD_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                months === m ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {m}月
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
                onChange={(e) => setAgeMin(e.target.value)}
                className="w-20 px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              />
              <span className="text-zinc-300 text-sm">–</span>
              <input
                type="number"
                placeholder="最大"
                value={ageMax}
                onChange={(e) => setAgeMax(e.target.value)}
                className="w-20 px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">性別</label>
            <div className="flex items-center gap-1.5">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setGender(opt.value)}
                  className={clsx(
                    "px-3 py-2 rounded-lg border text-sm transition-colors",
                    gender === opt.value
                      ? "bg-zinc-900 border-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">感染狀態</label>
            <div className="flex items-center gap-1.5">
              {INFECTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInfectionStatus(opt.value)}
                  className={clsx(
                    "px-3 py-2 rounded-lg border text-sm transition-colors",
                    infectionStatus === opt.value
                      ? "bg-zinc-900 border-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => { setAgeMin(""); setAgeMax(""); setGender("all"); setInfectionStatus("all"); }}
              className="px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              清除篩選
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { icon: Users, label: "篩選病患數", value: stats.total, color: "zinc" },
          { icon: Upload, label: `${months} 月上傳次數`, value: stats.totalUploads, color: "zinc" },
          { icon: AlertTriangle, label: "疑似感染人數", value: stats.suspectedCount, color: "red" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-5 flex flex-col gap-3">
            <div className={clsx("w-8 h-8 rounded-xl flex items-center justify-center", color === "red" ? "bg-red-50" : "bg-zinc-50")}>
              <Icon className={clsx("w-4 h-4", color === "red" ? "text-red-500" : "text-zinc-500")} strokeWidth={1.5} />
            </div>
            <div>
              <div className={clsx("text-2xl font-semibold", color === "red" ? "text-red-600" : "text-zinc-900")}>
                {value}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-50 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-900">病患列表</h2>
          <span className="text-xs text-zinc-400">{sorted.length} 筆</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-50">
                {COLUMNS.map(({ key, label }) => (
                  <th key={key} className="px-5 py-3 text-left whitespace-nowrap">
                    <button
                      onClick={() => handleSort(key)}
                      className="flex items-center text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors"
                    >
                      {label}
                      <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </th>
                ))}
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {sorted.map((p) => {
                const recs = getPeriodRecords(p, months);
                const suspectedCount = recs.filter((r) => r.aiResult.classification === "suspected").length;
                const latest = [...recs].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
                const hasSuspected = suspectedCount > 0;
                return (
                  <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors group">
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono text-zinc-500">{p.caseNumber}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-zinc-900">{p.name}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-zinc-600">{p.age}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-zinc-600">{p.gender === "male" ? "男" : "女"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-zinc-600">{recs.length} 次</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {hasSuspected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-600 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          {suspectedCount} 次
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          無
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-zinc-400">
                        {latest ? new Date(latest.uploadedAt).toLocaleDateString("zh-TW") : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/admin/patients/${p.id}`}
                        className="flex items-center gap-1 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-700"
                      >
                        詳細 <ChevronRight className="w-3 h-3" strokeWidth={2} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-zinc-400">
                    無符合條件的病患資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
