"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import {
  fetchHistoryOverview,
  fetchHistoryOverviewDays,
  StaffHistoryOverviewResponse,
  StaffHistoryOverviewUploadItem,
  upsertUploadAnnotation,
} from "@/lib/api/staff";
import { parseTaipeiDateKey } from "@/lib/utils/upload-calendar";

import { HistoryUploadAnnotationModal } from "@/app/admin/_components/history-upload-annotation-modal";
import {
  suggestedHistoryUploadLabel,
  type HistoryUploadDraftVerdict,
} from "@/app/admin/_components/history-upload-review-helpers";
import { HistoryUploadThumbnailGrid } from "@/app/admin/_components/history-upload-thumbnail-grid";
import { useUploadImageUrls } from "@/app/admin/_components/use-upload-image-urls";
import { ClinicalPeriodPanel } from "./clinical-period-panel";
import { UsageTrendsTab } from "./usage-trends-tab";

type SortBy = "timeline" | "risk";
type GroupSortBy = "uploads" | "age" | "infection_risk";
type OverviewTab = "clinical-day" | "clinical-period" | "usage";

function parseOverviewTab(raw: string | null): OverviewTab {
  if (raw === "usage") {
    return "usage";
  }
  if (raw === "clinical-period") {
    return "clinical-period";
  }
  if (raw === "clinical" || raw === "clinical-day" || raw == null) {
    return "clinical-day";
  }
  return "clinical-day";
}

const INITIAL_UNGROUPED_VISIBLE = 16;
const UNGROUPED_STEP = 16;
const INITIAL_GROUP_VISIBLE = 7;
const GROUP_STEP = 8;

export default function AdminHistoryOverviewPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-zinc-500">載入歷史總覽中...</div>}>
      <AdminHistoryOverviewPageInner />
    </Suspense>
  );
}

function AdminHistoryOverviewPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialTab = parseOverviewTab(searchParams.get("tab"));
  const initialDateParam = searchParams.get("date");
  let initialDateFromUrl: string | null = null;
  if (initialDateParam) {
    try {
      parseTaipeiDateKey(initialDateParam);
      initialDateFromUrl = initialDateParam;
    } catch {
      initialDateFromUrl = null;
    }
  }

  const [overviewTab, setOverviewTab] = useState<OverviewTab>(initialTab);
  const [daysLoading, setDaysLoading] = useState(true);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDateFromUrl);

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewData, setOverviewData] = useState<StaffHistoryOverviewResponse | null>(null);

  const [sortBy, setSortBy] = useState<SortBy>("timeline");
  const [groupByUser, setGroupByUser] = useState(true);
  const [groupSortBy, setGroupSortBy] = useState<GroupSortBy>("infection_risk");

  const [ungroupedVisibleCount, setUngroupedVisibleCount] = useState(INITIAL_UNGROUPED_VISIBLE);
  const [groupVisibleCountByPatient, setGroupVisibleCountByPatient] = useState<Record<number, number>>({});
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HistoryUploadDraftVerdict>({ label: "suspected", comment: "" });
  const [saving, setSaving] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const syncUrl = useCallback(
    (next: { date?: string | null; tab?: OverviewTab }) => {
      const params = new URLSearchParams(searchParams.toString());
      const dateValue = next.date !== undefined ? next.date : selectedDate;
      const tabValue = next.tab ?? overviewTab;
      if (dateValue) {
        params.set("date", dateValue);
      } else {
        params.delete("date");
      }
      if (tabValue === "clinical-day") {
        params.delete("tab");
      } else {
        params.set("tab", tabValue);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [overviewTab, pathname, router, searchParams, selectedDate]
  );

  const loadDays = useCallback(async () => {
    setDaysLoading(true);
    try {
      const response = await fetchHistoryOverviewDays();
      const nextDays = response.items.map((item) => item.local_date);
      setDays(nextDays);
      setDaysError(null);
      setSelectedDate((current) => {
        if (current && nextDays.includes(current)) {
          return current;
        }
        return nextDays.length > 0 ? nextDays[0] : null;
      });
    } catch (error) {
      setDaysError(getReadableApiError(error));
    } finally {
      setDaysLoading(false);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    if (!selectedDate) {
      setOverviewData(null);
      return;
    }
    setOverviewLoading(true);
    try {
      const response = await fetchHistoryOverview({
        localDate: selectedDate,
        sortBy,
        groupByUser,
        groupSortBy,
      });
      setOverviewData(response);
      setOverviewError(null);
    } catch (error) {
      setOverviewError(getReadableApiError(error));
    } finally {
      setOverviewLoading(false);
    }
  }, [groupByUser, groupSortBy, selectedDate, sortBy]);

  useEffect(() => {
    if (overviewTab !== "clinical-day") {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadDays();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadDays, overviewTab]);

  useEffect(() => {
    if (overviewTab !== "clinical-day") {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadOverview, overviewTab]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    syncUrl({ date: selectedDate, tab: overviewTab });
    // Intentionally only when date/tab change; syncUrl identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, overviewTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUngroupedVisibleCount(INITIAL_UNGROUPED_VISIBLE);
      setGroupVisibleCountByPatient({});
      setSelectedUploadId(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [groupByUser, groupSortBy, selectedDate, sortBy]);

  const allUploads = useMemo(() => {
    if (!overviewData) {
      return [] as StaffHistoryOverviewUploadItem[];
    }
    if (!groupByUser) {
      return overviewData.items;
    }
    return overviewData.groups.flatMap((group) => group.uploads);
  }, [groupByUser, overviewData]);

  const selectedUpload = useMemo(
    () => (selectedUploadId ? allUploads.find((item) => item.upload_id === selectedUploadId) ?? null : null),
    [allUploads, selectedUploadId]
  );

  useEffect(() => {
    if (!selectedUpload) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDraft({
        label: suggestedHistoryUploadLabel(selectedUpload),
        comment: selectedUpload.annotation_comment ?? "",
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedUpload]);

  const ungroupedVisibleItems = useMemo(() => {
    if (!overviewData) {
      return [] as StaffHistoryOverviewUploadItem[];
    }
    return overviewData.items.slice(0, ungroupedVisibleCount);
  }, [overviewData, ungroupedVisibleCount]);

  const visibleUploadsForImageLoading = useMemo(() => {
    if (!overviewData) {
      return [] as StaffHistoryOverviewUploadItem[];
    }
    if (!groupByUser) {
      return ungroupedVisibleItems;
    }
    return overviewData.groups.flatMap((group) => {
      const visibleCount = groupVisibleCountByPatient[group.patient_id] ?? INITIAL_GROUP_VISIBLE;
      return group.uploads.slice(0, visibleCount);
    });
  }, [groupByUser, groupVisibleCountByPatient, overviewData, ungroupedVisibleItems]);

  const uploadIdsForImages = useMemo(() => {
    const ids = visibleUploadsForImageLoading.map((item) => item.upload_id);
    if (selectedUpload && !ids.includes(selectedUpload.upload_id)) {
      ids.push(selectedUpload.upload_id);
    }
    return ids;
  }, [selectedUpload, visibleUploadsForImageLoading]);

  const { imageUrlByUploadId, imageErrorByUploadId } = useUploadImageUrls(uploadIdsForImages);

  useEffect(() => {
    if (groupByUser || !overviewData) {
      return;
    }
    if (ungroupedVisibleCount >= overviewData.items.length) {
      return;
    }
    const target = sentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setUngroupedVisibleCount((current) => Math.min(current + UNGROUPED_STEP, overviewData.items.length));
        }
      },
      { rootMargin: "180px" }
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [groupByUser, overviewData, ungroupedVisibleCount]);

  async function onSaveSelected() {
    if (!selectedUpload) {
      return;
    }
    setSaving(true);
    try {
      await upsertUploadAnnotation(selectedUpload.upload_id, {
        label: draft.label,
        comment: draft.comment,
      });
      toast.success("已儲存標註");
      setSelectedUploadId(null);
      await loadOverview();
    } catch {
      toast.error("儲存失敗，請稍後重試");
    } finally {
      setSaving(false);
    }
  }

  const selectedDateIndex = selectedDate ? days.indexOf(selectedDate) : -1;
  const canGoPrev = selectedDateIndex >= 0 && selectedDateIndex < days.length - 1;
  const canGoNext = selectedDateIndex > 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">歷史總覽</h1>
          <p className="text-xs text-zinc-500">臨床回顧與使用趨勢（依台灣時區）。</p>
        </div>
        {overviewTab === "clinical-day" ? (
          <button
            type="button"
            onClick={() => {
              void loadDays();
              void loadOverview();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2">
        <button
          type="button"
          onClick={() => setOverviewTab("clinical-day")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            overviewTab === "clinical-day" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          臨床單日
        </button>
        <button
          type="button"
          onClick={() => setOverviewTab("clinical-period")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            overviewTab === "clinical-period" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          臨床區間
        </button>
        <button
          type="button"
          onClick={() => setOverviewTab("usage")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            overviewTab === "usage" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          使用趨勢
        </button>
      </div>

      {overviewTab === "usage" ? <UsageTrendsTab /> : null}

      {overviewTab === "clinical-period" ? <ClinicalPeriodPanel /> : null}

      {overviewTab === "clinical-day" && daysLoading && !selectedDate ? (
        <div className="py-16 text-center text-sm text-zinc-500">載入歷史總覽中...</div>
      ) : null}

      {overviewTab === "clinical-day" && !(daysLoading && !selectedDate) ? (
        <>
      {daysError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{daysError}</div> : null}
      {overviewError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{overviewError}</div>
      ) : null}

      <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-col gap-2">
          <div className="inline-flex items-center gap-2">
            <span className="text-xs text-zinc-500">檢視日期</span>
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={() => canGoPrev && setSelectedDate(days[selectedDateIndex + 1])}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
              {selectedDate ?? "—"}
            </div>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => canGoNext && setSelectedDate(days[selectedDateIndex - 1])}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {selectedDate ? (
            <Link
              href={`/admin?date=${encodeURIComponent(selectedDate)}`}
              className="text-xs text-zinc-500 hover:text-zinc-800"
            >
              在儀表板變更日期 →
            </Link>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2">
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value="timeline">排序：上傳時間</option>
            <option value="risk">排序：感染風險</option>
          </select>
          <button
            type="button"
            onClick={() => setGroupByUser((current) => !current)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${groupByUser ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-700"}`}
          >
            {groupByUser ? "已群組" : "依使用者群組"}
          </button>
          {groupByUser ? (
            <select
              value={groupSortBy}
              onChange={(event) => setGroupSortBy(event.target.value as GroupSortBy)}
              className="col-span-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm md:col-span-1"
            >
              <option value="uploads">群組排序：當日上傳數</option>
              <option value="age">群組排序：年齡</option>
              <option value="infection_risk">群組排序：感染風險</option>
            </select>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs text-zinc-500">uploaded users</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{overviewData?.kpi.uploaded_users ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs text-zinc-500">uploads</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{overviewData?.kpi.uploads ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs text-zinc-500">疑似感染人數</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{overviewData?.kpi.suspected_infected_users ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs text-zinc-500">症狀高風險人數</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{overviewData?.kpi.symptom_elevated_users ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs text-zinc-500">infection rate</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">{((overviewData?.kpi.infection_rate ?? 0) * 100).toFixed(1)}%</p>
        </div>
      </section>

      {overviewLoading ? <div className="py-8 text-center text-sm text-zinc-500">載入當日資料中...</div> : null}

      {!groupByUser ? (
        <section>
          <HistoryUploadThumbnailGrid
            uploads={ungroupedVisibleItems}
            imageUrlByUploadId={imageUrlByUploadId}
            imageErrorByUploadId={imageErrorByUploadId}
            onSelectUpload={setSelectedUploadId}
          />
          <div ref={sentinelRef} className="h-1 w-full" />
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          {overviewData?.groups.map((group) => {
            const visibleCount = groupVisibleCountByPatient[group.patient_id] ?? INITIAL_GROUP_VISIBLE;
            const visibleUploads = group.uploads.slice(0, visibleCount);
            const hasMore = visibleCount < group.uploads.length;
            return (
              <article key={group.patient_id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <header className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/patients/${group.patient_id}`}
                      className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200 transition hover:ring-zinc-400"
                      aria-label={`查看 ${group.real_name ?? group.patient_full_name ?? "病患"} 詳情`}
                    >
                      {group.picture_url ? (
                        <Image src={group.picture_url} alt={`avatar-${group.patient_id}`} fill unoptimized className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-400">N/A</div>
                      )}
                    </Link>
                    <div className="text-sm">
                      <Link
                        href={`/admin/patients/${group.patient_id}`}
                        className="font-medium text-zinc-900 hover:text-zinc-700 hover:underline"
                      >
                        {group.real_name ?? group.patient_full_name ?? "未命名"}
                      </Link>
                      <p className="text-xs text-zinc-500">
                        {group.case_number} · {group.line_display_name ?? "No LINE name"} · {group.gender}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">當日上傳 {group.upload_count} 張</p>
                </header>
                <div>
                  <HistoryUploadThumbnailGrid
                    uploads={visibleUploads}
                    imageUrlByUploadId={imageUrlByUploadId}
                    imageErrorByUploadId={imageErrorByUploadId}
                    onSelectUpload={setSelectedUploadId}
                    hasMore={hasMore}
                    onLoadMore={() =>
                      setGroupVisibleCountByPatient((current) => ({
                        ...current,
                        [group.patient_id]: (current[group.patient_id] ?? INITIAL_GROUP_VISIBLE) + GROUP_STEP,
                      }))
                    }
                  />
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedUpload ? (
        <HistoryUploadAnnotationModal
          upload={selectedUpload}
          imageUrl={imageUrlByUploadId[selectedUpload.upload_id] ?? null}
          draft={draft}
          saving={saving}
          onDraftChange={setDraft}
          onSave={() => void onSaveSelected()}
          onClose={() => setSelectedUploadId(null)}
        />
      ) : null}
        </>
      ) : null}
    </div>
  );
}
