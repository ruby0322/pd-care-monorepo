"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import {
  fetchHistoryOverview,
  fetchHistoryOverviewDays,
  fetchUploadImageAccess,
  StaffAnnotationItem,
  StaffHistoryOverviewResponse,
  StaffHistoryOverviewUploadItem,
  upsertUploadAnnotation,
} from "@/lib/api/staff";
import { parseTaipeiDateKey } from "@/lib/utils/upload-calendar";

import { ClinicalPeriodPanel } from "./clinical-period-panel";
import { UsageTrendsTab } from "./usage-trends-tab";

type SortBy = "timeline" | "risk";
type GroupSortBy = "uploads" | "age" | "infection_risk";
type OverviewTab = "clinical" | "usage";
type DraftVerdict = {
  label: StaffAnnotationItem["label"];
  comment: string;
};

const INITIAL_UNGROUPED_VISIBLE = 16;
const UNGROUPED_STEP = 16;
const INITIAL_GROUP_VISIBLE = 7;
const GROUP_STEP = 8;

function formatLocalTime(raw: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(raw));
}

function riskBadgeClass(upload: StaffHistoryOverviewUploadItem): string {
  if (upload.risk_rank === 0) {
    return "bg-rose-100 text-rose-700";
  }
  if (upload.risk_rank === 1) {
    return "bg-red-100 text-red-700";
  }
  if (upload.risk_rank === 2) {
    return "bg-orange-100 text-orange-700";
  }
  if (upload.risk_rank === 3) {
    return "bg-emerald-100 text-emerald-700";
  }
  return "bg-zinc-200 text-zinc-700";
}

function riskLabel(upload: StaffHistoryOverviewUploadItem): string {
  if (upload.annotation_label === "confirmed_infection") {
    return "confirmed_infection";
  }
  if (upload.annotation_label === "suspected") {
    return "suspected";
  }
  if (upload.annotation_label === "normal") {
    return "normal";
  }
  if (upload.annotation_label === "rejected") {
    return "rejected";
  }
  if (upload.risk_rank === 2) {
    return "症狀高風險";
  }
  return upload.screening_result;
}

function suggestedLabel(upload: StaffHistoryOverviewUploadItem): StaffAnnotationItem["label"] {
  if (upload.annotation_label) {
    return upload.annotation_label;
  }
  if (upload.screening_result === "rejected" || upload.screening_result === "technical_error") {
    return "rejected";
  }
  if (upload.symptom_aware_priority === "suspected" || upload.screening_result === "suspected") {
    return "suspected";
  }
  if (upload.screening_result === "normal") {
    return "normal";
  }
  return "rejected";
}

export default function AdminHistoryOverviewPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-zinc-500">載入區間分析中...</div>}>
      <AdminHistoryOverviewPageInner />
    </Suspense>
  );
}

function AdminHistoryOverviewPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialTab = searchParams.get("tab") === "usage" ? "usage" : "clinical";
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
  const [draft, setDraft] = useState<DraftVerdict>({ label: "suspected", comment: "" });
  const [saving, setSaving] = useState(false);

  const [imageUrlByUploadId, setImageUrlByUploadId] = useState<Record<number, string>>({});
  const [imageErrorByUploadId, setImageErrorByUploadId] = useState<Record<number, boolean>>({});
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
      if (tabValue === "clinical") {
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
    const timer = window.setTimeout(() => {
      void loadDays();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadDays]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadOverview]);

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
        label: suggestedLabel(selectedUpload),
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

  useEffect(() => {
    if (visibleUploadsForImageLoading.length === 0) {
      return;
    }
    const missing = visibleUploadsForImageLoading.filter((item) => !imageUrlByUploadId[item.upload_id]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.allSettled(missing.map((item) => fetchUploadImageAccess(item.upload_id))).then((results) => {
      if (cancelled) {
        return;
      }
      setImageUrlByUploadId((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            next[missing[index].upload_id] = result.value.image_url;
          }
        });
        return next;
      });
      setImageErrorByUploadId((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          next[missing[index].upload_id] = result.status === "rejected";
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrlByUploadId, visibleUploadsForImageLoading]);

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
          <h1 className="text-lg font-semibold text-zinc-900">區間分析</h1>
          <p className="text-xs text-zinc-500">臨床回顧與使用趨勢（依台灣時區）。</p>
        </div>
        {overviewTab === "clinical" ? (
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

      <div className="flex gap-2 border-b border-zinc-200 pb-2">
        <button
          type="button"
          onClick={() => setOverviewTab("clinical")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            overviewTab === "clinical" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          臨床
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

      {overviewTab === "clinical" && daysLoading && !selectedDate ? (
        <div className="py-16 text-center text-sm text-zinc-500">載入區間分析中...</div>
      ) : null}

      {overviewTab === "clinical" && !(daysLoading && !selectedDate) ? (
        <>
      <ClinicalPeriodPanel />

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
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {ungroupedVisibleItems.map((item) => {
            const imageUrl = imageUrlByUploadId[item.upload_id];
            const imageError = imageErrorByUploadId[item.upload_id] ?? false;
            return (
              <button
                key={item.upload_id}
                type="button"
                onClick={() => setSelectedUploadId(item.upload_id)}
                className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-400"
              >
                {imageUrl ? (
                  <Image src={imageUrl} alt={`history-upload-${item.upload_id}`} fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-400">{imageError ? "載入失敗" : "載入中"}</div>
                )}
                <span className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${riskBadgeClass(item)}`}>
                  {riskLabel(item)}
                </span>
                <span className="absolute bottom-1 right-1 rounded bg-zinc-900/75 px-1.5 py-0.5 text-[10px] text-white">
                  {formatLocalTime(item.created_at)}
                </span>
              </button>
            );
          })}
          <div ref={sentinelRef} className="h-1 w-full col-span-full" />
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
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {visibleUploads.map((item) => {
                    const imageUrl = imageUrlByUploadId[item.upload_id];
                    const imageError = imageErrorByUploadId[item.upload_id] ?? false;
                    return (
                      <button
                        key={item.upload_id}
                        type="button"
                        onClick={() => setSelectedUploadId(item.upload_id)}
                        className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-400"
                      >
                        {imageUrl ? (
                          <Image src={imageUrl} alt={`history-upload-${item.upload_id}`} fill unoptimized className="object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                            {imageError ? "載入失敗" : "載入中"}
                          </div>
                        )}
                        <span className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${riskBadgeClass(item)}`}>
                          {riskLabel(item)}
                        </span>
                        <span className="absolute bottom-1 right-1 rounded bg-zinc-900/75 px-1.5 py-0.5 text-[10px] text-white">
                          {formatLocalTime(item.created_at)}
                        </span>
                      </button>
                    );
                  })}
                  {hasMore ? (
                    <button
                      type="button"
                      onClick={() =>
                        setGroupVisibleCountByPatient((current) => ({
                          ...current,
                          [group.patient_id]: (current[group.patient_id] ?? INITIAL_GROUP_VISIBLE) + GROUP_STEP,
                        }))
                      }
                      className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                    >
                      Load more
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selectedUpload ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/60 p-0 sm:items-center sm:p-4">
          <div className="h-[90vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:h-auto sm:max-w-3xl sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">{selectedUpload.patient_full_name ?? "未命名病患"}</p>
                <p className="font-mono text-xs text-zinc-500">{selectedUpload.case_number}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUploadId(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="relative h-80 overflow-hidden rounded-xl bg-zinc-100">
                {imageUrlByUploadId[selectedUpload.upload_id] ? (
                  <Image
                    src={imageUrlByUploadId[selectedUpload.upload_id]}
                    alt={`history-preview-${selectedUpload.upload_id}`}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-400">載入影像中...</div>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <dl className="space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">年齡</dt>
                    <dd className="text-right text-zinc-900">{selectedUpload.age ?? "-"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">上傳時間</dt>
                    <dd className="text-right text-zinc-900">{new Date(selectedUpload.created_at).toLocaleString("zh-TW")}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">臨床風險</dt>
                    <dd className="text-right text-zinc-900">{riskLabel(selectedUpload)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">影像判讀</dt>
                    <dd className="text-right text-zinc-900">{selectedUpload.screening_result}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">症狀綜合</dt>
                    <dd className="text-right text-zinc-900">{selectedUpload.symptom_aware_priority}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">機率</dt>
                    <dd className="text-right text-zinc-900">
                      {selectedUpload.probability !== null ? `${(selectedUpload.probability * 100).toFixed(1)}%` : "-"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">Threshold</dt>
                    <dd className="text-right text-zinc-900">
                      {selectedUpload.threshold !== null ? selectedUpload.threshold.toFixed(2) : "-"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-zinc-400">Model</dt>
                    <dd className="text-right text-zinc-900">{selectedUpload.model_version ?? "-"}</dd>
                  </div>
                </dl>
                <div>
                  <Link
                    href={`/admin/patients/${selectedUpload.patient_id}`}
                    className="text-xs text-zinc-500 hover:text-zinc-800"
                  >
                    開啟病患完整頁
                  </Link>
                </div>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  標註標籤
                  <select
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, label: event.target.value as StaffAnnotationItem["label"] }))
                    }
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                  >
                    <option value="normal">normal</option>
                    <option value="suspected">suspected</option>
                    <option value="confirmed_infection">confirmed_infection</option>
                    <option value="rejected">rejected</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  備註
                  <textarea
                    value={draft.comment}
                    onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))}
                    rows={6}
                    className="resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                    placeholder="comment..."
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onSaveSelected()}
                  disabled={saving}
                  className="mt-auto rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}
