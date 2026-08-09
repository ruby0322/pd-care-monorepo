"use client";

import Image from "next/image";
import { X } from "lucide-react";

import type { StaffAnnotationItem, StaffHistoryOverviewUploadItem } from "@/lib/api/staff";
import {
  STAFF_ANNOTATION_LABEL_OPTIONS_WITH_UNMARKED,
  STAFF_REVIEW_COPY,
  STAFF_REVIEW_FIELD_LABELS,
  annotationBadgeClass,
  annotationLabelTextOrUnmarked,
  screeningResultBadgeClass,
  screeningResultText,
  symptomAwarePriorityBadgeClass,
  symptomAwarePriorityText,
} from "@/lib/i18n/staff-review-label-mapping";
import { activeSymptomLabels, symptomsFromApiFields } from "@/lib/symptoms";

import { type HistoryUploadDraftVerdict } from "./history-upload-review-helpers";

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
  const symptomFlags = symptomsFromApiFields({
    symptom_pain: upload.symptom_pain,
    symptom_discharge: upload.symptom_discharge,
    symptom_pus: upload.symptom_pus,
    symptom_cloudy_dialysate: upload.symptom_cloudy_dialysate,
  });
  const symptomLabels = activeSymptomLabels(symptomFlags);

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
          <div className="md:self-start">
            <div className="relative h-72 overflow-hidden rounded-xl bg-zinc-100 md:h-[26rem]">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={`history-preview-${upload.upload_id}`}
                  fill
                  unoptimized
                  className="object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-400">{STAFF_REVIEW_COPY.loadingImage}</div>
              )}
            </div>
          </div>

          <div className="flex flex-col">
            <section className="pb-3">
              <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.uploadedAt}</dt>
                  <dd className="text-right text-zinc-900">{new Date(upload.created_at).toLocaleString("zh-TW")}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.symptomRisk}</dt>
                  <dd className="text-right text-zinc-900">
                    {upload.has_high_risk_symptoms ? STAFF_REVIEW_COPY.highRisk : STAFF_REVIEW_COPY.regularRisk}
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <p className="text-xs font-medium text-zinc-500">{STAFF_REVIEW_FIELD_LABELS.symptomReported}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {symptomLabels.length > 0 ? (
                    symptomLabels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
                      >
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
                      {STAFF_REVIEW_COPY.noSymptomsReported}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="border-t border-zinc-200 py-3">
              <dl className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.aiResult}</dt>
                  <dd className="text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${screeningResultBadgeClass(upload.screening_result)}`}
                    >
                      {screeningResultText(upload.screening_result)}
                    </span>
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.symptomPriority}</dt>
                  <dd className="text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${symptomAwarePriorityBadgeClass(upload.symptom_aware_priority)}`}
                    >
                      {symptomAwarePriorityText(upload.symptom_aware_priority)}
                    </span>
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.infectionProbability}</dt>
                  <dd className="text-right text-zinc-900">
                    {upload.probability !== null ? `${(upload.probability * 100).toFixed(1)}%` : "-"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="border-t border-zinc-200 pt-3">
              <dl className="mb-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-400">{STAFF_REVIEW_FIELD_LABELS.currentNurseMark}</dt>
                  <dd className="text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${annotationBadgeClass(upload.annotation_label)}`}
                    >
                      {annotationLabelTextOrUnmarked(upload.annotation_label)}
                    </span>
                  </dd>
                </div>
              </dl>

              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                {STAFF_REVIEW_FIELD_LABELS.annotationLabel}
                <select
                  value={draft.label}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      label: event.target.value as StaffAnnotationItem["label"] | "",
                    })
                  }
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                >
                  {STAFF_ANNOTATION_LABEL_OPTIONS_WITH_UNMARKED.map((option) => (
                    <option key={option.value || "unmarked"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
                {STAFF_REVIEW_FIELD_LABELS.annotationComment}
                <textarea
                  value={draft.comment}
                  onChange={(event) => onDraftChange({ ...draft, comment: event.target.value })}
                  rows={6}
                  className="resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                  placeholder={STAFF_REVIEW_COPY.commentPlaceholder}
                />
              </label>
            </section>

            <button
              type="button"
              onClick={onSave}
              disabled={saving || draft.label === ""}
              className="mt-4 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {saving ? "儲存中..." : "儲存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
