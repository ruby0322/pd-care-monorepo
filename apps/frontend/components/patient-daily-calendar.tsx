"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

import {
  buildTaipeiMonthGrid,
  getMonthKeyFromDateKey,
  getRelativeMonthKey,
  getTaipeiTodayKey,
} from "@/lib/utils/upload-calendar";

type CalendarDay = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

type PatientDailyCalendarProps = {
  days: CalendarDay[];
  onDayClick?: (dateKey: string) => void;
  initialMonthKey?: string;
  onMonthChange?: (monthKey: string) => void;
  loadedOldestMonthKey?: string;
  loadedNewestMonthKey?: string;
  oldestEdgeLoading?: boolean;
  overlayLoading?: boolean;
  onReachOldestEdge?: (oldestMonthKey: string) => void | Promise<void>;
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

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

function monthKeyToLabel(monthKey: string): { year: number; month: number } {
  const [yearPart, monthPart] = monthKey.split("-");
  return {
    year: Number(yearPart),
    month: Number(monthPart),
  };
}

function buildMonthRange(startMonthKey: string, endMonthKey: string): string[] {
  const keys: string[] = [];
  let cursor = startMonthKey;
  let guard = 0;
  while (guard < 360) {
    keys.push(cursor);
    if (cursor === endMonthKey) {
      break;
    }
    cursor = getRelativeMonthKey(cursor, 1);
    guard += 1;
  }
  return keys;
}

export function PatientDailyCalendar({
  days,
  onDayClick,
  initialMonthKey,
  onMonthChange,
  loadedOldestMonthKey,
  loadedNewestMonthKey,
  oldestEdgeLoading = false,
  overlayLoading = false,
  onReachOldestEdge,
}: PatientDailyCalendarProps) {
  const dayMap = new Map(days.map((entry) => [entry.date, entry]));
  const todayKey = getTaipeiTodayKey();
  const currentMonthKey = getMonthKeyFromDateKey(todayKey);
  const effectiveNewestMonthKey = loadedNewestMonthKey && loadedNewestMonthKey <= currentMonthKey
    ? loadedNewestMonthKey
    : currentMonthKey;
  const effectiveOldestMonthKey = loadedOldestMonthKey && loadedOldestMonthKey <= effectiveNewestMonthKey
    ? loadedOldestMonthKey
    : effectiveNewestMonthKey;
  const initialVisibleMonth = initialMonthKey && initialMonthKey <= effectiveNewestMonthKey
    ? initialMonthKey
    : effectiveNewestMonthKey;
  const [visibleMonthKeyState, setVisibleMonthKeyState] = useState(initialVisibleMonth);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [isInteracting, setIsInteracting] = useState(false);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreRequestedOldestRef = useRef<string | null>(null);
  const isCalendarOverlayVisible = overlayLoading || oldestEdgeLoading;

  const visibleMonthKey = useMemo(() => {
    const sourceMonthKey = visibleMonthKeyState;
    if (sourceMonthKey < effectiveOldestMonthKey) {
      return effectiveOldestMonthKey;
    }
    if (sourceMonthKey > effectiveNewestMonthKey) {
      return effectiveNewestMonthKey;
    }
    return sourceMonthKey;
  }, [effectiveOldestMonthKey, effectiveNewestMonthKey, visibleMonthKeyState]);

  const monthKeys = useMemo(
    () => buildMonthRange(effectiveOldestMonthKey, getRelativeMonthKey(currentMonthKey, 1)),
    [currentMonthKey, effectiveOldestMonthKey]
  );

  const reboundToNewestAllowedMonth = useCallback(() => {
    const newestIndex = monthKeys.indexOf(effectiveNewestMonthKey);
    if (newestIndex >= 0) {
      carouselApi?.scrollTo(newestIndex);
    }
    setVisibleMonthKeyState(effectiveNewestMonthKey);
  }, [carouselApi, effectiveNewestMonthKey, monthKeys]);

  const requestLoadOlderAtEdge = useCallback((selectedMonthKey: string) => {
    if (!onReachOldestEdge || selectedMonthKey !== effectiveOldestMonthKey) {
      return;
    }
    if (loadMoreInFlightRef.current || loadMoreRequestedOldestRef.current === effectiveOldestMonthKey) {
      return;
    }
    loadMoreInFlightRef.current = true;
    loadMoreRequestedOldestRef.current = effectiveOldestMonthKey;
    void Promise.resolve(onReachOldestEdge(effectiveOldestMonthKey))
      .catch(() => {
        loadMoreRequestedOldestRef.current = null;
      })
      .finally(() => {
        loadMoreInFlightRef.current = false;
      });
  }, [effectiveOldestMonthKey, onReachOldestEdge]);

  useEffect(() => {
    if (loadMoreRequestedOldestRef.current && loadMoreRequestedOldestRef.current > effectiveOldestMonthKey) {
      loadMoreRequestedOldestRef.current = null;
    }
  }, [effectiveOldestMonthKey]);

  useEffect(() => {
    if (!carouselApi) {
      return;
    }
    const targetIndex = monthKeys.indexOf(visibleMonthKey);
    if (targetIndex < 0) {
      return;
    }
    if (carouselApi.selectedScrollSnap() !== targetIndex) {
      carouselApi.scrollTo(targetIndex, true);
    }
  }, [carouselApi, monthKeys, visibleMonthKey]);

  useEffect(() => {
    if (!carouselApi) {
      return;
    }
    const onSelect = () => {
      const selectedIndex = carouselApi.selectedScrollSnap();
      const selectedMonthKey = monthKeys[selectedIndex];
      if (!selectedMonthKey) {
        return;
      }
      if (selectedMonthKey > effectiveNewestMonthKey) {
        reboundToNewestAllowedMonth();
        return;
      }
      if (selectedMonthKey !== visibleMonthKeyState) {
        setVisibleMonthKeyState(selectedMonthKey);
      }
      requestLoadOlderAtEdge(selectedMonthKey);
    };
    carouselApi.on("select", onSelect);
    onSelect();
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi, effectiveNewestMonthKey, monthKeys, reboundToNewestAllowedMonth, requestLoadOlderAtEdge, visibleMonthKeyState]);

  useEffect(() => {
    if (visibleMonthKey <= effectiveNewestMonthKey) {
      onMonthChange?.(visibleMonthKey);
    }
  }, [effectiveNewestMonthKey, onMonthChange, visibleMonthKey]);

  function moveMonth(offset: number): void {
    if (isCalendarOverlayVisible) {
      return;
    }
    const currentIndex = monthKeys.indexOf(visibleMonthKey);
    if (currentIndex < 0 || !carouselApi) {
      return;
    }
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= monthKeys.length) {
      return;
    }
    carouselApi.scrollTo(nextIndex);
  }

  function handleTouchStart(): void {
    if (isCalendarOverlayVisible) {
      return;
    }
    setIsInteracting(true);
  }

  function handleTouchEnd(): void {
    if (isCalendarOverlayVisible) {
      return;
    }
    setIsInteracting(false);
  }

  const activeMonthForLabel = monthKeyToLabel(visibleMonthKey);
  const monthLabel = isInteracting
    ? `${activeMonthForLabel.year} 年 ${activeMonthForLabel.month} 月`
    : `${activeMonthForLabel.month} 月`;

  function renderMonthCells(monthKey: string) {
    const panelGrid = buildTaipeiMonthGrid(monthKey);
    const panelCells = panelGrid.cells.map((cell) => {
      const record = dayMap.get(cell.dateKey);
      const uploadCount = record?.upload_count ?? 0;
      const hasSuspectedRisk = record?.has_suspected_risk ?? false;
      return {
        ...cell,
        uploadCount,
        hasSuspectedRisk,
        isToday: cell.dateKey === todayKey,
      };
    });

    return panelCells.map((cell) => {
      const isMutedAdjacentDay = !cell.isCurrentMonth;
      const backgroundClass = isMutedAdjacentDay ? "bg-zinc-100" : dayStyle(cell.uploadCount, cell.hasSuspectedRisk);
      return (
        <button
          type="button"
          key={cell.dateKey}
          data-testid="calendar-day-cell"
          className={clsx(
            "aspect-square h-auto min-h-10 rounded-md border border-white/80 text-center flex items-center justify-center lg:aspect-auto lg:h-11",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700/80 focus-visible:ring-offset-1",
            backgroundClass,
            cell.isToday && "ring-2 ring-zinc-800/70 ring-offset-1",
            isMutedAdjacentDay ? "text-zinc-400" : "text-zinc-800",
            onDayClick ? "cursor-pointer hover:opacity-90 transition-opacity" : "cursor-default"
          )}
          title={`${cell.dateKey}：${cell.uploadCount} 次上傳`}
          aria-label={`${cell.dateKey} ${cell.uploadCount} uploads`}
          onClick={() => onDayClick?.(cell.dateKey)}
          disabled={!onDayClick || isCalendarOverlayVisible}
        >
          <span className={clsx("text-[11px]", isMutedAdjacentDay ? "font-normal" : "font-semibold")}>{cell.dayOfMonth}</span>
        </button>
      );
    });
  }

  function renderCalendarOverlaySkeleton() {
    const skeletonGrid = buildTaipeiMonthGrid(visibleMonthKey);
    return skeletonGrid.cells.map((cell) => (
      <div
        key={`calendar-skeleton-${cell.dateKey}`}
        data-testid="calendar-skeleton-cell"
        className="aspect-square h-auto min-h-10 rounded-md border border-white/80 bg-zinc-200/60 animate-pulse lg:aspect-auto lg:h-11"
        aria-hidden="true"
      />
    ));
  }

  return (
    <section
      aria-label="每日上傳日曆"
      aria-busy={isCalendarOverlayVisible}
      className="rounded-3xl border border-zinc-100 bg-zinc-50 px-4 py-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">每日上傳日曆</h2>
        <span className="text-xs text-zinc-500">{monthLabel}</span>
      </div>

      <div className="relative mt-3">
        <div className="grid grid-cols-7 gap-2 text-center text-xs text-zinc-500">
          {weekdayLabels.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>

        <Carousel
          setApi={setCarouselApi}
          opts={{ align: "start", watchDrag: !isCalendarOverlayVisible }}
          withGutter={false}
          data-testid="calendar-carousel"
          className="mt-2"
        >
          <CarouselContent data-testid="calendar-carousel-content">
            {monthKeys.map((monthKey) => (
              <CarouselItem
                key={monthKey}
                data-testid="calendar-carousel-item"
              >
                <div className="grid grid-cols-7 gap-2">
                  {renderMonthCells(monthKey)}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        {isCalendarOverlayVisible ? (
          <div
            data-testid="calendar-loading-overlay"
            className="absolute inset-0 z-10 rounded-2xl bg-zinc-50/85 backdrop-blur-[1px] p-1"
            aria-hidden="true"
          >
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {weekdayLabels.map((weekday) => (
                <span key={`skeleton-weekday-${weekday}`} className="text-zinc-300">
                  {weekday}
                </span>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2">
              {renderCalendarOverlaySkeleton()}
            </div>
          </div>
        ) : null}
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

      <div className="mt-3 hidden justify-end gap-2 lg:flex">
        <button
          type="button"
          aria-label="上個月"
          className="hidden lg:inline-flex rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
          onClick={() => moveMonth(-1)}
        >
          上個月
        </button>
        <button
          type="button"
          aria-label="下個月"
          className="hidden lg:inline-flex rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
          onClick={() => moveMonth(1)}
        >
          下個月
        </button>
      </div>
    </section>
  );
}
