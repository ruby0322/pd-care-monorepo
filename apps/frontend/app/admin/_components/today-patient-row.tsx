"use client";

import { PersonAvatar } from "@/app/admin/patient-assignment/person-avatar";
import { UploadThumb } from "@/app/admin/_components/upload-thumb";
import type { StaffTodayAttentionPatientItem, StaffTodayAttentionRiskHighlight } from "@/lib/api/staff";
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

function statusLabel(item: StaffTodayAttentionPatientItem, isTodaySelected: boolean): {
  text: string;
  className: string;
} {
  if (item.tier === "other") {
    return {
      text: isTodaySelected ? "今日已上傳" : "當日已上傳",
      className: "text-zinc-500",
    };
  }
  if (item.has_annotation) {
    return { text: "已註解", className: "text-green-600" };
  }
  return { text: "未處理", className: "text-red-600" };
}

function riskMainLine(highlight: StaffTodayAttentionRiskHighlight): string {
  if (highlight.screening_result === "suspected") {
    const pct =
      highlight.probability != null ? ` · AI ${Math.round(highlight.probability * 100)}%` : "";
    return `suspected${pct}`;
  }
  return "症狀高風險";
}

type TodayPatientRowProps = {
  item: StaffTodayAttentionPatientItem;
  isTodaySelected: boolean;
  selected: boolean;
  onSelect: (patientId: number) => void;
  imageUrlByUploadId: Record<number, string>;
  imageErrorByUploadId: Record<number, boolean>;
};

export function TodayPatientRow({
  item,
  isTodaySelected,
  selected,
  onSelect,
  imageUrlByUploadId,
  imageErrorByUploadId,
}: TodayPatientRowProps) {
  const name = item.full_name || item.case_number;
  const status = statusLabel(item, isTodaySelected);
  const highlight = item.risk_highlight;
  const isRiskTier = item.tier === "suspected" || item.tier === "elevated";

  const symptomLine =
    highlight != null
      ? activeSymptomLabels({
          pain: highlight.symptom_pain,
          discharge: highlight.symptom_discharge,
          pus: highlight.symptom_pus,
          cloudyDialysate: highlight.symptom_cloudy_dialysate,
        }).join("、")
      : "";

  const previewIds = item.preview_upload_ids ?? [];
  const overflow =
    !isRiskTier && item.day_upload_count > 4 ? item.day_upload_count - Math.min(previewIds.length, 3) : 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.patient_id)}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-400",
        selected && "ring-2 ring-zinc-900"
      )}
    >
      <div className="flex items-start gap-2.5">
        <PersonAvatar name={name} pictureUrl={item.picture_url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            當日 {item.day_upload_count} 張上傳
            <span className="mx-1 text-zinc-300">·</span>
            <span className={cn(status.className)}>{status.text}</span>
          </p>
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
          <div className="min-w-0 flex-1 px-2.5 py-1.5">
            <p className="text-[10px] text-zinc-400">最高風險 · {formatTime(highlight.created_at)}</p>
            <p className="truncate text-xs font-medium text-zinc-700">{riskMainLine(highlight)}</p>
            {symptomLine ? <p className="truncate text-[11px] text-zinc-500">{symptomLine}</p> : null}
          </div>
        </div>
      ) : null}

      {!isRiskTier && previewIds.length > 0 ? (
        <div className="flex h-14 gap-1.5">
          {previewIds.slice(0, overflow > 0 ? 3 : 4).map((uploadId) => (
            <div key={uploadId} className="h-14 w-14 shrink-0">
              <UploadThumb
                uploadId={uploadId}
                imageUrl={imageUrlByUploadId[uploadId] ?? null}
                imageError={imageErrorByUploadId[uploadId]}
              />
            </div>
          ))}
          {overflow > 0 ? (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
              +{overflow}
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
