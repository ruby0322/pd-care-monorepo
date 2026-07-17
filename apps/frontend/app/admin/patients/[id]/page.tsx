"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ChevronLeft,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Upload,
  User,
  Calendar,
  Save,
  Image as ImageIcon,
} from "lucide-react";
import clsx from "clsx";

import { PatientDailyCalendar } from "@/components/patient-daily-calendar";
import { getReadableApiError } from "@/lib/api/client";
import {
  fetchPatientAnnotations,
  fetchStaffPatientDetail,
  fetchStaffPatientUploadCalendar,
  fetchStaffPatientUploads,
  fetchUploadImageAccess,
  StaffAnnotationItem,
  StaffPatientDetailUpload,
  upsertUploadAnnotation,
} from "@/lib/api/staff";
import { getMonthKeyFromDateKey, getTaipeiTodayKey } from "@/lib/utils/upload-calendar";

function ResultBadge({ result }: { result: StaffPatientDetailUpload["screening_result"] }) {
  const config = {
    normal: { icon: CheckCircle, label: "正常", className: "bg-emerald-50 text-emerald-600 border-emerald-100" } as const,
    suspected: { icon: AlertTriangle, label: "疑似感染", className: "bg-red-50 text-red-600 border-red-100" } as const,
    rejected: { icon: XCircle, label: "拒絕上傳", className: "bg-amber-50 text-amber-600 border-amber-100" } as const,
    technical_error: { icon: XCircle, label: "系統錯誤", className: "bg-zinc-100 text-zinc-600 border-zinc-200" } as const,
  };
  const { icon: Icon, label, className } = config[result];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium", className)}>
      <Icon className="w-3 h-3" strokeWidth={2} />
      {label}
    </span>
  );
}

