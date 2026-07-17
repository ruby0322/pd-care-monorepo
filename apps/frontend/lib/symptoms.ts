export const SYMPTOM_KEYS = ["pain", "discharge", "pus", "cloudyDialysate"] as const;

export type SymptomKey = (typeof SYMPTOM_KEYS)[number];

export const SYMPTOM_LABELS: Record<SymptomKey, string> = {
  pain: "疼痛",
  discharge: "分泌物",
  pus: "膿",
  cloudyDialysate: "透析液混濁",
};

export const HIGH_RISK_SYMPTOM_KEYS = ["pain", "pus", "cloudyDialysate"] as const;

export type HighRiskSymptomKey = (typeof HIGH_RISK_SYMPTOM_KEYS)[number];

export type SymptomFlags = Record<SymptomKey, boolean>;

export type ScreeningResult = "normal" | "suspected" | "rejected" | "technical_error";

export type SymptomAwarePriority = "normal" | "suspected";

export function hasHighRiskSymptoms(flags: SymptomFlags): boolean {
  return HIGH_RISK_SYMPTOM_KEYS.some((key) => flags[key]);
}

export function symptomAwarePriority(
  screeningResult: ScreeningResult,
  flags: SymptomFlags
): SymptomAwarePriority {
  if (screeningResult === "suspected" || hasHighRiskSymptoms(flags)) {
    return "suspected";
  }
  return "normal";
}

/** True when image AI is normal but high-risk symptoms elevate patient UI to suspected chrome. */
export function isSymptomElevatedFromNormal(
  screeningResult: ScreeningResult,
  flags: SymptomFlags
): boolean {
  return screeningResult === "normal" && hasHighRiskSymptoms(flags);
}

export function activeSymptomLabels(flags: SymptomFlags): string[] {
  return SYMPTOM_KEYS.filter((key) => flags[key]).map((key) => SYMPTOM_LABELS[key]);
}

export function activeHighRiskSymptomLabels(flags: SymptomFlags): string[] {
  return HIGH_RISK_SYMPTOM_KEYS.filter((key) => flags[key]).map((key) => SYMPTOM_LABELS[key]);
}

/** Nurse-approved advisory when any high-risk symptom is checked. */
export function highRiskSymptomAdvisorySentence(flags: SymptomFlags): string | null {
  const labels = activeHighRiskSymptomLabels(flags);
  if (labels.length === 0) {
    return null;
  }
  return `因勾選（${labels.join("/")}）皆疑似感染高風險，請與您的腹膜透析護理師聯繫及返院追蹤。`;
}

export function symptomsFromApiFields(fields: {
  symptom_pain: boolean;
  symptom_discharge: boolean;
  symptom_pus: boolean;
  symptom_cloudy_dialysate: boolean;
}): SymptomFlags {
  return {
    pain: fields.symptom_pain,
    discharge: fields.symptom_discharge,
    pus: fields.symptom_pus,
    cloudyDialysate: fields.symptom_cloudy_dialysate,
  };
}
