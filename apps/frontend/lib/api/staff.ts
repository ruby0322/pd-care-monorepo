import { apiClient } from "@/lib/api/client";

export type StaffMeResponse = {
  line_user_id: string;
  role: "staff" | "admin";
};

export type StaffPatientSummary = {
  patient_id: number;
  case_number: string;
  full_name: string | null;
  gender: "male" | "female" | "other" | "unknown";
  line_display_name: string | null;
  line_user_id: string | null;
  age: number | null;
  upload_count: number;
  suspected_count: number;
  latest_upload_at: string | null;
  is_active: boolean;
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
  gender: "male" | "female" | "other" | "unknown";
  birth_date: string;
  age: number | null;
  line_display_name: string | null;
  line_user_id: string | null;
  is_active: boolean;
  total_uploads: number;
  suspected_uploads: number;
  rejected_uploads: number;
  uploads: StaffPatientDetailUpload[];
};

export type StaffPatientCreatePayload = {
  case_number: string;
  birth_date: string;
  full_name: string;
  gender: "male" | "female" | "other" | "unknown";
};

export type StaffPatientCreateResponse = {
  patient_id: number;
  case_number: string;
  birth_date: string;
  full_name: string | null;
  gender: "male" | "female" | "other" | "unknown";
  is_active: boolean;
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

export type AdminGenderDistributionItem = {
  gender: "male" | "female" | "other" | "unknown";
  count: number;
};

export type AdminGenderDistributionResponse = {
  total_patients: number;
  items: AdminGenderDistributionItem[];
};

export type AdminTodaySuspectedSummaryResponse = {
  date: string;
  total_uploads: number;
  suspected_uploads: number;
  normal_uploads: number;
  suspected_ratio: number;
};

export type AdminAgeHistogramBucket = {
  range_start: number;
  range_end: number;
  label: string;
  count: number;
};

export type AdminAgeHistogramResponse = {
  bucket_size: number;
  total_patients: number;
  items: AdminAgeHistogramBucket[];
};

export type AdminActiveUsersSeriesPoint = {
  date: string;
  active_users: number;
};

export type AdminActiveUsersSeriesResponse = {
  active_window_days: number;
  lookback_days: number;
  interval: "day" | "week";
  items: AdminActiveUsersSeriesPoint[];
};

export type AdminDailySuspectedSeriesPoint = {
  date: string;
  total_uploads: number;
  suspected_uploads: number;
  suspected_ratio: number;
};

export type AdminDailySuspectedSeriesResponse = {
  lookback_days: number;
  items: AdminDailySuspectedSeriesPoint[];
};

export type AdminIdentityItem = {
  id: number;
  line_user_id: string;
  display_name: string | null;
  role: "patient" | "staff" | "admin";
  is_active: boolean;
  patient_id: number | null;
  created_at: string;
};

export type AdminInactiveIdentityDeletePreview = {
  requested_count: number;
  deletable_count: number;
  skipped_active_count: number;
  skipped_missing_count: number;
};

export type AdminInactiveIdentityDeleteResult = {
  requested_count: number;
  deleted_count: number;
  skipped_active_count: number;
  skipped_missing_count: number;
};

export type AdminAccessRequestItem = {
  id: number;
  requester_identity_id: number;
  line_user_id: string;
  display_name: string | null;
  requester_role: "patient" | "staff" | "admin";
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  decision_role: "patient" | "staff" | "admin" | null;
  created_at: string;
  decided_at: string | null;
};

export type AdminPatientAssignmentItem = {
  patient_id: number;
  case_number: string;
  patient_full_name: string | null;
  staff_identity_id: number | null;
  staff_line_user_id: string | null;
  staff_display_name: string | null;
};

export type AdminPatientAssignmentUpsertResponse = {
  patient_id: number;
  staff_identity_id: number;
  status: "updated" | "unchanged";
};

export type AdminPatientAssignmentBulkItemResult = {
  patient_id: number | null;
  staff_identity_id: number | null;
  status: "updated" | "unchanged" | "invalid";
  detail: string | null;
};

export type AdminPatientAssignmentBulkResponse = {
  results: AdminPatientAssignmentBulkItemResult[];
};

export type StaffPatientDeleteImpact = {
  patients: number;
  uploads: number;
  ai_results: number;
  annotations: number;
  notifications: number;
  assignments: number;
};

export type StaffInactivePatientDeletePreview = {
  requested_count: number;
  deletable_count: number;
  skipped_active_count: number;
  skipped_forbidden_count: number;
  skipped_missing_count: number;
  impact: StaffPatientDeleteImpact;
};

export type StaffInactivePatientDeleteResult = {
  requested_count: number;
  deleted_count: number;
  skipped_active_count: number;
  skipped_forbidden_count: number;
  skipped_missing_count: number;
  impact: StaffPatientDeleteImpact;
};

export async function fetchStaffMe(): Promise<StaffMeResponse> {
  const { data } = await apiClient.get<StaffMeResponse>("/v1/staff/me");
  return data;
}

export async function fetchStaffPatients(params: {
  months: number;
  ageMin?: number;
  ageMax?: number;
  query?: string;
  infectionStatus: "all" | "suspected" | "normal";
  isActiveFilter?: "all" | "active" | "inactive";
  createdFrom?: string;
  createdTo?: string;
  sortKey: "latest_upload" | "case_number" | "upload_count" | "suspected_count" | "age";
  sortDir: "asc" | "desc";
}): Promise<StaffPatientListResponse> {
  const { data } = await apiClient.get<StaffPatientListResponse>("/v1/staff/patients", {
    params: {
      months: params.months,
      age_min: params.ageMin,
      age_max: params.ageMax,
      query: params.query,
      infection_status: params.infectionStatus,
      is_active_filter: params.isActiveFilter ?? "all",
      created_from: params.createdFrom,
      created_to: params.createdTo,
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

export async function createStaffPatient(payload: StaffPatientCreatePayload): Promise<StaffPatientCreateResponse> {
  const { data } = await apiClient.post<StaffPatientCreateResponse>("/v1/staff/patients", payload);
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

export async function rejectAllPendingBindings(): Promise<{ rejected_count: number }> {
  const { data } = await apiClient.post<{ rejected_count: number }>("/v1/staff/pending-bindings/reject-all");
  return data;
}

export async function linkPendingBinding(pendingId: number, patientId: number): Promise<void> {
  await apiClient.post(`/v1/staff/pending-bindings/${pendingId}/link`, { patient_id: patientId });
}

export async function createPatientAndLinkPendingBinding(pendingId: number, payload: { full_name: string }): Promise<{ status: string; patient_id: number }> {
  const { data } = await apiClient.post<{ status: string; patient_id: number }>(
    `/v1/staff/pending-bindings/${pendingId}/create-patient`,
    payload
  );
  return data;
}

export async function updateStaffPatientStatus(
  patientId: number,
  payload: { is_active: boolean }
): Promise<StaffPatientSummary> {
  const { data } = await apiClient.post<StaffPatientSummary>(`/v1/staff/patients/${patientId}/status`, payload);
  return data;
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

export async function fetchAdminGenderDistribution(): Promise<AdminGenderDistributionResponse> {
  const { data } = await apiClient.get<AdminGenderDistributionResponse>("/v1/staff/admin/analytics/gender-distribution");
  return data;
}

export async function fetchAdminTodaySuspectedSummary(): Promise<AdminTodaySuspectedSummaryResponse> {
  const { data } = await apiClient.get<AdminTodaySuspectedSummaryResponse>("/v1/staff/admin/analytics/suspected-infections/today");
  return data;
}

export async function fetchAdminAgeHistogram(params?: {
  bucketSize?: number;
  includeInactive?: boolean;
}): Promise<AdminAgeHistogramResponse> {
  const { data } = await apiClient.get<AdminAgeHistogramResponse>("/v1/staff/admin/analytics/age-histogram", {
    params: {
      bucket_size: params?.bucketSize ?? 10,
      include_inactive: params?.includeInactive ?? false,
    },
  });
  return data;
}

export async function fetchAdminActiveUsersSeries(params?: {
  activeWindowDays?: number;
  lookbackDays?: number;
  interval?: "day" | "week";
}): Promise<AdminActiveUsersSeriesResponse> {
  const { data } = await apiClient.get<AdminActiveUsersSeriesResponse>("/v1/staff/admin/analytics/active-users", {
    params: {
      active_window_days: params?.activeWindowDays ?? 7,
      lookback_days: params?.lookbackDays ?? 30,
      interval: params?.interval ?? "day",
    },
  });
  return data;
}

export async function fetchAdminDailySuspectedSeries(params?: {
  lookbackDays?: number;
}): Promise<AdminDailySuspectedSeriesResponse> {
  const { data } = await apiClient.get<AdminDailySuspectedSeriesResponse>(
    "/v1/staff/admin/analytics/daily-suspected-series",
    {
      params: {
        lookback_days: params?.lookbackDays ?? 30,
      },
    }
  );
  return data;
}

export async function fetchAdminUsers(params?: {
  query?: string;
  role?: "patient" | "staff" | "admin";
  isActive?: boolean;
  createdFrom?: string;
  createdTo?: string;
}): Promise<AdminIdentityItem[]> {
  const { data } = await apiClient.get<{ items: AdminIdentityItem[] }>("/v1/staff/admin/users", {
    params: {
      query: params?.query,
      role: params?.role,
      is_active: params?.isActive,
      created_from: params?.createdFrom,
      created_to: params?.createdTo,
    },
  });
  return data.items;
}

export async function updateAdminUserRole(
  identityId: number,
  payload: { role: "patient" | "staff" | "admin"; reason?: string }
): Promise<AdminIdentityItem> {
  const { data } = await apiClient.post<AdminIdentityItem>(`/v1/staff/admin/users/${identityId}/role`, payload);
  return data;
}

export async function updateAdminUserStatus(
  identityId: number,
  payload: { is_active: boolean; reason?: string }
): Promise<AdminIdentityItem> {
  const { data } = await apiClient.post<AdminIdentityItem>(`/v1/staff/admin/users/${identityId}/status`, payload);
  return data;
}

export async function previewDeleteInactiveAdminUsers(identityIds: number[]): Promise<AdminInactiveIdentityDeletePreview> {
  const { data } = await apiClient.post<AdminInactiveIdentityDeletePreview>("/v1/staff/admin/users/delete/preview", {
    identity_ids: identityIds,
  });
  return data;
}

export async function deleteInactiveAdminUsers(identityIds: number[]): Promise<AdminInactiveIdentityDeleteResult> {
  const { data } = await apiClient.post<AdminInactiveIdentityDeleteResult>("/v1/staff/admin/users/delete", {
    identity_ids: identityIds,
  });
  return data;
}

export async function fetchAdminAccessRequests(params?: {
  status?: "pending" | "approved" | "rejected";
}): Promise<AdminAccessRequestItem[]> {
  const { data } = await apiClient.get<{ items: AdminAccessRequestItem[] }>("/v1/staff/admin/access-requests", {
    params: { status: params?.status },
  });
  return data.items;
}

export async function approveAdminAccessRequest(
  requestId: number,
  payload: { role: "staff" | "admin"; reason?: string }
): Promise<AdminAccessRequestItem> {
  const { data } = await apiClient.post<AdminAccessRequestItem>(
    `/v1/staff/admin/access-requests/${requestId}/approve`,
    payload
  );
  return data;
}

export async function rejectAdminAccessRequest(
  requestId: number,
  payload: { reason: string }
): Promise<AdminAccessRequestItem> {
  const { data } = await apiClient.post<AdminAccessRequestItem>(
    `/v1/staff/admin/access-requests/${requestId}/reject`,
    payload
  );
  return data;
}

export async function fetchAdminAssignments(): Promise<AdminPatientAssignmentItem[]> {
  const { data } = await apiClient.get<{ items: AdminPatientAssignmentItem[] }>("/v1/staff/admin/assignments");
  return data.items;
}

export async function upsertAdminAssignment(payload: {
  patient_id: number;
  staff_identity_id: number;
}): Promise<AdminPatientAssignmentUpsertResponse> {
  const { data } = await apiClient.post<AdminPatientAssignmentUpsertResponse>("/v1/staff/admin/assignments", payload);
  return data;
}

export async function bulkUpsertAdminAssignments(payload: {
  assignments: Array<{ patient_id: number; staff_identity_id: number }>;
}): Promise<AdminPatientAssignmentBulkResponse> {
  const { data } = await apiClient.post<AdminPatientAssignmentBulkResponse>("/v1/staff/admin/assignments/bulk", payload);
  return data;
}

export async function previewDeleteInactivePatients(patientIds: number[]): Promise<StaffInactivePatientDeletePreview> {
  const { data } = await apiClient.post<StaffInactivePatientDeletePreview>("/v1/staff/patients/delete/preview", {
    patient_ids: patientIds,
  });
  return data;
}

export async function deleteInactivePatients(patientIds: number[]): Promise<StaffInactivePatientDeleteResult> {
  const { data } = await apiClient.post<StaffInactivePatientDeleteResult>("/v1/staff/patients/delete", {
    patient_ids: patientIds,
  });
  return data;
}
