import axios, { AxiosError } from "axios";

export function resolveApiBaseUrl(): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") {
    if (envBaseUrl?.startsWith("https://")) {
      return envBaseUrl;
    }
    return "/api";
  }

  if (typeof window !== "undefined") {
    const sameHostUrl = new URL(window.location.origin);
    sameHostUrl.port = "8000";
    return sameHostUrl.origin;
  }

  return envBaseUrl ?? "http://localhost:8000";
}

export const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 15000,
});

export function getApiErrorDetail(error: unknown): string | null {
  if (!(error instanceof AxiosError)) {
    return null;
  }
  if (error.response) {
    const payload = error.response.data as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof (payload as { detail?: unknown }).detail === "string"
    ) {
      return (payload as { detail: string }).detail;
    }

    if (typeof payload === "string" && payload.trim()) {
      return payload.slice(0, 300);
    }

    return `HTTP ${error.response.status}`;
  }
  return null;
}

export function getReadableApiError(error: unknown): string {
  if (!(error instanceof AxiosError)) {
    return "無法完成分析請求，請稍後再試。";
  }
  const detail = getApiErrorDetail(error);
  if (detail) {
    return detail;
  }
  const message = error.message.toLowerCase();
  if (
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("load failed")
  ) {
    return `無法連線到分析服務（${resolveApiBaseUrl()}）。請確認後端是否啟動、CORS 是否允許目前網域、以及手機端是否使用 HTTPS。`;
  }

  return error.message ? `送出分析失敗：${error.message}` : "無法完成分析請求，請稍後再試。";
}
