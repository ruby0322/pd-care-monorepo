import type { StaffAnnotationItem, StaffHistoryOverviewUploadItem } from "@/lib/api/staff";
import { annotationLabelText, screeningResultText } from "@/lib/i18n/staff-review-label-mapping";

export type HistoryUploadDraftVerdict = {
  label: StaffAnnotationItem["label"] | "";
  comment: string;
};

export function formatHistoryUploadLocalTime(raw: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(raw));
}

export function historyUploadRiskBadgeClass(upload: StaffHistoryOverviewUploadItem): string {
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

export function historyUploadRiskLabel(upload: StaffHistoryOverviewUploadItem): string {
  if (upload.annotation_label === "confirmed_infection") {
    return annotationLabelText("confirmed_infection");
  }
  if (upload.annotation_label === "suspected") {
    return annotationLabelText("suspected");
  }
  if (upload.annotation_label === "normal") {
    return annotationLabelText("normal");
  }
  if (upload.annotation_label === "rejected") {
    return annotationLabelText("rejected");
  }
  if (upload.risk_rank === 2) {
    return "症狀高風險";
  }
  return screeningResultText(upload.screening_result);
}

export function suggestedHistoryUploadLabel(
  upload: StaffHistoryOverviewUploadItem
): StaffAnnotationItem["label"] {
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
