"use client";

import { AxiosError } from "axios";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { apiClient, getApiErrorCode, getApiErrorDetail } from "@/lib/api/client";
import { fetchAuthBootstrap } from "@/lib/api/identity";
import { isAdminIntent, isPatientRoute, resolveBootstrapDestination, resolveRoleSelectDestination } from "@/lib/auth/bootstrap-routing";
import { getLiffLoginProof, isLiffDevBypassActive, readSafeNextPath } from "@/lib/auth/liff";
import { setPatientSession } from "@/lib/auth/patient-session";
import { setActiveApp } from "@/lib/auth/principal-session";
import { setStaffSession } from "@/lib/auth/staff-session";

type LoginResponse = {
  access_token: string;
  expires_in: number;
  role: "patient" | "staff" | "admin";
  line_user_id: string;
};

function getLoginErrorMessage(error: unknown): string {
  const code = getApiErrorCode(error);
  const detail = getApiErrorDetail(error);
  if (code === "ONBOARDING_REQUIRED") {
    return "此 LINE 帳號仍在 onboarding 流程中，請先完成註冊或審核。";
  }
  if (code === "BOOTSTRAP_UNAVAILABLE") {
    return detail ?? "登入服務目前不可用，請稍後再試或聯絡系統管理員。";
  }
  if (code === "IDENTITY_NOT_FOUND" || code === "ROLE_NOT_ALLOWED" || code === "IDENTITY_INACTIVE") {
    return "此 LINE 帳號尚未開通對應權限，請聯絡系統管理員。";
  }
  if (detail === "Not Found") {
    return "登入服務目前不可用，請稍後再試或聯絡系統管理員。";
  }
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 403) {
      return "此 LINE 帳號沒有系統權限，請聯絡系統管理員開通。";
    }
    if (status === 404 || status === 503) {
      return "登入服務目前不可用，請稍後再試或聯絡系統管理員。";
    }
    if (status === 400) {
      return "LINE 登入憑證驗證失敗，請重新登入 LINE 後再試。";
    }
  }
  return detail ?? "登入失敗，請稍後再試。";
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nextPath = useMemo(() => readSafeNextPath(searchParams.get("next")), [searchParams]);

  const completeLogin = useCallback(async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { idToken } = await getLiffLoginProof();
      const bootstrap = await fetchAuthBootstrap(idToken);
      const roleSelectDestination = resolveRoleSelectDestination(nextPath);
      const appSelectionDestination = nextPath && isAdminIntent(nextPath) ? nextPath : "/apps";
      const patientAppDestination = nextPath && isPatientRoute(nextPath) ? nextPath : "/patient";

      if (
        bootstrap.next_step === "role_select" ||
        bootstrap.next_step === "onboarding_patient" ||
        bootstrap.next_step === "onboarding_admin"
      ) {
        router.replace(
          resolveBootstrapDestination(bootstrap.next_step, {
            roleSelectDestination,
          })
        );
        router.refresh();
        return;
      }

      const loginResponse = await apiClient.post<LoginResponse>("/v1/auth/login", {
        line_id_token: idToken,
      });
      const payload = loginResponse.data;
      const expiresAt = Date.now() + payload.expires_in * 1000;

      if (bootstrap.next_step === "app_selection") {
        const staffRole: "staff" | "admin" = payload.role === "admin" ? "admin" : "staff";
        const session = {
          accessToken: payload.access_token,
          expiresAt,
          role: staffRole,
          lineUserId: payload.line_user_id,
        };
        setStaffSession(session);
        if (bootstrap.allowed_apps.includes("patient")) {
          setPatientSession(session);
        }
        setActiveApp(null);
        const destination = resolveBootstrapDestination(bootstrap.next_step, {
          appSelectionDestination,
        });
        router.replace(destination);
        router.refresh();
        return;
      }

      if (bootstrap.next_step === "patient_app") {
        setPatientSession({
          accessToken: payload.access_token,
          expiresAt,
          role: "patient",
          lineUserId: payload.line_user_id,
        });
        setActiveApp("patient");
        const destination = resolveBootstrapDestination(bootstrap.next_step, {
          patientAppDestination,
        });
        router.replace(destination);
        router.refresh();
        return;
      }

      router.replace("/");
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

        {errorMessage ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p> : null}

        {isLiffDevBypassActive() ? (
          <p className="text-center text-xs text-zinc-500">
            <Link href="/dev/personas" className="underline underline-offset-4 hover:text-zinc-800">
              切換測試身分
            </Link>
          </p>
        ) : null}

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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
