"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { useState } from "react";

import { PersonAvatar } from "@/app/admin/patient-assignment/person-avatar";
import { PatientDayUploadReviewModal } from "@/app/admin/_components/patient-day-upload-review-modal";
import { UploadThumb } from "@/app/admin/_components/upload-thumb";
import type { StaffTodayAttentionPatientItem } from "@/lib/api/staff";
import { STAFF_REVIEW_COPY, annotationBadgeClass, annotationLabelTextOrUnmarked } from "@/lib/i18n/staff-review-label-mapping";
import { activeSymptomLabels } from "@/lib/symptoms";
import { cn } from "@/lib/utils";

type TodayPatientDetailPanelProps = {
  item: StaffTodayAttentionPatientItem | null;
  selectedDate: string;
  dayScopeLabel: string;
  className?: string;
  onReviewSaved?: () => void;
  imageUrlByUploadId?: Record<number, string>;
  imageErrorByUploadId?: Record<number, boolean>;
};

function tierLabel(tier: StaffTodayAttentionPatientItem["tier"]): { text: string; className: string } {
  if (tier === "suspected") {
    return { text: "疑似感染", className: "bg-red-50 text-red-700" };
  }
  if (tier === "elevated") {
    return { text: "症狀高風險", className: "bg-amber-50 text-amber-800" };
  }
  return { text: "一般", className: "bg-zinc-100 text-zinc-600" };
}

function statusLabel(item: StaffTodayAttentionPatientItem): {
  text: string;
  className: string;
} {
  if (item.has_annotation) {
    return { text: STAFF_REVIEW_COPY.annotated, className: "text-emerald-600" };
  }
  return { text: STAFF_REVIEW_COPY.unmarked, className: "text-zinc-500" };
}

function formatTime(raw: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(raw));
}

function collectUploadIds(item: StaffTodayAttentionPatientItem): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const push = (uploadId: number) => {
    if (seen.has(uploadId)) {
      return;
    }
    seen.add(uploadId);
    ids.push(uploadId);
  };
  if (item.risk_highlight) {
    push(item.risk_highlight.upload_id);
  }
  for (const uploadId of item.preview_upload_ids ?? []) {
    push(uploadId);
  }
  if (ids.length === 0) {
    push(item.representative_upload_id);
  }
  return ids;
}

export function TodayPatientDetailPanel({
  item,
  selectedDate,
  dayScopeLabel,
  className,
  onReviewSaved,
  imageUrlByUploadId = {},
  imageErrorByUploadId = {},
}: TodayPatientDetailPanelProps) {
  const [reviewOpen, setReviewOpen] = useState(false);

  if (!item) {
    return (
      <aside
        className={cn(
          "rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-4 text-center",
          className
        )}
      >
        <p className="text-sm font-medium text-zinc-700">病患預覽</p>
        <p className="mt-2 text-xs text-zinc-400">點選左側病患卡片以查看當日上傳預覽與快速操作。</p>
      </aside>
    );
  }

  const name = item.full_name || item.case_number;
  const tier = tierLabel(item.tier);
  const status = statusLabel(item);
  const highlight = item.risk_highlight;
  const uploadIds = collectUploadIds(item).slice(0, 4);
  const overflowCount = Math.max(0, item.day_upload_count - uploadIds.length);
  const canReview = item.day_upload_count > 0;

  const symptomLine =
    highlight != null
      ? activeSymptomLabels({
          pain: highlight.symptom_pain,
          discharge: highlight.symptom_discharge,
          pus: highlight.symptom_pus,
          cloudyDialysate: highlight.symptom_cloudy_dialysate,
        }).join("、")
      : "";

  return (
    <>
      <aside className={cn("rounded-xl border border-zinc-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex items-start gap-3">
        <PersonAvatar name={name} pictureUrl={item.picture_url} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-900">{name}</h2>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
                annotationBadgeClass(item.annotation_label)
              )}
            >
              {annotationLabelTextOrUnmarked(item.annotation_label)}
            </span>
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none", tier.className)}>
              {tier.text}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">{item.case_number}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {dayScopeLabel} {item.day_upload_count} 張上傳
            <span className="mx-1 text-zinc-300">·</span>
            <span className={status.className}>{status.text}</span>
          </p>
        </div>
      </div>

      {highlight ? (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">最高風險上傳</p>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
                highlight.screening_result === "suspected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
              )}
            >
              {highlight.screening_result === "suspected" ? "疑似感染" : "症狀高風險"}
            </span>
            {highlight.screening_result === "suspected" && highlight.probability != null ? (
              <span className="text-xs font-medium text-zinc-700">AI {Math.round(highlight.probability * 100)}%</span>
            ) : null}
            <span className="text-zinc-300">·</span>
            <span className="text-xs text-zinc-700">{formatTime(highlight.created_at)}</span>
          </div>
          {symptomLine ? <p className="mt-1 text-[11px] text-zinc-500">{symptomLine}</p> : null}
        </div>
      ) : null}

      <div className="mt-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">上傳預覽</p>
        <div className="grid grid-cols-2 gap-2">
          {uploadIds.map((uploadId, index) => {
            const showOverflow = overflowCount > 0 && index === uploadIds.length - 1;
            return (
              <div key={uploadId} className="relative aspect-square overflow-hidden rounded-md">
                <UploadThumb
                  uploadId={uploadId}
                  imageUrl={imageUrlByUploadId[uploadId] ?? null}
                  imageError={imageErrorByUploadId[uploadId]}
                />
                {showOverflow ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-semibold text-white">
                    +{overflowCount}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <Link
          href={`/admin/patients/${item.patient_id}`}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-400"
        >
          <UserRound className="h-4 w-4" />
          病患資料
        </Link>
        {canReview ? (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            審核
          </button>
        ) : null}
      </div>
      </aside>

      {reviewOpen ? (
        <PatientDayUploadReviewModal
          key={`${item.patient_id}-${selectedDate}`}
          open
          onClose={() => setReviewOpen(false)}
          patientId={item.patient_id}
          localDate={selectedDate}
          fallbackName={name}
          fallbackCaseNumber={item.case_number}
          fallbackPictureUrl={item.picture_url}
          onReviewSaved={onReviewSaved}
        />
      ) : null}
    </>
  );
}
