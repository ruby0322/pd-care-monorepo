"use client";

import clsx from "clsx";

import { getTaipeiTodayKey, listRecentTaipeiDateKeys } from "@/lib/utils/upload-calendar";

type CalendarDay = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

type PatientDailyCalendarProps = {
  days: CalendarDay[];
  windowDays?: number;
};

function dayStyle(uploadCount: number, hasSuspectedRisk: boolean): string {
  if (uploadCount <= 0) {
    return "bg-zinc-200";
  }

  if (hasSuspectedRisk) {
    if (uploadCount >= 3) return "bg-red-600";
    if (uploadCount >= 2) return "bg-red-500";
    return "bg-red-400";
  }

  if (uploadCount >= 3) return "bg-emerald-600";
  if (uploadCount >= 2) return "bg-emerald-500";
  return "bg-emerald-400";
}

export function PatientDailyCalendar({ days, windowDays = 28 }: PatientDailyCalendarProps) {
  const dayMap = new Map(days.map((entry) => [entry.date, entry]));
  const todayKey = getTaipeiTodayKey();
  const keys = listRecentTaipeiDateKeys(windowDays);

  const cells = keys.map((key) => {
    const record = dayMap.get(key);
    const uploadCount = record?.upload_count ?? 0;
    const hasSuspectedRisk = record?.has_suspected_risk ?? false;
    return {
      key,
      uploadCount,
      hasSuspectedRisk,
      isToday: key === todayKey,
    };
  });

  return (
    <section className="rounded-3xl border border-zinc-100 bg-zinc-50 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">每日上傳日曆</h2>
        <span className="text-xs text-zinc-400">近 {windowDays} 天</span>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-2">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={clsx(
              "h-8 rounded-md border border-white/80",
              dayStyle(cell.uploadCount, cell.hasSuspectedRisk),
              cell.isToday && "ring-2 ring-zinc-800/70 ring-offset-1"
            )}
            title={`${cell.key}：${cell.uploadCount} 次上傳`}
            aria-label={`${cell.key} ${cell.uploadCount} uploads`}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-zinc-200" />
          未上傳
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-emerald-500" />
          一般
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-red-500" />
          疑似風險
        </span>
        <span className="text-zinc-400">顏色深淺代表當日上傳次數</span>
      </div>
    </section>
  );
}
