import type { StaffAnnotationItem, StaffHistoryOverviewUploadItem } from "@/lib/api/staff";

export const STAFF_REVIEW_FIELD_LABELS = {
  age: "年齡",
  uploadedAt: "上傳時間",
  symptomReported: "症狀回報",
  symptomRisk: "症狀風險",
  symptomPriority: "症狀綜合判定",
  currentNurseMark: "目前護理標記",
  aiResult: "AI 判讀結果",
  infectionProbability: "分類信心",
  decisionThreshold: "判讀門檻",
  modelVersion: "模型版本",
  annotationLabel: "護理審核標籤",
  annotationComment: "護理備註",
} as const;

export const STAFF_REVIEW_COPY = {
  noSymptomsReported: "未回報症狀",
  highRisk: "高風險",
  regularRisk: "一般風險",
  unmarked: "未標註",
  annotated: "已標註",
  commentPlaceholder: "請輸入護理審核備註（選填）",
  loadingImage: "載入影像中...",
} as const;

export const STAFF_ANNOTATION_LABEL_TEXT: Record<StaffAnnotationItem["label"], string> = {
  normal: "正常",
  suspected: "疑似感染",
  confirmed_infection: "確認感染",
  rejected: "上傳不採用",
};

export const STAFF_ANNOTATION_BADGE_CLASS: Record<StaffAnnotationItem["label"], string> = {
  normal: "bg-emerald-50 text-emerald-700",
  suspected: "bg-red-50 text-red-700",
  confirmed_infection: "bg-rose-100 text-rose-700",
  rejected: "bg-zinc-100 text-zinc-700",
};

export const STAFF_ANNOTATION_LABEL_OPTIONS = [
  { value: "normal", label: STAFF_ANNOTATION_LABEL_TEXT.normal },
  { value: "suspected", label: STAFF_ANNOTATION_LABEL_TEXT.suspected },
  { value: "confirmed_infection", label: STAFF_ANNOTATION_LABEL_TEXT.confirmed_infection },
  { value: "rejected", label: STAFF_ANNOTATION_LABEL_TEXT.rejected },
] as const satisfies ReadonlyArray<{
  value: StaffAnnotationItem["label"];
  label: string;
}>;

export const STAFF_ANNOTATION_LABEL_OPTIONS_WITH_UNMARKED = [
  { value: "", label: STAFF_REVIEW_COPY.unmarked },
  ...STAFF_ANNOTATION_LABEL_OPTIONS,
] as const satisfies ReadonlyArray<{
  value: StaffAnnotationItem["label"] | "";
  label: string;
}>;

export function screeningResultText(value: StaffHistoryOverviewUploadItem["screening_result"]): string {
  if (value === "normal") {
    return "正常";
  }
  if (value === "suspected") {
    return "疑似感染";
  }
  if (value === "rejected") {
    return "影像不採用";
  }
  return "判讀失敗";
}

export function screeningResultBadgeClass(value: StaffHistoryOverviewUploadItem["screening_result"]): string {
  if (value === "normal") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (value === "suspected") {
    return "bg-red-50 text-red-700";
  }
  if (value === "rejected") {
    return "bg-zinc-100 text-zinc-700";
  }
  return "bg-amber-50 text-amber-700";
}

export function symptomAwarePriorityText(value: StaffHistoryOverviewUploadItem["symptom_aware_priority"]): string {
  return value === "suspected" ? "疑似感染" : "一般";
}

export function symptomAwarePriorityBadgeClass(value: StaffHistoryOverviewUploadItem["symptom_aware_priority"]): string {
  return value === "suspected" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700";
}

export function annotationLabelText(value: StaffAnnotationItem["label"]): string {
  return STAFF_ANNOTATION_LABEL_TEXT[value];
}

export function annotationLabelTextOrUnmarked(value: StaffAnnotationItem["label"] | null): string {
  return value ? STAFF_ANNOTATION_LABEL_TEXT[value] : STAFF_REVIEW_COPY.unmarked;
}

export function annotationBadgeClass(value: StaffAnnotationItem["label"] | null): string {
  if (!value) {
    return "bg-zinc-100 text-zinc-700";
  }
  return STAFF_ANNOTATION_BADGE_CLASS[value];
}

export function annotationStatusBadgeClass(hasAnnotation: boolean): string {
  return hasAnnotation ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-700";
}
