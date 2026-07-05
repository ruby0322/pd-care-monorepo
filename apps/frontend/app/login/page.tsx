"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AxiosError } from "axios";

import { apiClient, getApiErrorDetail } from "@/lib/api/client";
import { createHealthcareAccessRequest, fetchIdentityStatus } from "@/lib/api/identity";
import { getLiffLoginProof, readSafeNextPath } from "@/lib/auth/liff";
import { setPatientSession } from "@/lib/auth/patient-session";
import { setStaffSession } from "@/lib/auth/staff-session";

type LoginResponse = {
  access_token: string;
  expires_in: number;
  role: "patient" | "staff" | "admin";
  line_user_id: string;
};

function getLoginErrorMessage(error: unknown): string {
  const detail = getApiErrorDetail(error);
  if (detail?.includes("尚未開通") || detail?.includes("角色無法登入")) {
    return "此 LINE 帳號尚未開通對應權限，請聯絡系統管理員。";
  }
  if (detail === "Not Found") {
    return "登入服務目前不可用（路由不存在），請稍後再試或聯絡系統管理員。";
  }
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 403) {
      return "此 LINE 帳號沒有系統權限，請聯絡系統管理員開通。";
    }
    if (status === 404) {
      return "登入服務目前不可用（404），請稍後再試或聯絡系統管理員。";
    }
    if (status === 400) {
      return "LINE 登入憑證驗證失敗，請重新登入 LINE 後再試。";
    }
  }
  return detail ?? "登入失敗，請稍後再試。";
}

function resolveNextPath(rawNext: string | null): string | null {
  return readSafeNextPath(rawNext);
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const nextPath = useMemo(() => resolveNextPath(searchParams.get("next")), [searchParams]);

  const completeLogin = useCallback(async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const { idToken } = await getLiffLoginProof();
      const response = await apiClient.post<LoginResponse>("/v1/auth/login", {
        line_id_token: idToken,
      });
      const payload = response.data;
      const expiresAt = Date.now() + payload.expires_in * 1000;

      if (payload.role === "staff" || payload.role === "admin") {
        setStaffSession({
          accessToken: payload.access_token,
          expiresAt,
          role: payload.role,
          lineUserId: payload.line_user_id,
        });
        router.replace(nextPath ?? "/admin");
        router.refresh();
        return;
      }

      const bindStatus = await fetchIdentityStatus(idToken);
      if (bindStatus.status === "matched") {
        setPatientSession({
          accessToken: payload.access_token,
          expiresAt,
          role: payload.role,
          lineUserId: payload.line_user_id,
        });
      }

      const fallbackPath = "/patient";
      const destination = nextPath?.startsWith("/admin") ? fallbackPath : (nextPath ?? fallbackPath);
      router.replace(destination);
      router.refresh();
    } catch (error) {
      setErrorMessage(getLoginErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [nextPath, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void completeLogin();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [completeLogin]);

  async function handleRequestHealthcareAccess() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsRequestingAccess(true);
    try {
      const { idToken } = await getLiffLoginProof();
      const result = await createHealthcareAccessRequest({
        line_id_token: idToken,
      });
      if (result.status === "pending") {
        setSuccessMessage("已送出「我是醫護人員」權限申請，請等待管理員審核。");
      } else {
        setSuccessMessage("權限申請已送出。");
      }
    } catch (error) {
      setErrorMessage(getApiErrorDetail(error) ?? "送出權限申請失敗，請稍後再試。");
    } finally {
      setIsRequestingAccess(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900">
            <Activity className="h-5 w-5 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">LINE 登入</h1>
            <p className="text-xs text-zinc-500">正在驗證您的身分，若失敗可手動重試</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void completeLogin()}
          disabled={isSubmitting}
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? "登入中..." : "使用 LINE 登入"}
        </button>

        <button
          type="button"
          onClick={handleRequestHealthcareAccess}
          disabled={isRequestingAccess || isSubmitting}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRequestingAccess ? "送出申請中..." : "我是醫護人員，請求權限"}
        </button>

        {errorMessage ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p> : null}
        {successMessage ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <div className="flex items-center justify-center gap-4 text-xs text-zinc-500">
          <Link href="/privacy-policy" className="underline underline-offset-4 hover:text-zinc-800">
            隱私權政策
          </Link>
          <Link href="/terms-of-use" className="underline underline-offset-4 hover:text-zinc-800">
            使用條款
          </Link>
        </div>
      </div>
    </div>
  );
}
