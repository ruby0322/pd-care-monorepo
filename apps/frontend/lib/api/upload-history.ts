import { apiClient } from "@/lib/api/client";

export type UploadHistoryDay = {
  date: string;
  upload_count: number;
  has_suspected_risk: boolean;
};

export type UploadHistoryResponse = {
  status: "matched" | "pending" | "unbound";
  patient_id: number | null;
  can_upload: boolean;
  days: UploadHistoryDay[];
};

export async function fetchUploadHistory(): Promise<UploadHistoryResponse> {
  const { data } = await apiClient.get<UploadHistoryResponse>("/v1/patient/upload-history");
  return data;
}
