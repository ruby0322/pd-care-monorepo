import { apiClient } from "@/lib/api/client";

export type StaffMeResponse = {
  line_user_id: string;
  role: "staff" | "admin";
};

export type StaffPatientSummary = {
  patient_id: number;
  case_number: string;
  full_name: string | null;
  line_user_id: string | null;
  age: number | null;
  upload_count: number;
  suspected_count: number;
  latest_upload_at: string | null;
};

export type StaffPatientListResponse = {
  months: number;
  total_patients: number;
  total_uploads: number;
  suspected_patients: number;
  items: StaffPatientSummary[];
};

export type StaffPatientDetailUpload = {
  upload_id: number;
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  threshold: number | null;
  model_version: string | null;
  error_reason: string | null;
  content_type: string;
  has_annotation: boolean;
};

export type StaffPatientDetailResponse = {
  patient_id: number;
  case_number: string;
  full_name: string | null;
  birth_date: string;
  age: number | null;
  line_user_id: string | null;
  total_uploads: number;
  suspected_uploads: number;
  rejected_uploads: number;
  uploads: StaffPatientDetailUpload[];
};

export type StaffUploadQueueItem = {
  upload_id: number;
  patient_id: number;
  case_number: string;
  full_name: string | null;
  line_user_id: string | null;
  created_at: string;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error";
  probability: number | null;
  has_annotation: boolean;
};

export type StaffUploadQueueResponse = { items: StaffUploadQueueItem[] };

export type StaffRapidReviewQueueItem = StaffUploadQueueItem & {
  risk_rank: number;
};

export type StaffAnnotationItem = {
  id: number;
  upload_id: number;
  patient_id: number;
  label: "normal" | "suspected" | "confirmed_infection" | "rejected";
  comment: string | null;
  reviewer_line_user_id: string;
  created_at: string;
};

export type StaffPendingBindingItem = {
  id: number;
  line_user_id: string;
  case_number: string;
  birth_date: string;
  status: string;
  created_at: string;
  candidates: { patient_id: number; case_number: string; full_name: string | null }[];
};

export type StaffNotificationItem = {
  id: number;
  patient_id: number;
  patient_case_number: string;
  patient_full_name: string | null;
  upload_id: number;
  ai_result_id: number | null;
  screening_result: "normal" | "suspected" | "rejected" | "technical_error" | null;
  probability: number | null;
  summary: string | null;
  status: "new" | "reviewed" | "resolved";
  created_at: string;
};

export type StaffNotificationListResponse = {
  items: StaffNotificationItem[];
  total: number;
  unread_count: number;
  limit: number;
  offset: number;
};

export async function fetchStaffMe(): Promise<StaffMeResponse> {
  const { data } = await apiClient.get<StaffMeResponse>("/v1/staff/me");
  return data;
}

export async function fetchStaffPatients(params: {
  months: number;
  ageMin?: number;
  ageMax?: number;
  infectionStatus: "all" | "suspected" | "normal";
  sortKey: "latest_upload" | "case_number" | "upload_count" | "suspected_count" | "age";
  sortDir: "asc" | "desc";
}): Promise<StaffPatientListResponse> {
  const { data } = await apiClient.get<StaffPatientListResponse>("/v1/staff/patients", {
    params: {
      months: params.months,
      age_min: params.ageMin,
      age_max: params.ageMax,
      infection_status: params.infectionStatus,
      sort_key: params.sortKey,
      sort_dir: params.sortDir,
    },
  });
  return data;
}

export async function fetchStaffPatientDetail(patientId: number): Promise<StaffPatientDetailResponse> {
  const { data } = await apiClient.get<StaffPatientDetailResponse>(`/v1/staff/patients/${patientId}`);
  return data;
}

export async function fetchUploadQueue(params?: {
  limit?: number;
  suspectedOnly?: boolean;
}): Promise<StaffUploadQueueResponse> {
  const requestParams = {
    limit: params?.limit ?? 20,
    suspected_only: params?.suspectedOnly ?? false,
  };
  try {
    const { data } = await apiClient.get<StaffUploadQueueResponse>("/v1/staff/uploads/queue", {
      params: requestParams,
    });
    return data;
  } catch (error) {
    throw error;
  }
}

function riskRank(item: StaffUploadQueueItem): number {
  if (item.screening_result === "suspected") {
    return 0;
  }
  if (item.screening_result === "normal") {
    return 1;
  }
  if (item.screening_result === "technical_error") {
    return 2;
  }
  return 3;
}

export function sortUploadsByRisk(items: StaffUploadQueueItem[]): StaffRapidReviewQueueItem[] {
  return [...items]
    .sort((a, b) => {
      const riskDelta = riskRank(a) - riskRank(b);
      if (riskDelta !== 0) {
        return riskDelta;
      }

      const probabilityA = a.probability ?? -1;
      const probabilityB = b.probability ?? -1;
      if (probabilityA !== probabilityB) {
        return probabilityB - probabilityA;
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .map((item) => ({
      ...item,
      risk_rank: riskRank(item),
    }));
}

export async function fetchPatientAnnotations(patientId: number): Promise<StaffAnnotationItem[]> {
  const { data } = await apiClient.get<{ items: StaffAnnotationItem[] }>(`/v1/staff/patients/${patientId}/annotations`);
  return data.items;
}

export async function upsertUploadAnnotation(
  uploadId: number,
  payload: { label: StaffAnnotationItem["label"]; comment: string }
): Promise<StaffAnnotationItem> {
  const { data } = await apiClient.post<StaffAnnotationItem>(`/v1/staff/uploads/${uploadId}/annotation`, payload);
  return data;
}

export async function fetchPendingBindings(): Promise<StaffPendingBindingItem[]> {
  const { data } = await apiClient.get<{ items: StaffPendingBindingItem[] }>("/v1/staff/pending-bindings");
  return data.items;
}

export async function approvePendingBinding(pendingId: number): Promise<void> {
  await apiClient.post(`/v1/staff/pending-bindings/${pendingId}/approve`);
}

export async function rejectPendingBinding(pendingId: number): Promise<void> {
  await apiClient.post(`/v1/staff/pending-bindings/${pendingId}/reject`);
}

export async function linkPendingBinding(pendingId: number, patientId: number): Promise<void> {
  await apiClient.post(`/v1/staff/pending-bindings/${pendingId}/link`, { patient_id: patientId });
}

export async function fetchUploadImageAccess(uploadId: number): Promise<{ image_url: string; expires_in: number }> {
  const { data } = await apiClient.get<{ image_url: string; expires_in: number }>(
    `/v1/staff/uploads/${uploadId}/image-access`
  );
  return data;
}

export async function fetchStaffNotifications(params?: {
  limit?: number;
  offset?: number;
}): Promise<StaffNotificationListResponse> {
  const { data } = await apiClient.get<StaffNotificationListResponse>("/v1/staff/notifications", {
    params: {
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
    },
  });
  return data;
}

export async function markStaffNotificationRead(notificationId: number): Promise<StaffNotificationItem> {
  const { data } = await apiClient.post<StaffNotificationItem>(`/v1/staff/notifications/${notificationId}/read`);
  return data;
}
