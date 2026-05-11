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

export type PatientUploadResponse = {
  upload_id: number;
  ai_result_id: number;
  patient_id: number;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  model_version: string | null;
  threshold: number | null;
  notification_id: number | null;
  prediction: PredictResponse & {
    screening: PredictResponse["screening"] & {
      threshold: number;
      infection_probability: number;
    };
  };
};

export async function uploadPatientExitSiteImage(
  file: File
): Promise<PatientUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

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
