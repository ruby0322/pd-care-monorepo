import axios, { AxiosError } from "axios";

import { getStaffAccessToken } from "@/lib/auth/staff-session";

export function resolveApiBaseUrl(): string {
  const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") {
    if (!envBaseUrl) {
      return "/api";
    }
    // Production supports either:
    // 1) same-origin rewrite path (recommended): /api
    // 2) fully-qualified backend URL: https://api.example.com
    if (envBaseUrl.startsWith("/")) {
      return envBaseUrl;
    }
    if (envBaseUrl.startsWith("https://")) {
      return envBaseUrl;
    }
    return "/api";
  }

  // Dev: honor NEXT_PUBLIC_API_BASE_URL (must run before the window branch; previously it was never used in-browser).
  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (typeof window !== "undefined") {
    const sameHostUrl = new URL(window.location.origin);
    sameHostUrl.port = "8000";
    // Prefer IPv4: some stacks resolve localhost → ::1 while uvicorn listens on IPv4 only.
    if (sameHostUrl.hostname === "localhost") {
      sameHostUrl.hostname = "127.0.0.1";
    }
    return sameHostUrl.origin;
  }

  return "http://127.0.0.1:8000";
}

export const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  if (!config.url || config.headers?.Authorization) {
    return config;
  }
  if (!config.url.startsWith("/v1/staff")) {
    return config;
  }
  const token = getStaffAccessToken();
  if (!token) {
    return config;
  }
  config.headers.Authorization = `Bearer ${token}`;
  return config;
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
