import { apiClient } from "@/lib/api/client";

export type IdentityStatus = "matched" | "pending" | "unbound";
export type HealthcareAccessStatus = "none" | "pending" | "approved" | "rejected";

export type IdentityStatusResponse = {
  status: IdentityStatus;
  patient_id: number | null;
  can_upload: boolean;
};

export type PatientProfileResponse = {
  status: IdentityStatus;
  can_upload: boolean;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  patient_id: number | null;
  full_name: string | null;
  case_number: string | null;
  birth_date: string | null;
};

export type HealthcareAccessRequestStatusResponse = {
  status: HealthcareAccessStatus;
  reject_reason: string | null;
  decision_role: "patient" | "staff" | "admin" | null;
};

type BindIdentityPayload = {
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  case_number: string;
  birth_date: string;
};

export async function fetchIdentityStatus(lineUserId: string): Promise<IdentityStatusResponse> {
  const { data } = await apiClient.get<IdentityStatusResponse>("/v1/identity/bind/status", {
    params: { line_user_id: lineUserId },
  });
  return data;
}

export async function bindIdentity(payload: BindIdentityPayload): Promise<IdentityStatusResponse> {
  const { data } = await apiClient.post<IdentityStatusResponse>("/v1/identity/bind", payload);
  return data;
}

export async function fetchPatientProfile(): Promise<PatientProfileResponse> {
  const { data } = await apiClient.get<PatientProfileResponse>("/v1/patient/profile");
  return data;
}

export async function createHealthcareAccessRequest(payload: {
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
}): Promise<{ request_id: number; status: "pending" | "approved" | "rejected" }> {
  const { data } = await apiClient.post<{ request_id: number; status: "pending" | "approved" | "rejected" }>(
    "/v1/identity/healthcare-access-request",
    payload
  );
  return data;
}

export async function fetchHealthcareAccessRequestStatus(
  lineUserId: string
): Promise<HealthcareAccessRequestStatusResponse> {
  const { data } = await apiClient.get<HealthcareAccessRequestStatusResponse>(
    "/v1/identity/healthcare-access-request/status",
    {
      params: { line_user_id: lineUserId },
    }
  );
  return data;
}
