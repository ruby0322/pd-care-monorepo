"use client";

import clsx from "clsx";
import { CalendarClock, ChevronLeft, Grid3x3 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getReadableApiError } from "@/lib/api/client";
import type {
  GalleryMonthResponse,
  GalleryUploadItem,
  GalleryUploadsResponse,
  UploadHistoryDay,
} from "@/lib/api/upload-history";
import {
  buildTaipeiMonthGrid,
  getMonthKeyFromDateKey,
  getRelativeMonthKey,
  getTaipeiTodayKey,
} from "@/lib/utils/upload-calendar";

type GalleryMode = "grid" | "calendar";

type MonthBundle = {
  month: string;
  days: UploadHistoryDay[];
};

type PatientGalleryViewProps = {
  fetchUploads: (params?: { beforeId?: number; limit?: number }) => Promise<GalleryUploadsResponse>;
  fetchMonth: (month: string) => Promise<GalleryMonthResponse>;
  onUploadClick: (item: GalleryUploadItem) => void;
  onDayClick: (dateKey: string) => void;
};

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
const PAGE_LIMIT = 30;
const GRID_SKELETON_CELLS = 12;
const GRID_OLDER_SKELETON_CELLS = 3;

function monthKeyToLabel(monthKey: string): string {
  const [yearPart, monthPart] = monthKey.split("-");
  return `${Number(yearPart)} 年 ${Number(monthPart)} 月`;
}

function GalleryGridSkeleton({ count, testId }: { count: number; testId: string }) {
  return (
    <div data-testid={testId} className="grid grid-cols-3 gap-0.5" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={`${testId}-${index}`}
          data-testid="gallery-grid-skeleton-cell"
          className="aspect-square bg-zinc-200 animate-pulse"
        />
      ))}
    </div>
  );
}

