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
