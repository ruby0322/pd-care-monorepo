"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { bindIdentity, fetchAuthBootstrap, fetchIdentityStatus, IdentityStatus } from "@/lib/api/identity";
import { getApiErrorDetail } from "@/lib/api/client";
import { buildLoginPath, getLiffLoginProof } from "@/lib/auth/liff";
import { PATIENT_ONBOARDING_INTENT } from "@/lib/auth/patient-onboarding-intent";

type LiffProfileState = {
  displayName: string;
};

function PatientOnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<LiffProfileState | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [caseNumber, setCaseNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patientIntent = searchParams.get("intent");
  const fromAppSelectionPatientIntent = patientIntent === PATIENT_ONBOARDING_INTENT;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        const proof = await getLiffLoginProof();
        if (cancelled) {
          return;
        }
        setProfile({ displayName: proof.profile.displayName });

        const bootstrap = await fetchAuthBootstrap(proof.idToken);
        if (cancelled) {
          return;
        }
        if (
          bootstrap.next_step === "app_selection" &&
          !(fromAppSelectionPatientIntent && (bootstrap.role === "staff" || bootstrap.role === "admin"))
        ) {
          router.replace(buildLoginPath("/apps"));
          return;
        }
        if (bootstrap.next_step === "patient_app") {
          router.replace(buildLoginPath("/patient"));
          return;
        }
        if (bootstrap.next_step === "onboarding_admin") {
          router.replace("/onboarding/admin");
          return;
        }

        const bindStatus = await fetchIdentityStatus(proof.idToken);
        if (!cancelled) {
          setStatus(bindStatus.status);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorDetail(err) ?? "無法初始化身分綁定流程，請稍後再試。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [fromAppSelectionPatientIntent, router]);

  async function submitBinding() {
    if (!caseNumber.trim() || !birthDate) {
      setError("請輸入病歷號與生日。");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const proof = await getLiffLoginProof();
      const bindResult = await bindIdentity({
        line_id_token: proof.idToken,
        case_number: caseNumber.trim(),
        birth_date: birthDate,
      });
      setStatus(bindResult.status);
      const bootstrap = await fetchAuthBootstrap(proof.idToken);
      if (bootstrap.next_step === "patient_app") {
        router.replace(buildLoginPath("/patient"));
      }
    } catch (err) {
      setError(getApiErrorDetail(err) ?? "綁定失敗，請稍後再試或聯絡護理師。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-white flex items-center justify-center px-6">
        <p className="text-sm text-zinc-500">正在初始化病患 onboarding...</p>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 py-14">
        <h1 className="text-lg font-semibold text-zinc-900">病患註冊審核中</h1>
        <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
          已收到您的身分綁定申請，護理團隊確認後即可開始上傳出口影像。在核可前，系統暫時無法開啟拍攝流程。
        </p>
        <p className="mt-5 text-xs text-zinc-400">LINE 顯示名稱：{profile?.displayName ?? "未知"}</p>
        <Link
          href="/"
          className="mt-auto flex items-center justify-center w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
        >
          返回首頁
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 py-14">
      <h1 className="text-lg font-semibold text-zinc-900">病患身分註冊</h1>
      <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
        請輸入病歷號與生日完成臨床身分驗證。若資料尚未建檔，系統會送出待審核申請，待護理師完成綁定後才能上傳影像。
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="case-number" className="block text-xs font-medium text-zinc-500 mb-1">
            病歷號
          </label>
          <input
            id="case-number"
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            placeholder="例如 P123456"
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
        <div>
          <label htmlFor="birth-date" className="block text-xs font-medium text-zinc-500 mb-1">
            生日
          </label>
          <input
            id="birth-date"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={submitBinding}
        disabled={submitting}
        className="mt-6 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-40"
      >
        {submitting ? "送出中..." : "送出綁定申請"}
      </button>

      <Link
        href="/"
        className="mt-3 flex items-center justify-center w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
      >
        取消並返回首頁
      </Link>
    </div>
  );
}

export default function PatientOnboardingPage() {
  return (
    <Suspense>
      <PatientOnboardingPageInner />
    </Suspense>
  );
}