function GalleryCalendarSkeleton({ monthKey }: { monthKey: string }) {
  const grid = buildTaipeiMonthGrid(monthKey);
  return (
    <section data-testid="gallery-calendar-skeleton" className="pb-6" aria-hidden="true">
      <div className="mb-2 h-4 w-28 rounded bg-zinc-200 animate-pulse" />
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {weekdayLabels.map((weekday) => (
          <span key={`gallery-skeleton-weekday-${weekday}`} className="text-zinc-300">
            {weekday}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.cells.map((cell) => (
          <div
            key={`gallery-calendar-skeleton-${cell.dateKey}`}
            data-testid="gallery-calendar-skeleton-cell"
            className="aspect-square rounded-md bg-zinc-200/70 animate-pulse"
          />
        ))}
      </div>
    </section>
  );
}

export function PatientGalleryView({
  fetchUploads,
  fetchMonth,
  onUploadClick,
  onDayClick,
}: PatientGalleryViewProps) {
  const router = useRouter();
  const [mode, setMode] = useState<GalleryMode>("grid");
  const [uploads, setUploads] = useState<GalleryUploadItem[]>([]);
  const [hasMoreOlderUploads, setHasMoreOlderUploads] = useState(false);
  const [months, setMonths] = useState<MonthBundle[]>([]);
  const [hasMoreOlderMonths, setHasMoreOlderMonths] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const readyForOlderRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const olderInFlightRef = useRef(false);
  const todayKey = getTaipeiTodayKey();
  const currentMonthKey = getMonthKeyFromDateKey(todayKey);

  useEffect(() => {
    let cancelled = false;
    readyForOlderRef.current = false;
    stickToBottomRef.current = true;

    async function load() {
      try {
        if (mode === "grid") {
          const page = await fetchUploads({ limit: PAGE_LIMIT });
          if (cancelled) {
            return;
          }
          setUploads(page.items);
          setHasMoreOlderUploads(page.has_more_older);
        } else {
          const bundle = await fetchMonth(currentMonthKey);
          if (cancelled) {
            return;
          }
          setMonths([{ month: bundle.month, days: bundle.days }]);
          setHasMoreOlderMonths(bundle.has_more_older);
        }
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(getReadableApiError(loadError));
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentMonthKey, fetchMonth, fetchUploads, mode]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || initialLoading) {
      return;
    }
    const pending = prependScrollRef.current;
    if (pending) {
      scroller.scrollTop = pending.top + (scroller.scrollHeight - pending.height);
      prependScrollRef.current = null;
      return;
    }
    if (stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
      stickToBottomRef.current = false;
      readyForOlderRef.current = true;
    }
  }, [initialLoading, mode, months, uploads]);

  const loadOlderUploads = useCallback(async () => {
    if (!hasMoreOlderUploads || olderInFlightRef.current || uploads.length === 0) {
      return;
    }
    olderInFlightRef.current = true;
    setOlderLoading(true);
    try {
      const page = await fetchUploads({ beforeId: uploads[0].upload_id, limit: PAGE_LIMIT });
      const scroller = scrollerRef.current;
      if (scroller) {
        prependScrollRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
      }
      setUploads((current) => [...page.items, ...current]);
      setHasMoreOlderUploads(page.has_more_older);
    } catch (loadError) {
      prependScrollRef.current = null;
      setError(getReadableApiError(loadError));
    } finally {
      olderInFlightRef.current = false;
      setOlderLoading(false);
    }
  }, [fetchUploads, hasMoreOlderUploads, uploads]);

  const loadOlderMonth = useCallback(async () => {
    if (!hasMoreOlderMonths || olderInFlightRef.current || months.length === 0) {
      return;
    }
    olderInFlightRef.current = true;
    setOlderLoading(true);
    const olderMonthKey = getRelativeMonthKey(months[0].month, -1);
    try {
      const bundle = await fetchMonth(olderMonthKey);
      const scroller = scrollerRef.current;
      if (scroller) {
        prependScrollRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
      }
      setMonths((current) => [{ month: bundle.month, days: bundle.days }, ...current]);
      setHasMoreOlderMonths(bundle.has_more_older);
    } catch (loadError) {
      prependScrollRef.current = null;
      setError(getReadableApiError(loadError));
    } finally {
      olderInFlightRef.current = false;
      setOlderLoading(false);
    }
  }, [fetchMonth, hasMoreOlderMonths, months]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroller = scrollerRef.current;
    if (!sentinel || !scroller) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!readyForOlderRef.current || !entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        if (mode === "grid") {
          void loadOlderUploads();
          return;
        }
        void loadOlderMonth();
      },
      { root: scroller, rootMargin: "80px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderMonth, loadOlderUploads, mode]);

  function renderPhotoMonth(bundle: MonthBundle) {
    const dayMap = new Map(bundle.days.map((day) => [day.date, day]));
    const grid = buildTaipeiMonthGrid(bundle.month);
    return (
      <section key={bundle.month} className="pb-6" aria-label={monthKeyToLabel(bundle.month)}>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">{monthKeyToLabel(bundle.month)}</h2>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-zinc-500">
          {weekdayLabels.map((weekday) => (
            <span key={`${bundle.month}-${weekday}`}>{weekday}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {grid.cells.map((cell) => {
            const record = dayMap.get(cell.dateKey);
            const uploadCount = record?.upload_count ?? 0;
            const coverUrl = record?.representative_image_url ?? null;
            const hasSuspectedRisk = record?.has_suspected_risk ?? false;
            const hasSymptomElevatedRisk = record?.has_symptom_elevated_risk ?? false;
            const isMuted = !cell.isCurrentMonth;
            const showCover = Boolean(coverUrl) && !isMuted;
            const riskBorderClass = showCover
              ? hasSuspectedRisk
                ? "border-2 border-red-500"
                : hasSymptomElevatedRisk
                  ? "border-2 border-orange-500"
                  : "border border-white/80"
              : "border border-transparent";
            const clickable = uploadCount > 0 && !isMuted;
            return (
              <button
                type="button"
                key={cell.dateKey}
                data-testid="gallery-calendar-day"
                disabled={!clickable}
                className={clsx(
                  "relative aspect-square overflow-hidden rounded-md text-center",
                  showCover ? "bg-zinc-200" : "bg-transparent",
                  riskBorderClass,
                  cell.dateKey === todayKey && cell.isCurrentMonth && "ring-2 ring-zinc-800/70 ring-offset-1",
                  isMuted ? "text-zinc-300" : showCover ? "text-white" : "text-zinc-500",
                  clickable ? "cursor-pointer" : "cursor-default"
                )}
                aria-label={`${cell.dateKey} ${uploadCount} uploads`}
                onClick={() => {
                  if (clickable) {
                    onDayClick(cell.dateKey);
                  }
                }}
              >
                {showCover && coverUrl ? (
                  <Image src={coverUrl} alt="" fill unoptimized className="object-cover" />
                ) : null}
                <span
                  className={clsx(
                    "relative z-10 text-[11px]",
                    showCover && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]",
                    cell.isCurrentMonth ? "font-semibold" : "font-normal"
                  )}
                >
                  {cell.dayOfMonth}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const isEmpty =
    !initialLoading &&
    !error &&
    ((mode === "grid" && uploads.length === 0) ||
      (mode === "calendar" && months.every((bundle) => bundle.days.length === 0) && !hasMoreOlderMonths));

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6">
      <header className="shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="上一頁"
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <h1 className="text-lg font-semibold text-zinc-900">相簿</h1>
        </div>
        <div
          role="tablist"
          aria-label="相簿顯示模式"
          className="-mx-4 mt-4 flex w-[calc(100%+2rem)] border-b border-zinc-200 sm:-mx-6 sm:w-[calc(100%+3rem)]"
        >
          <button
            type="button"
            role="tab"
            aria-label="九宮格"
            aria-selected={mode === "grid"}
            className={clsx(
              "flex flex-1 items-center justify-center py-2.5 -mb-px border-b-2 transition-colors",
              mode === "grid"
                ? "border-zinc-700 bg-zinc-200 text-zinc-800"
                : "border-transparent bg-transparent text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
            )}
            onClick={() => {
              if (mode === "grid") {
                return;
              }
              setInitialLoading(true);
              setMode("grid");
            }}
          >
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            aria-label="日曆"
            aria-selected={mode === "calendar"}
            className={clsx(
              "flex flex-1 items-center justify-center py-2.5 -mb-px border-b-2 transition-colors",
              mode === "calendar"
                ? "border-zinc-700 bg-zinc-200 text-zinc-800"
                : "border-transparent bg-transparent text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
            )}
            onClick={() => {
              if (mode === "calendar") {
                return;
              }
              setInitialLoading(true);
              setMode("calendar");
            }}
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="mt-4 min-h-0 flex-1 overflow-y-auto"
        aria-busy={initialLoading || olderLoading}
      >
        <div ref={sentinelRef} data-testid="gallery-older-sentinel" className="h-1" />
        {olderLoading ? (
          mode === "grid" ? (
            <GalleryGridSkeleton count={GRID_OLDER_SKELETON_CELLS} testId="gallery-older-grid-skeleton" />
          ) : (
            <GalleryCalendarSkeleton monthKey={months[0] ? getRelativeMonthKey(months[0].month, -1) : currentMonthKey} />
          )
        ) : null}
        {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {initialLoading ? (
          mode === "grid" ? (
            <GalleryGridSkeleton count={GRID_SKELETON_CELLS} testId="gallery-grid-skeleton" />
          ) : (
            <GalleryCalendarSkeleton monthKey={currentMonthKey} />
          )
        ) : null}
        {isEmpty ? <p className="py-8 text-sm text-zinc-500">尚無相片</p> : null}

        {!initialLoading && mode === "grid" && uploads.length > 0 ? (
          <div data-testid="gallery-grid" className="grid grid-cols-3 gap-0.5">
            {uploads.map((item) => (
              <button
                type="button"
                key={item.upload_id}
                data-testid="gallery-grid-cell"
                className="relative aspect-square overflow-hidden bg-zinc-200"
                aria-label={`上傳 ${item.date}`}
                onClick={() => onUploadClick(item)}
              >
                <Image src={item.image_url} alt="" fill unoptimized className="object-cover" />
              </button>
            ))}
          </div>
        ) : null}

        {!initialLoading && mode === "calendar"
          ? months.map((bundle) => renderPhotoMonth(bundle))
          : null}
      </div>
    </div>
  );
}
