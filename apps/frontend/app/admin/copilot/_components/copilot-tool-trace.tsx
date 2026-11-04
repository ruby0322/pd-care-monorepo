"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Database, Loader2 } from "lucide-react";
import { useState } from "react";

import type { CopilotToolTraceEntry } from "@/lib/api/copilot";

const TOOL_LABELS: Record<string, string> = {
  list_patients: "查詢病患清單",
  get_patient_detail: "查詢病患資料",
  list_patient_uploads: "查詢病患上傳歷程",
  get_patient_upload_calendar: "查詢病患上傳日曆",
  list_patient_annotations: "查詢病患標注",
  get_upload_queue: "查詢待審核佇列",
  get_today_attention: "查詢今日需關注病患",
  get_history_overview: "查詢單日歷史總覽",
  get_history_overview_days: "查詢有上傳的日期",
  get_workbench_dashboard: "查詢工作台摘要",
  get_cohort_suspected_series: "查詢全體感染趨勢",
  get_cohort_suspected_summary: "查詢全體感染統計",
  get_cohort_age_histogram: "查詢全體年齡分佈",
  get_cohort_gender_distribution: "查詢全體性別分佈",
  get_cohort_active_users: "查詢全體活躍人數",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

export function CopilotToolTrace({
  entries,
  pendingTool,
}: {
  entries: CopilotToolTraceEntry[];
  pendingTool?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (entries.length === 0 && !pendingTool) {
    return null;
  }

  const failures = entries.filter((entry) => !entry.ok).length;

  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
        {pendingTool ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            {toolLabel(pendingTool)}…
          </>
        ) : (
          <>
            <Database className="h-3.5 w-3.5" strokeWidth={1.5} />
            查詢步驟 {entries.length}
          </>
        )}
        {failures > 0 ? (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
            {failures}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <ol className="mt-2 ml-1 space-y-1.5 border-l border-zinc-200 pl-3.5">
          {entries.map((entry, index) => (
            <li key={index} className="text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={entry.ok ? "text-zinc-600" : "text-amber-700"}>{toolLabel(entry.tool)}</span>
                {entry.ok ? null : (
                  <span className="rounded bg-amber-50 px-1 text-amber-700">
                    {entry.status === 403
                      ? "權限不足"
                      : entry.status === 404
                        ? "找不到資料"
                        : `失敗${entry.status ? ` (${entry.status})` : ""}`}
                  </span>
                )}
                {entry.truncated ? <span className="rounded bg-zinc-100 px-1 text-zinc-500">資料已截斷</span> : null}
                {typeof entry.duration_ms === "number" ? (
                  <span className="text-zinc-300">{entry.duration_ms}ms</span>
                ) : null}
              </div>
              {entry.params && Object.keys(entry.params).length > 0 ? (
                <div className="mt-0.5 font-mono text-[11px] text-zinc-400">{JSON.stringify(entry.params)}</div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
