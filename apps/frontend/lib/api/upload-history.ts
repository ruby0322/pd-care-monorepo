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

export type PatientMessageItem = {
  annotation_id: number;
  upload_id: number;
  created_at: string;
  label: string;
  comment: string | null;
  is_read: boolean;
  image_url: string;
  image_expires_in: number;
};

export type PatientMessageListResponse = {
  items: PatientMessageItem[];
  total: number;
  unread_count: number;
  limit: number;
  offset: number;
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

export async function fetchPatientMessages(params?: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}): Promise<PatientMessageListResponse> {
  const { data } = await apiClient.get<PatientMessageListResponse>("/v1/patient/messages", {
    params: {
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
      unread_only: params?.unreadOnly ?? false,
    },
  });
  return data;
}

export async function markPatientMessageRead(annotationId: number): Promise<PatientMessageItem> {
  const { data } = await apiClient.post<PatientMessageItem>(`/v1/patient/messages/${annotationId}/read`);
  return data;
}