function AnnotationChip({ annotation }: { annotation: StaffAnnotationItem | undefined }) {
  if (!annotation) {
    return <span className="text-xs text-zinc-400">尚未標註</span>;
  }
  const textClass =
    annotation.label === "confirmed_infection"
      ? "bg-red-100 text-red-700"
      : annotation.label === "suspected"
        ? "bg-amber-100 text-amber-700"
        : annotation.label === "rejected"
          ? "bg-zinc-200 text-zinc-700"
          : "bg-emerald-100 text-emerald-700";
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-1 text-xs", textClass)}>{annotation.label}</span>
  );
}

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const patientId = Number(params.id);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchStaffPatientDetail>> | null>(null);
  const [uploads, setUploads] = useState<StaffPatientDetailUpload[]>([]);
  const [calendarDays, setCalendarDays] = useState<Awaited<ReturnType<typeof fetchStaffPatientUploadCalendar>>["items"]>([]);
  const [annotations, setAnnotations] = useState<StaffAnnotationItem[]>([]);
  const [imageUrlByUpload, setImageUrlByUpload] = useState<Record<number, string>>({});
  const [editingLabel, setEditingLabel] = useState<Record<number, StaffAnnotationItem["label"]>>({});
  const [editingComment, setEditingComment] = useState<Record<number, string>>({});
  const [savingUploadId, setSavingUploadId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; uploadId: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [uploadPage, setUploadPage] = useState(1);
  const [uploadPageSize, setUploadPageSize] = useState<20 | 50 | 100>(20);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const [detailResponse, annotationItems, calendarResponse] = await Promise.all([
          fetchStaffPatientDetail(patientId),
          fetchPatientAnnotations(patientId),
          fetchStaffPatientUploadCalendar(patientId),
        ]);
        if (cancelled) {
          return;
        }
        setDetail(detailResponse);
        setAnnotations(annotationItems);
        setCalendarDays(calendarResponse.items);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(getReadableApiError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    if (!Number.isNaN(patientId)) {
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  useEffect(() => {
    if (Number.isNaN(patientId)) {
      return;
    }
    let cancelled = false;
    async function loadUploads() {
      setUploadsLoading(true);
      setUploadErrorMessage(null);
      setUploads([]);
      setUploadTotal(0);
      setImageUrlByUpload({});
      try {
        const response = await fetchStaffPatientUploads(patientId, {
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          limit: uploadPageSize,
          offset: (uploadPage - 1) * uploadPageSize,
        });
        if (cancelled) {
          return;
        }
        const lastPage = Math.max(1, Math.ceil(response.total / uploadPageSize));
        if (uploadPage > lastPage) {
          setUploadPage(lastPage);
          return;
        }
        setUploads(response.items);
        setUploadTotal(response.total);
        const accessRows = await Promise.all(
          response.items.map(async (upload) => ({
            uploadId: upload.upload_id,
            access: await fetchUploadImageAccess(upload.upload_id),
          }))
        );
        if (!cancelled) {
          setImageUrlByUpload(Object.fromEntries(
            accessRows.map((row) => [row.uploadId, row.access.image_url])
          ));
        }
      } catch (error) {
        if (!cancelled) {
          setUploadErrorMessage(getReadableApiError(error));
        }
      } finally {
        if (!cancelled) {
          setUploadsLoading(false);
        }
      }
    }
    void loadUploads();
    return () => {
      cancelled = true;
    };
  }, [createdFrom, createdTo, patientId, uploadPage, uploadPageSize]);

  const annotationByUpload = useMemo(() => {
    const map = new Map<number, StaffAnnotationItem>();
    for (const item of annotations) {
      if (!map.has(item.upload_id)) {
        map.set(item.upload_id, item);
      }
    }
    return map;
  }, [annotations]);

  const calendarMonthBounds = useMemo(() => {
    const currentMonthKey = getMonthKeyFromDateKey(getTaipeiTodayKey());
    if (calendarDays.length === 0) {
      return { oldestMonthKey: currentMonthKey, newestMonthKey: currentMonthKey };
    }
    return {
      oldestMonthKey: getMonthKeyFromDateKey(calendarDays[0].date),
      newestMonthKey: getMonthKeyFromDateKey(calendarDays[calendarDays.length - 1].date),
    };
  }, [calendarDays]);
  const uploadTotalPages = Math.max(1, Math.ceil(uploadTotal / uploadPageSize));
  const uploadRangeStart = uploadTotal === 0 ? 0 : (uploadPage - 1) * uploadPageSize + 1;
  const uploadRangeEnd = uploadTotal === 0 ? 0 : Math.min(uploadPage * uploadPageSize, uploadTotal);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  async function handleSaveAnnotation(uploadId: number) {
    const label = editingLabel[uploadId] ?? "normal";
    const comment = editingComment[uploadId] ?? "";
    setSavingUploadId(uploadId);
    try {
      const saved = await upsertUploadAnnotation(uploadId, { label, comment });
      setAnnotations((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setSavingUploadId(null);
    }
  }

  if (loading && !detail) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-zinc-500">載入中...</div>;
  }

  if (!detail) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-red-600">{errorMessage ?? "找不到病患資料"}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/patients"
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-zinc-500" strokeWidth={1.5} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-zinc-900">{detail.full_name ?? "未命名病患"}</h1>
          <p className="text-xs text-zinc-400 font-mono break-all mt-0.5" title={detail.case_number}>
            {detail.case_number}
          </p>
        </div>
      </div>
      {errorMessage ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div> : null}

      <div className="bg-white border border-zinc-100 rounded-2xl p-5">
        <h2 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <User className="w-3.5 h-3.5" strokeWidth={2} />
          基本資料
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {[
            { label: "姓名", value: detail.full_name ?? "未命名" },
            { label: "LINE 名稱", value: detail.line_display_name ?? "尚未綁定" },
            { label: "病例號", value: detail.case_number, mono: true },
            { label: "年齡", value: detail.age ? `${detail.age} 歲` : "未知" },
            { label: "出生日期", value: detail.birth_date },
            { label: "LINE 帳號", value: detail.line_user_id ?? "尚未綁定", mono: true },
            { label: "總上傳次數", value: `${detail.total_uploads}` },
          ].map(({ label, value, mono }) => (
            <div key={label} className="min-w-0">
              <div className="text-xs text-zinc-400 mb-0.5">{label}</div>
              <div
                className={clsx("text-sm text-zinc-900", mono && "font-mono break-all")}
                title={typeof value === "string" ? value : undefined}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Upload, label: "總上傳次數", value: detail.total_uploads, color: "zinc" as const },
          { icon: AlertTriangle, label: "疑似感染次數", value: detail.suspected_uploads, color: "red" as const },
          {
            icon: AlertTriangle,
            label: "症狀高風險次數",
            value: detail.symptom_elevated_uploads ?? 0,
            color: "orange" as const,
          },
          { icon: XCircle, label: "拒絕上傳次數", value: detail.rejected_uploads, color: "amber" as const },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white border border-zinc-100 rounded-2xl p-4 flex flex-col gap-2">
            <Icon
              className={clsx(
                "w-4 h-4",
                color === "red"
                  ? "text-red-400"
                  : color === "orange"
                    ? "text-orange-400"
                    : color === "amber"
                      ? "text-amber-400"
                      : "text-zinc-400"
              )}
              strokeWidth={1.5}
            />
            <div
              className={clsx(
                "text-xl font-semibold",
                color === "red"
                  ? "text-red-600"
                  : color === "orange"
                    ? "text-orange-600"
                    : color === "amber"
                      ? "text-amber-600"
                      : "text-zinc-900"
              )}
            >
              {value}
            </div>
            <div className="text-xs text-zinc-400">{label}</div>
          </div>
        ))}
      </div>

      <PatientDailyCalendar
        days={calendarDays}
        loadedOldestMonthKey={calendarMonthBounds.oldestMonthKey}
        loadedNewestMonthKey={calendarMonthBounds.newestMonthKey}
      />

      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-zinc-900">上傳歷程</h2>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              上傳日期起
              <input
                type="date"
                aria-label="上傳日期起"
                value={createdFrom}
                onChange={(event) => {
                  setCreatedFrom(event.target.value);
                  setUploadPage(1);
                }}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              上傳日期迄
              <input
                type="date"
                aria-label="上傳日期迄"
                value={createdTo}
                onChange={(event) => {
                  setCreatedTo(event.target.value);
                  setUploadPage(1);
                }}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
              />
            </label>
            {(createdFrom || createdTo) ? (
              <button
                type="button"
                onClick={() => {
                  setCreatedFrom("");
                  setCreatedTo("");
                  setUploadPage(1);
                }}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
              >
                清除日期
              </button>
            ) : null}
          </div>
        </div>
        {uploadErrorMessage ? (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{uploadErrorMessage}</div>
        ) : null}
        <div className="divide-y divide-zinc-50">
          {uploadsLoading ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-400">載入上傳紀錄中...</div>
          ) : uploads.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-zinc-400">此日期範圍沒有上傳紀錄</div>
          ) : uploads.map((upload) => {
            const imageUrl = imageUrlByUpload[upload.upload_id];
            const annotation = annotationByUpload.get(upload.upload_id);
            return (
              <div key={upload.upload_id} className="px-5 py-4 border-b border-zinc-50">
                <div className="flex items-start gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center shrink-0">
                    {imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage({ url: imageUrl, uploadId: upload.upload_id })}
                        className="h-full w-full cursor-zoom-in"
                        aria-label={`預覽 upload ${upload.upload_id}`}
                      >
                        <Image
                          src={imageUrl}
                          alt={`upload-${upload.upload_id}`}
                          width={80}
                          height={80}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <ImageIcon className="w-5 h-5 text-zinc-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ResultBadge result={upload.screening_result} />
                      <span className="text-xs text-zinc-400">
                        {new Date(upload.created_at).toLocaleString("zh-TW")}
                      </span>
                      <AnnotationChip annotation={annotation} />
                    </div>
                    {upload.error_reason ? <p className="text-xs text-amber-600">{upload.error_reason}</p> : null}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        className="rounded-lg border border-zinc-200 px-2 py-2 text-xs"
                        value={editingLabel[upload.upload_id] ?? annotation?.label ?? "normal"}
                        onChange={(event) =>
                          setEditingLabel((current) => ({
                            ...current,
                            [upload.upload_id]: event.target.value as StaffAnnotationItem["label"],
                          }))
                        }
                      >
                        <option value="normal">normal</option>
                        <option value="suspected">suspected</option>
                        <option value="confirmed_infection">confirmed_infection</option>
                        <option value="rejected">rejected</option>
                      </select>
                      <input
                        className="sm:col-span-2 rounded-lg border border-zinc-200 px-2 py-2 text-xs"
                        placeholder="備註..."
                        value={editingComment[upload.upload_id] ?? annotation?.comment ?? ""}
                        onChange={(event) =>
                          setEditingComment((current) => ({
                            ...current,
                            [upload.upload_id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSaveAnnotation(upload.upload_id)}
                        disabled={savingUploadId === upload.upload_id}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingUploadId === upload.upload_id ? "儲存中..." : "儲存標註"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-4">
          <div className="text-xs text-zinc-500">
            顯示 {uploadRangeStart}–{uploadRangeEnd} 筆，共 {uploadTotal} 筆
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              每頁筆數
              <select
                aria-label="每頁筆數"
                value={uploadPageSize}
                onChange={(event) => {
                  setUploadPageSize(Number(event.target.value) as 20 | 50 | 100);
                  setUploadPage(1);
                }}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-700"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <button
              type="button"
              aria-label="上一頁"
              disabled={uploadPage <= 1 || uploadsLoading}
              onClick={() => setUploadPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 disabled:text-zinc-300"
            >
              上一頁
            </button>
            <span className="text-xs text-zinc-500">{uploadPage} / {uploadTotalPages}</span>
            <button
              type="button"
              aria-label="下一頁"
              disabled={uploadPage >= uploadTotalPages || uploadsLoading}
              onClick={() => setUploadPage((current) => Math.min(uploadTotalPages, current + 1))}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 disabled:text-zinc-300"
            >
              下一頁
            </button>
          </div>
        </div>
      </div>

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg bg-white/15 px-3 py-2 text-sm text-white hover:bg-white/25"
            onClick={() => setPreviewImage(null)}
          >
            關閉
          </button>
          <div
            className="relative max-h-full w-full max-w-4xl overflow-hidden rounded-2xl bg-black/20"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={previewImage.url}
              alt={`upload-${previewImage.uploadId}-preview`}
              width={1600}
              height={1600}
              unoptimized
              className="max-h-[85vh] w-full object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
