"use client";

import { PersonAvatar } from "@/app/admin/patient-assignment/person-avatar";
import { UploadThumb } from "@/app/admin/_components/upload-thumb";
import type { StaffTodayAttentionPatientItem, StaffTodayAttentionRiskHighlight } from "@/lib/api/staff";
import { annotationBadgeClass, annotationLabelTextOrUnmarked } from "@/lib/i18n/staff-review-label-mapping";
import { activeSymptomLabels } from "@/lib/symptoms";
import { cn } from "@/lib/utils";

function formatTime(raw: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(raw));
}

function riskBadge(highlight: StaffTodayAttentionRiskHighlight): { text: string; className: string } {
  if (highlight.screening_result === "suspected") {
    return { text: "疑似感染", className: "bg-red-50 text-red-700" };
  }
  return { text: "症狀高風險", className: "bg-amber-50 text-amber-800" };
}

function rowAnnotationBadge(item: StaffTodayAttentionPatientItem): {
  className: string;
  showRiskDot: boolean;
} {
  if (item.has_annotation) {
    return { className: annotationBadgeClass(item.annotation_label), showRiskDot: false };
  }
  const isRiskTier = item.tier === "suspected" || item.tier === "elevated";
  return {
    className: "bg-zinc-100 text-zinc-700",
    showRiskDot: isRiskTier,
  };
}

type TodayPatientRowProps = {
  item: StaffTodayAttentionPatientItem;
  selected: boolean;
  onSelect: (patientId: number) => void;
  imageUrlByUploadId: Record<number, string>;
  imageErrorByUploadId: Record<number, boolean>;
};

export function TodayPatientRow({
  item,
  selected,
  onSelect,
  imageUrlByUploadId,
  imageErrorByUploadId,
}: TodayPatientRowProps) {
  const name = item.full_name || item.case_number;
  const highlight = item.risk_highlight;
  const isRiskTier = item.tier === "suspected" || item.tier === "elevated";
  const annotationBadge = rowAnnotationBadge(item);

  const symptomLine =
    highlight != null
      ? activeSymptomLabels({
          pain: highlight.symptom_pain,
          discharge: highlight.symptom_discharge,
          pus: highlight.symptom_pus,
          cloudyDialysate: highlight.symptom_cloudy_dialysate,
        }).join("、")
      : "";

  const previewIds = (item.preview_upload_ids ?? []).slice(0, 3);
  const overflowCount = !isRiskTier && item.day_upload_count > 3 ? item.day_upload_count - 3 : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.patient_id)}
      className={cn(
        "relative flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-400",
        selected && "ring-2 ring-zinc-900"
      )}
    >
      <span
        className={`absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${annotationBadge.className}`}
      >
        {annotationBadge.showRiskDot ? <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden /> : null}
        {annotationLabelTextOrUnmarked(item.annotation_label)}
      </span>

      <div className="flex items-start gap-2.5">
        <PersonAvatar name={name} pictureUrl={item.picture_url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">上傳 {item.day_upload_count} 張</p>
        </div>
      </div>

      {isRiskTier && highlight ? (
        <div className="flex h-14 overflow-hidden rounded-lg bg-zinc-50 ring-1 ring-zinc-200">
          <div className="relative h-14 w-14 shrink-0">
            <UploadThumb
              uploadId={highlight.upload_id}
              imageUrl={imageUrlByUploadId[highlight.upload_id] ?? null}
              imageError={imageErrorByUploadId[highlight.upload_id]}
            />
          </div>
          <div className="min-w-0 flex h-full flex-col justify-center px-2.5 py-1.5">
            <p className="text-[10px] text-zinc-400">最高風險 · {formatTime(highlight.created_at)}</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ${riskBadge(highlight).className}`}
              >
                {riskBadge(highlight).text}
              </span>
              {highlight.screening_result === "suspected" && highlight.probability != null ? (
                <span className="text-xs font-medium text-zinc-700">AI {Math.round(highlight.probability * 100)}%</span>
              ) : null}
            </div>
            {item.tier !== "elevated" && symptomLine ? <p className="truncate text-[11px] text-zinc-500">{symptomLine}</p> : null}
          </div>
        </div>
      ) : null}

      {!isRiskTier && previewIds.length > 0 ? (
        <div className="flex h-14 gap-1.5">
          {previewIds.map((uploadId, index) => {
            const showOverflow = overflowCount > 0 && index === previewIds.length - 1;
            return (
              <div key={uploadId} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md">
                <UploadThumb
                  uploadId={uploadId}
                  imageUrl={imageUrlByUploadId[uploadId] ?? null}
                  imageError={imageErrorByUploadId[uploadId]}
                />
                {showOverflow ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs font-semibold text-white">
                    +{overflowCount}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </button>
  );
}
