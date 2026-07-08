import { apiClient } from "@/lib/api/client";

export type IdentityStatus = "matched" | "pending" | "unbound";
export type HealthcareAccessStatus = "none" | "pending" | "approved" | "rejected";
export type AuthBootstrapNextStep =
  | "role_select"
  | "onboarding_patient"
  | "onboarding_admin"
  | "patient_app"
  | "app_selection";
export type AuthBootstrapRole = "patient" | "staff" | "admin" | null;
export type AllowedApp = "patient" | "admin";

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

export type AuthBootstrapResponse = {
  line_user_id: string;
  identity_exists: boolean;
  role: AuthBootstrapRole;
  is_active: boolean;
  patient_binding_status: IdentityStatus;
  healthcare_access_status: HealthcareAccessStatus;
  next_step: AuthBootstrapNextStep;
  allowed_apps: AllowedApp[];
};

type BindIdentityPayload = {
  line_id_token: string;
  case_number: string;
  birth_date: string;
};

export async function fetchIdentityStatus(lineIdToken: string): Promise<IdentityStatusResponse> {
  const { data } = await apiClient.post<IdentityStatusResponse>("/v1/identity/bind/status", {
    line_id_token: lineIdToken,
  });
  return data;
}

export async function fetchAuthBootstrap(lineIdToken: string): Promise<AuthBootstrapResponse> {
  const { data } = await apiClient.post<AuthBootstrapResponse>("/v1/auth/bootstrap", {
    line_id_token: lineIdToken,
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
  line_id_token: string;
}): Promise<{ request_id: number; status: "pending" | "approved" | "rejected" }> {
  const { data } = await apiClient.post<{ request_id: number; status: "pending" | "approved" | "rejected" }>(
    "/v1/identity/healthcare-access-request",
    payload
  );
  return data;
}

export async function fetchHealthcareAccessRequestStatus(
  lineIdToken: string
): Promise<HealthcareAccessRequestStatusResponse> {
  const { data } = await apiClient.post<HealthcareAccessRequestStatusResponse>(
    "/v1/identity/healthcare-access-request/status",
    {
      line_id_token: lineIdToken,
    }
  );
  return data;
}
