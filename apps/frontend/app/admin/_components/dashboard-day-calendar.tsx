"use client";

import { ChevronLeft, ChevronRight, Image as ImageIcon, TriangleAlert, Users } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { buildTaipeiMonthGrid, getRelativeMonthKey } from "@/lib/utils/upload-calendar";

export type DayCalendarMetrics = {
  uploadCount: number;
  uploadedUsers: number;
  riskyPatients: number;
  unhandledPatients: number;
};

type DashboardDayCalendarProps = {
  selectedDate: string;
  monthKey: string;
  metricsByDate: Record<string, DayCalendarMetrics>;
  availableDates: Set<string> | string[];
  loading?: boolean;
  onSelectDate: (dateKey: string) => void;
  onMonthChange: (monthKey: string) => void;
};

function MetricChip({
  icon,
  value,
  selected,
  risk,
}: {
  icon: ReactNode;
  value: number;
  selected: boolean;
  risk?: boolean;
}) {
  const muted = risk ? value <= 0 : false;
  return (
    <div
      className={cn(
        "flex aspect-square min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg p-1",
        selected ? "bg-zinc-100" : "bg-white",
        risk && !muted && "text-red-600",
        muted && "text-zinc-300"
      )}
    >
      <span className={cn("shrink-0", risk && !muted ? "text-red-600" : muted ? "text-zinc-300" : "text-zinc-400")}>
        {icon}
      </span>
      <span className="text-xs font-semibold tabular-nums leading-none">{value}</span>
    </div>
  );
}

export function DashboardDayCalendar({
  selectedDate,
  monthKey,
  metricsByDate,
  availableDates,
  loading,
  onSelectDate,
  onMonthChange,
}: DashboardDayCalendarProps) {
  const available = availableDates instanceof Set ? availableDates : new Set(availableDates);
  const grid = buildTaipeiMonthGrid(monthKey);
  const title = `${grid.year} 年 ${grid.month} 月`;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="上個月"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          onClick={() => onMonthChange(getRelativeMonthKey(monthKey, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-zinc-700">
          {title}
          {loading ? <span className="ml-2 text-xs font-normal text-zinc-400">載入中…</span> : null}
        </div>
        <button
          type="button"
          aria-label="下個月"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          onClick={() => onMonthChange(getRelativeMonthKey(monthKey, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 grid w-full grid-cols-7 gap-2 text-center text-[11px] text-zinc-400">
        {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="grid w-full grid-cols-7 gap-2">
        {grid.cells.map((cell) => {
          if (!cell.isCurrentMonth) {
            return <div key={cell.dateKey} className="min-h-[96px]" />;
          }
          const metrics = metricsByDate[cell.dateKey];
          const isAvailable = available.has(cell.dateKey);
          const selected = selectedDate === cell.dateKey;
          const unhandled = metrics?.unhandledPatients ?? 0;
          const uploadCount = metrics?.uploadCount ?? 0;
          const uploadedUsers = metrics?.uploadedUsers ?? 0;
          const riskyPatients = metrics?.riskyPatients ?? 0;

          return (
            <button
              key={cell.dateKey}
              type="button"
              disabled={!isAvailable}
              onClick={() => onSelectDate(cell.dateKey)}
              className={cn(
                "flex min-h-[96px] min-w-0 flex-col rounded-xl bg-zinc-50 p-2.5 text-left transition",
                selected && "bg-white ring-2 ring-zinc-900",
                !isAvailable && "cursor-not-allowed border border-dashed border-zinc-200 bg-transparent opacity-60"
              )}
              title={
                isAvailable
                  ? `${cell.dateKey} · 上傳 ${uploadCount} · 人數 ${uploadedUsers} · 風險 ${riskyPatients}`
                  : `${cell.dateKey} 無資料`
              }
            >
              <div className="flex shrink-0 items-baseline justify-between gap-1">
                <span className={cn("text-[13px] font-semibold leading-tight", selected && "font-bold")}>
                  {cell.dayOfMonth}
                </span>
                {unhandled > 0 ? (
                  <span className="min-w-0 text-right text-[9px] font-medium leading-tight text-rose-400">
                    尚有 {unhandled} 未處理
                  </span>
                ) : null}
              </div>
              {isAvailable ? (
                <div className="mt-auto grid w-full grid-cols-3 gap-1 pt-2">
                  <MetricChip
                    selected={selected}
                    icon={<ImageIcon className="h-3.5 w-3.5" />}
                    value={uploadCount}
                  />
                  <MetricChip
                    selected={selected}
                    icon={<Users className="h-3.5 w-3.5" />}
                    value={uploadedUsers}
                  />
                  <MetricChip
                    selected={selected}
                    risk
                    icon={<TriangleAlert className="h-3.5 w-3.5" />}
                    value={riskyPatients}
                  />
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
