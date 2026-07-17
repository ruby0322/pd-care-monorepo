/** Frame-diff camera stability helpers for live capture guidance. */

export const STABILITY_SAMPLE_SIZE = 64;
export const STABILITY_MAD_THRESHOLD = 13.8; // 9.2 × 1.5 — higher shake tolerance
export const STABILITY_REQUIRED_STABLE_SAMPLES = 3;

export type StabilityTracker = {
  previousGray: Uint8ClampedArray | null;
  consecutiveStable: number;
  isStable: boolean;
};

export function createStabilityTracker(): StabilityTracker {
  return {
    previousGray: null,
    consecutiveStable: 0,
    isStable: false,
  };
}

/** Mean absolute difference between two grayscale buffers of equal length (0–255). */
export function computeGrayMad(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length === 0 || a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return sum / a.length;
}

export function rgbaToGray(rgba: Uint8ClampedArray, pixelCount: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/**
 * Advance stability state from a new grayscale sample.
 * Unstable immediately when MAD exceeds threshold; stable after N consecutive calm samples.
 */
export function nextStabilityState(
  tracker: StabilityTracker,
  gray: Uint8ClampedArray,
  options?: { madThreshold?: number; requiredStableSamples?: number }
): StabilityTracker {
  const madThreshold = options?.madThreshold ?? STABILITY_MAD_THRESHOLD;
  const requiredStableSamples =
    options?.requiredStableSamples ?? STABILITY_REQUIRED_STABLE_SAMPLES;

  if (tracker.previousGray === null) {
    return {
      previousGray: gray,
      consecutiveStable: 0,
      isStable: false,
    };
  }

  const mad = computeGrayMad(tracker.previousGray, gray);
  if (mad > madThreshold) {
    return {
      previousGray: gray,
      consecutiveStable: 0,
      isStable: false,
    };
  }

  const consecutiveStable = tracker.consecutiveStable + 1;
  return {
    previousGray: gray,
    consecutiveStable,
    isStable: consecutiveStable >= requiredStableSamples,
  };
}

export type PresenceGuidanceStatus = "shaky" | "idle" | "ok" | "realign" | "unavailable";

export type PresencePollResult = "idle" | "ok" | "realign" | "unavailable";

export function resolveGuidanceStatus(
  isStable: boolean,
  presence: PresencePollResult
): PresenceGuidanceStatus {
  if (!isStable) {
    return "shaky";
  }
  return presence;
}

export function isShutterEnabled(status: PresenceGuidanceStatus): boolean {
  return status === "ok" || status === "unavailable";
}

export const GUIDANCE_COPY: Record<PresenceGuidanceStatus, string> = {
  shaky: "畫面晃動中，請將手機握穩後再對準出口",
  idle: "請把腹膜透析的出口部位放進圓圈內",
  ok: "已找到出口部位，可以按下快門",
  realign: "圓圈內還看不到出口部位，請調整角度或距離",
  unavailable: "暫時無法自動檢查，仍可拍照上傳",
};

/** Subtle ring stroke colors for live guidance (dark camera overlay). */
export const GUIDANCE_RING_STROKE: Record<PresenceGuidanceStatus, string> = {
  shaky: "#93c5fd", // soft blue — hold steady
  idle: "rgba(255,255,255,0.75)",
  ok: "#86efac", // soft green — ready
  realign: "#fcd34d", // soft amber — exit site not in frame
  unavailable: "rgba(212,212,216,0.7)",
};

export function mapPrescreenToPresence(
  response: { present: boolean; checked: boolean } | null,
  errored: boolean
): PresencePollResult {
  if (errored) {
    return "unavailable";
  }
  if (!response) {
    return "idle";
  }
  if (!response.checked) {
    return "unavailable";
  }
  return response.present ? "ok" : "realign";
}
