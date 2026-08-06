"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";

import type { StaffAnnotationItem, StaffHistoryOverviewUploadItem } from "@/lib/api/staff";

import { historyUploadRiskLabel, type HistoryUploadDraftVerdict } from "./history-upload-review-helpers";

type HistoryUploadAnnotationModalProps = {
  upload: StaffHistoryOverviewUploadItem;
  imageUrl: string | null;
  draft: HistoryUploadDraftVerdict;
  saving: boolean;
  onDraftChange: (next: HistoryUploadDraftVerdict) => void;
  onSave: () => void;
  onClose: () => void;
};

export function HistoryUploadAnnotationModal({
  upload,
  imageUrl,
  draft,
  saving,
  onDraftChange,
  onSave,
  onClose,
}: HistoryUploadAnnotationModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-zinc-900/60 p-0 sm:items-center sm:p-4">
      <div className="h-[90vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:h-auto sm:max-w-3xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-900">{upload.patient_full_name ?? "未命名病患"}</p>
            <p className="font-mono text-xs text-zinc-500">{upload.case_number}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="關閉"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="relative h-80 overflow-hidden rounded-xl bg-zinc-100">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={`history-preview-${upload.upload_id}`}
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
                <dd className="text-right text-zinc-900">{upload.age ?? "-"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">上傳時間</dt>
                <dd className="text-right text-zinc-900">{new Date(upload.created_at).toLocaleString("zh-TW")}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">臨床風險</dt>
                <dd className="text-right text-zinc-900">{historyUploadRiskLabel(upload)}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">影像判讀</dt>
                <dd className="text-right text-zinc-900">{upload.screening_result}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">症狀綜合</dt>
                <dd className="text-right text-zinc-900">{upload.symptom_aware_priority}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">機率</dt>
                <dd className="text-right text-zinc-900">
                  {upload.probability !== null ? `${(upload.probability * 100).toFixed(1)}%` : "-"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">Threshold</dt>
                <dd className="text-right text-zinc-900">
                  {upload.threshold !== null ? upload.threshold.toFixed(2) : "-"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-zinc-400">Model</dt>
                <dd className="text-right text-zinc-900">{upload.model_version ?? "-"}</dd>
              </div>
            </dl>
            <div>
              <Link href={`/admin/patients/${upload.patient_id}`} className="text-xs text-zinc-500 hover:text-zinc-800">
                開啟病患完整頁
              </Link>
            </div>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              標註標籤
              <select
                value={draft.label}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    label: event.target.value as StaffAnnotationItem["label"],
                  })
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
                onChange={(event) => onDraftChange({ ...draft, comment: event.target.value })}
                rows={6}
                className="resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                placeholder="comment..."
              />
            </label>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="mt-auto rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {saving ? "儲存中..." : "儲存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
