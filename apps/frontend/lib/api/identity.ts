import { apiClient } from "@/lib/api/client";

export type IdentityStatus = "matched" | "pending" | "unbound";

export type IdentityStatusResponse = {
  status: IdentityStatus;
  patient_id: number | null;
  can_upload: boolean;
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
