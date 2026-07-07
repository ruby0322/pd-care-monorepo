"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import {
  createHealthcareAccessRequest,
  fetchHealthcareAccessRequestStatus,
  HealthcareAccessStatus,
} from "@/lib/api/identity";
import { getApiErrorDetail } from "@/lib/api/client";
import { buildLoginPath, getLiffLoginProof, readSafeNextPath } from "@/lib/auth/liff";

function NoPermissionPageInner() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => readSafeNextPath(searchParams.get("next")) ?? "/admin", [searchParams]);
  const [status, setStatus] = useState<HealthcareAccessStatus>("none");
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        setIsLoadingStatus(true);
        const { idToken } = await getLiffLoginProof();
        const response = await fetchHealthcareAccessRequestStatus(idToken);
        if (cancelled) {
          return;
        }
        setStatus(response.status);
        setRejectReason(response.reject_reason);
        if (response.status === "pending") {
          setSuccessMessage("已送出「我是醫護人員」權限申請，請等待管理員審核。");
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(getApiErrorDetail(error) ?? "無法取得權限申請狀態，請稍後再試。");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRequestHealthcareAccess() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const { idToken } = await getLiffLoginProof();
      const result = await createHealthcareAccessRequest({ line_id_token: idToken });
      if (result.status === "pending") {
        setStatus("pending");
        setRejectReason(null);
        setSuccessMessage("已送出「我是醫護人員」權限申請，請等待管理員審核。");
      } else {
        setStatus(result.status);
        setSuccessMessage("權限申請已送出。");
      }
    } catch (error) {
      setErrorMessage(getApiErrorDetail(error) ?? "送出權限申請失敗，請稍後再試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const requestDisabled = isLoadingStatus || isSubmitting || status === "pending";

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">此帳號尚無護理師後台權限</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            若您是醫護人員，可在此送出權限申請，待管理員審核後再登入護理師後台。
          </p>
        </div>

        {status === "pending" ? (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">目前狀態：審核中</div>
        ) : null}

        {status === "rejected" ? (
          <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
            申請結果：已退回{rejectReason ? `（原因：${rejectReason}）` : "。"}
          </div>
        ) : null}

        {errorMessage ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{errorMessage}</p> : null}
        {successMessage ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <button
          type="button"
          onClick={handleRequestHealthcareAccess}
          disabled={requestDisabled}
          className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "送出申請中..." : "我是醫護人員，請求權限"}
        </button>

        <div className="flex items-center justify-between text-xs text-zinc-500">
          <Link href="/" className="underline underline-offset-4 hover:text-zinc-800">
            返回首頁
          </Link>
          <Link href={buildLoginPath(nextPath)} className="underline underline-offset-4 hover:text-zinc-800">
            重新登入
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function NoPermissionPage() {
  return (
    <Suspense>
      <NoPermissionPageInner />
    </Suspense>
  );
}
