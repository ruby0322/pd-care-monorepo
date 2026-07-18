import { isAxiosError } from "axios";

import { apiClient } from "@/lib/api/client";

export type PredictResponse = {
  predicted_probability: number;
  screening: {
    is_infection_positive: boolean;
  };
};

export async function predictExitSiteImage(file: File): Promise<PredictResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await apiClient.post<PredictResponse>("/v1/predict", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return data;
}

export type PatientPrescreenResponse = {
  present: boolean;
  checked: boolean;
};

const PRESCREEN_429_MAX_RETRIES = 2;
const PRESCREEN_429_BACKOFF_MS = [400, 800] as const;

/** Resolves after `ms`, or rejects immediately if `signal` aborts (including mid-wait). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function prescreenPatientExitSiteImage(
  file: File,
  options?: { signal?: AbortSignal }
): Promise<PatientPrescreenResponse> {
  const formData = new FormData();
  formData.append("file", file);

  let lastError: unknown;
  for (let attempt = 0; attempt <= PRESCREEN_429_MAX_RETRIES; attempt += 1) {
    try {
      const { data } = await apiClient.post<PatientPrescreenResponse>("/v1/patient/prescreen", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        signal: options?.signal,
        timeout: 8000,
      });
      return data;
    } catch (error) {
      lastError = error;
      if (options?.signal?.aborted) {
        throw error;
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 429 || attempt >= PRESCREEN_429_MAX_RETRIES) {
        throw error;
      }
      await sleep(PRESCREEN_429_BACKOFF_MS[attempt] ?? 800, options?.signal);
    }
  }
  throw lastError;
}

export type PatientUploadResponse = {
  upload_id: number;
  ai_result_id: number;
  patient_id: number;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  model_version: string | null;
  threshold: number | null;
  notification_id: number | null;
  symptom_pain: boolean;
  symptom_discharge: boolean;
  symptom_pus: boolean;
  symptom_cloudy_dialysate: boolean;
  has_high_risk_symptoms: boolean;
  symptom_aware_priority: "normal" | "suspected";
  prediction:
    | (PredictResponse & {
        screening: PredictResponse["screening"] & {
          threshold: number;
          infection_probability: number;
        };
      })
    | null;
};

export async function uploadPatientExitSiteImage(
  file: File,
  symptoms: {
    pain: boolean;
    discharge: boolean;
    pus: boolean;
    cloudyDialysate: boolean;
  }
): Promise<PatientUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pain", String(symptoms.pain));
  formData.append("discharge", String(symptoms.discharge));
  formData.append("pus", String(symptoms.pus));
  formData.append("cloudy_dialysate", String(symptoms.cloudyDialysate));

  const { data } = await apiClient.post<PatientUploadResponse>("/v1/patient/uploads", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return data;
}

export type PatientUploadResultResponse = {
  upload_id: number;
  ai_result_id: number;
  patient_id: number;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  threshold: number | null;
  model_version: string | null;
  error_reason: string | null;
  symptom_pain: boolean;
  symptom_discharge: boolean;
  symptom_pus: boolean;
  symptom_cloudy_dialysate: boolean;
  has_high_risk_symptoms: boolean;
  symptom_aware_priority: "normal" | "suspected";
  created_at: string;
};

export async function getPatientUploadResult(params: {
  uploadId?: number;
  aiResultId?: number;
}): Promise<PatientUploadResultResponse> {
  const { data } = await apiClient.get<PatientUploadResultResponse>("/v1/patient/uploads/result", {
    params: {
      upload_id: params.uploadId,
      ai_result_id: params.aiResultId,
    },
  });
  return data;
}
