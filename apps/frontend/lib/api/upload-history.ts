import { apiClient } from "@/lib/api/client";

export type UploadHistoryDay = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

export type UploadHistorySummary28d = {
  all_upload_count_28d: number;
  suspected_upload_count_28d: number;
  continuous_upload_streak_days: number;
};

export type UploadHistoryResponse = {
  status: "matched" | "pending" | "unbound";
  patient_id: number | null;
  can_upload: boolean;
  days: UploadHistoryDay[];
  summary_28d: UploadHistorySummary28d;
};

export type PatientDayUploadItem = {
  upload_id: number;
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  threshold: number | null;
  model_version: string | null;
  error_reason: string | null;
  annotation_label: string | null;
  annotation_comment: string | null;
};

export type PatientDayUploadListResponse = {
  date: string;
  items: PatientDayUploadItem[];
};

export type PatientUploadDetailResponse = {
  upload_id: number;
  created_at: string;
  date: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  threshold: number | null;
  model_version: string | null;
  error_reason: string | null;
  annotation_label: string | null;
  annotation_comment: string | null;
  image_url: string;
  image_expires_in: number;
  prev_upload_id: number | null;
  next_upload_id: number | null;
};

export async function fetchUploadHistory(): Promise<UploadHistoryResponse> {
  const { data } = await apiClient.get<UploadHistoryResponse>("/v1/patient/upload-history");
  return data;
}

export async function fetchUploadsByDay(date: string): Promise<PatientDayUploadListResponse> {
  const { data } = await apiClient.get<PatientDayUploadListResponse>("/v1/patient/uploads/by-day", {
    params: { date },
  });
  return data;
}

export async function fetchPatientUploadDetail(uploadId: number): Promise<PatientUploadDetailResponse> {
  const { data } = await apiClient.get<PatientUploadDetailResponse>(`/v1/patient/uploads/${uploadId}/detail`);
  return data;
}
