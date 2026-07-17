export type ScreeningResult = "normal" | "suspected" | "rejected" | "technical_error";

export type SymptomFlags = {
  pain: boolean;
  discharge: boolean;
  pus: boolean;
};

/** High-risk symptoms that elevate display urgency even when the image model is normal. */
export function hasHighRiskSymptoms(flags: SymptomFlags): boolean {
  return Boolean(flags.pain || flags.pus);
}

export function activeSymptomLabels(flags: SymptomFlags): string[] {
  const labels: string[] = [];
  if (flags.pain) {
    labels.push("疼痛");
  }
  if (flags.discharge) {
    labels.push("分泌物");
  }
  if (flags.pus) {
    labels.push("膿");
  }
  return labels;
}

/** Display-only: image `normal` + high-risk symptoms → treat UI as suspected risk. */
export function isSymptomElevatedFromNormal(
  screeningResult: ScreeningResult,
  flags: SymptomFlags
): boolean {
  return screeningResult === "normal" && hasHighRiskSymptoms(flags);
}
