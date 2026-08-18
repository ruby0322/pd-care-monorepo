"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Image as ImageIcon, TriangleAlert, Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  buildTaipeiWeekRow,
  formatTaipeiWeekRangeLabel,
  getTaipeiTodayKey,
  getWeekStartDateKey,
  parseTaipeiDateKey,
  shiftTaipeiDateKey,
} from "@/lib/utils/upload-calendar";

export type DayCalendarMetrics = {
  uploadCount: number;
  uploadedUsers: number;
  riskyPatients: number;
  unhandledPatients: number;
};

type DashboardDayCalendarProps = {
  selectedDate: string;
  weekStartDateKey: string;
  metricsByDate: Record<string, DayCalendarMetrics>;
  availableDates: Set<string> | string[];
  loading?: boolean;
  onSelectDate: (dateKey: string) => void;
  onWeekChange: (weekStartDateKey: string) => void;
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

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function formatTaipeiDateLabel(dateKey: string): string {
  const { year, month, day } = parseTaipeiDateKey(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${year} 年 ${month} 月 ${day} 日（${WEEKDAY_LABELS[weekday]}）`;
}

function DayCellButton({
  cell,
  metricsByDate,
  available,
  selected,
  isToday,
  onSelectDate,
  className,
}: {
  cell: { dateKey: string; dayOfMonth: number };
  metricsByDate: Record<string, DayCalendarMetrics>;
  available: Set<string>;
  selected: boolean;
  isToday: boolean;
  onSelectDate: (dateKey: string) => void;
  className?: string;
}) {
  const metrics = metricsByDate[cell.dateKey];
  const isAvailable = available.has(cell.dateKey);
  const unhandled = metrics?.unhandledPatients ?? 0;
  const uploadCount = metrics?.uploadCount ?? 0;
  const uploadedUsers = metrics?.uploadedUsers ?? 0;
  const riskyPatients = metrics?.riskyPatients ?? 0;

  return (
    <button
      type="button"
      disabled={!isAvailable}
      onClick={() => onSelectDate(cell.dateKey)}
      className={cn(
        "flex min-h-[96px] min-w-0 flex-col rounded-xl bg-zinc-50 p-2.5 text-left transition",
        selected && "bg-white ring-2 ring-zinc-900",
        !isAvailable && "cursor-not-allowed border border-dashed border-zinc-200 bg-transparent opacity-60",
        className
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
          {isToday ? <span className="ml-0.5 text-[10px] font-medium text-zinc-500">（今天）</span> : null}
        </span>
        {unhandled > 0 ? (
          <span className="min-w-0 text-right text-[9px] font-medium leading-tight text-rose-400">
            尚有 {unhandled} 未處理
          </span>
        ) : null}
      </div>
      {isAvailable ? (
        <div className="mt-auto grid w-full grid-cols-3 gap-1 pt-2">
          <MetricChip selected={selected} icon={<ImageIcon className="h-3.5 w-3.5" />} value={uploadCount} />
          <MetricChip selected={selected} icon={<Users className="h-3.5 w-3.5" />} value={uploadedUsers} />
          <MetricChip selected={selected} risk icon={<TriangleAlert className="h-3.5 w-3.5" />} value={riskyPatients} />
        </div>
      ) : null}
    </button>
  );
}

export function DashboardDayCalendar({
  selectedDate,
  weekStartDateKey,
  metricsByDate,
  availableDates,
  loading,
  onSelectDate,
  onWeekChange,
}: DashboardDayCalendarProps) {
  const available = useMemo(
    () => (availableDates instanceof Set ? availableDates : new Set(availableDates)),
    [availableDates]
  );
  const todayKey = getTaipeiTodayKey();
  const weekCells = buildTaipeiWeekRow(weekStartDateKey);
  const weekTitle = formatTaipeiWeekRangeLabel(weekStartDateKey);
  const mobileTitle = formatTaipeiDateLabel(selectedDate);
  const selectedCell = useMemo(() => {
    const { day } = parseTaipeiDateKey(selectedDate);
    return { dateKey: selectedDate, dayOfMonth: day };
  }, [selectedDate]);
  const datePickerId = useId();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const moveSelectedByDays = useCallback(
    (offsetDays: number) => {
      let candidate = selectedDate;
      for (let step = 0; step < 366; step += 1) {
        candidate = shiftTaipeiDateKey(candidate, offsetDays);
        if (available.has(candidate)) {
          onSelectDate(candidate);
          const weekStart = getWeekStartDateKey(candidate);
          if (weekStart !== weekStartDateKey) {
            onWeekChange(weekStart);
          }
          return;
        }
      }
    },
    [available, onSelectDate, onWeekChange, selectedDate, weekStartDateKey]
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelectedByDays(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelectedByDays(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        onWeekChange(shiftTaipeiDateKey(weekStartDateKey, -7));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        onWeekChange(shiftTaipeiDateKey(weekStartDateKey, 7));
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
    };
  }, [moveSelectedByDays, onWeekChange, weekStartDateKey]);

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) {
      return;
    }
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  return (
    <section
      ref={panelRef}
      tabIndex={0}
      aria-label="儀表板日期選擇"
      className="rounded-2xl border border-zinc-200 bg-white p-3 outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 md:p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="前一日"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden"
          onClick={() => moveSelectedByDays(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="上週"
          className="hidden rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:inline-flex"
          onClick={() => onWeekChange(shiftTaipeiDateKey(weekStartDateKey, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="選擇日期"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            onClick={openDatePicker}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
          <div className="truncate text-sm font-semibold text-zinc-700">
            <span className="md:hidden">{mobileTitle}</span>
            <span className="hidden md:inline">{weekTitle}</span>
            {loading ? <span className="ml-2 text-xs font-normal text-zinc-400">載入中…</span> : null}
          </div>
          <input
            ref={dateInputRef}
            id={datePickerId}
            type="date"
            value={selectedDate}
            className="sr-only"
            onChange={(event) => {
              const next = event.target.value;
              if (!next) {
                return;
              }
              try {
                parseTaipeiDateKey(next);
              } catch {
                return;
              }
              onSelectDate(next);
              onWeekChange(getWeekStartDateKey(next));
            }}
          />
        </div>
        <button
          type="button"
          aria-label="下一日"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden"
          onClick={() => moveSelectedByDays(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="下週"
          className="hidden rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:inline-flex"
          onClick={() => onWeekChange(shiftTaipeiDateKey(weekStartDateKey, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-2 hidden text-[10px] text-zinc-400 md:block">
        方向鍵：← → 切換日期 · ↑ ↓ 切換週 · 點日曆圖示選日期
      </p>

      <div className="md:hidden">
        <DayCellButton
          cell={selectedCell}
          metricsByDate={metricsByDate}
          available={available}
          selected
          isToday={selectedDate === todayKey}
          onSelectDate={onSelectDate}
          className="w-full"
        />
      </div>

      <div className="mb-2 hidden w-full grid-cols-7 gap-2 text-center text-[11px] text-zinc-400 md:grid">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="hidden w-full grid-cols-7 gap-2 md:grid">
        {weekCells.map((cell) => (
          <DayCellButton
            key={cell.dateKey}
            cell={cell}
            metricsByDate={metricsByDate}
            available={available}
            selected={selectedDate === cell.dateKey}
            isToday={cell.dateKey === todayKey}
            onSelectDate={onSelectDate}
          />
        ))}
      </div>
    </section>
  );
}
