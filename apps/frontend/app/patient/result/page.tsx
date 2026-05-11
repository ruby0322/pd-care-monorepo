"use client";

import { apiClient, getApiErrorDetail, getReadableApiError } from "@/lib/api/client";
import { getPatientUploadResult } from "@/lib/api/predict";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { getPatientSession, setPatientSession } from "@/lib/auth/patient-session";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, AlertTriangle, XCircle, Home, RotateCcw, CalendarDays, ShieldAlert } from "lucide-react";
import clsx from "clsx";

type ResultState = "normal" | "suspected" | "rejected" | "technical_error";

function ResultPageInner() {
  const searchParams = useSearchParams();
  const queryResult = searchParams.get("result");
  const pain = searchParams.get("pain") === "true";
  const discharge = searchParams.get("discharge") === "true";
  const cloudyDialysate = searchParams.get("cloudyDialysate") === "true";
  const rejectionReason = searchParams.get("reason")?.trim() || null;
  const uploadIdRaw = searchParams.get("uploadId");
  const aiResultIdRaw = searchParams.get("aiResultId");
  const uploadId = uploadIdRaw && !Number.isNaN(Number(uploadIdRaw)) ? Number(uploadIdRaw) : null;
  const aiResultId = aiResultIdRaw && !Number.isNaN(Number(aiResultIdRaw)) ? Number(aiResultIdRaw) : null;
  const confidenceRaw = searchParams.get("confidence");
  const queryConfidence =
    confidenceRaw && !Number.isNaN(Number(confidenceRaw))
      ? Math.max(0, Math.min(100, Number(confidenceRaw)))
      : null;
  const hasDurableIds = uploadId !== null || aiResultId !== null;
  const [hydratedResult, setHydratedResult] = useState<ResultState | null>(null);
  const [hydratedErrorReason, setHydratedErrorReason] = useState<string | null>(null);
  const [hydratedConfidence, setHydratedConfidence] = useState<number | null>(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrateError, setHydrateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasDurableIds) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        setIsHydrating(true);
        setHydrateError(null);
        if (!getPatientSession()) {
          const { idToken } = await getLiffLoginProof();
          const response = await apiClient.post<{
            access_token: string;
            expires_in: number;
            role: "patient" | "staff" | "admin";
            line_user_id: string;
          }>("/v1/auth/login", {
            line_id_token: idToken,
          });
          const payload = response.data;
          if (payload.role !== "patient" && payload.role !== "admin") {
            throw new Error("目前 LINE 帳號角色無法讀取病患端判讀結果。");
          }
          setPatientSession({
            accessToken: payload.access_token,
            expiresAt: Date.now() + payload.expires_in * 1000,
            role: payload.role,
            lineUserId: payload.line_user_id,
          });
        }
        const payload = await getPatientUploadResult({
          uploadId: uploadId ?? undefined,
          aiResultId: aiResultId ?? undefined,
        });

        if (cancelled) {
          return;
        }

        setHydratedResult(payload.screening_result);
        setHydratedErrorReason(payload.error_reason);
        setHydratedConfidence(
          payload.probability === null
            ? null
            : Math.max(0, Math.min(100, Math.round(payload.probability * 100)))
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        const detail = getApiErrorDetail(error);
        setHydrateError(detail ?? getReadableApiError(error));
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiResultId, hasDurableIds, uploadId]);

  const result = useMemo<ResultState>(() => {
    if (hydratedResult) {
      return hydratedResult;
    }
    if (queryResult === "normal" || queryResult === "suspected" || queryResult === "rejected") {
      return queryResult;
    }
    return "technical_error";
  }, [hydratedResult, queryResult]);

  const effectiveConfidence = hydratedConfidence ?? queryConfidence;
  const effectiveReason = hydratedErrorReason ?? rejectionReason;

  const now = new Date().toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const config = {
    normal: {
      icon: CheckCircle,
      color: "emerald",
      title: "出口狀態正常",
      subtitle: "系統未偵測到明顯感染風險",
      message: "系統判讀結果：出口狀態正常，建議維持隔日換藥一次。",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      iconColor: "text-emerald-500",
      titleColor: "text-emerald-700",
    },
    suspected: {
      icon: AlertTriangle,
      color: "red",
      title: "疑似感染",
      subtitle: "系統偵測到疑似感染風險",
      message:
        "系統判讀結果：疑似感染，建議盡速就醫接受處置。延遲治療可能導致病情惡化。已通知照護團隊儀表板，護理人員將進一步檢視。",
      bg: "bg-red-50",
      border: "border-red-100",
      iconColor: "text-red-500",
      titleColor: "text-red-700",
    },
    rejected: {
      icon: XCircle,
      color: "amber",
      title: "影像不符合判讀條件",
      subtitle: "請重新拍攝後再送出",
      message: "本次照片無法完成判讀，可能是光線不足、對焦不清或出口位置未完整入鏡。",
      bg: "bg-amber-50",
      border: "border-amber-100",
      iconColor: "text-amber-500",
      titleColor: "text-amber-700",
    },
    technical_error: {
      icon: ShieldAlert,
      color: "zinc",
      title: "系統暫時無法完成判讀",
      subtitle: "請稍後再試或重新上傳",
      message: "本次分析過程發生技術性問題，系統未產生可用結果。",
      bg: "bg-zinc-100",
      border: "border-zinc-200",
      iconColor: "text-zinc-500",
      titleColor: "text-zinc-700",
    },
  };

  const currentConfig = config[result];
  const { icon: Icon } = currentConfig;

  const activeSymptoms = [
    pain && "疼痛",
    discharge && "分泌物",
    cloudyDialysate && "透析液混濁",
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-base font-semibold text-zinc-900">分析結果</h1>
        <p className="text-xs text-zinc-400 mt-0.5">{now}</p>
      </header>

      <main className="flex-1 flex flex-col px-5 pb-8 gap-5">
        <div className={clsx("flex flex-col items-center gap-3 px-6 py-8 rounded-2xl border", currentConfig.bg, currentConfig.border)}>
          <Icon className={clsx("w-12 h-12", currentConfig.iconColor)} strokeWidth={1.5} />
          <div className="text-center">
            <h2 className={clsx("text-xl font-semibold", currentConfig.titleColor)}>
              {currentConfig.title}
            </h2>
            <p className="text-sm text-zinc-500 mt-1">{currentConfig.subtitle}</p>
          </div>
        </div>

        {effectiveConfidence !== null && result !== "rejected" && result !== "technical_error" && (
          <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">AI 信心分數</p>
            <p className="text-lg font-semibold text-zinc-900">{effectiveConfidence}%</p>
          </div>
        )}

        {(uploadId || aiResultId) && (
          <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">紀錄編號</p>
            <p className="text-sm text-zinc-700">
              {uploadId ? `上傳 #${uploadId}` : "上傳編號未提供"}
              {aiResultId ? ` / 判讀 #${aiResultId}` : ""}
            </p>
          </div>
        )}

        {isHydrating && (
          <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
            <p className="text-sm text-zinc-600">正在同步最新判讀紀錄...</p>
          </div>
        )}

        <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
          <p className="text-sm text-zinc-700 leading-relaxed">
            {result === "rejected" && effectiveReason
              ? `影像未通過原因：${effectiveReason}`
              : result === "technical_error" && (effectiveReason || hydrateError)
                ? `技術性問題：${effectiveReason ?? hydrateError}`
              : currentConfig.message}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">本次症狀紀錄</h3>
          {activeSymptoms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeSymptoms.map((s) => (
                <span key={s as string} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-600 text-xs font-medium">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-zinc-400">無症狀回報</span>
          )}
        </div>

        {result === "normal" && (
          <div className="px-5 py-4 rounded-2xl bg-emerald-50 border border-emerald-100">
            <p className="text-sm font-medium text-emerald-700">附加衛教影片及素材</p>
            <div className="mt-2 flex flex-col gap-2">
              <a
                href="https://youtu.be/3aADSNm-9B0?si=lGOmXhqPxJgL11Gd"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-emerald-700 underline underline-offset-2"
              >
                導管出口換藥影片
              </a>
              <a
                href="https://youtu.be/KOMvyUt0ap4?si=O4IM6e2LONrNGhYn"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-emerald-700 underline underline-offset-2"
              >
                導管出口照護影片
              </a>
            </div>
          </div>
        )}

        {result === "suspected" && (
          <div className="flex flex-col gap-2 px-4 py-4 rounded-2xl bg-red-600 text-white">
            <p className="text-xs font-medium text-red-100">照護團隊提醒</p>
            <p className="text-sm">本次異常紀錄已同步到照護團隊儀表板，護理人員會進一步檢視。</p>
            <a
              href="https://reg.ntuh.gov.tw/WebReg"
              target="_blank"
              rel="noreferrer"
              className="text-sm underline underline-offset-2 text-white"
            >
              附加網路掛號連結：臺大醫院網路掛號
            </a>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-4">
          {result === "rejected" || result === "technical_error" ? (
            <Link
              href="/patient/capture"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              重新拍攝
            </Link>
          ) : null}
          <Link
            href="/patient"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            <CalendarDays className="w-4 h-4" strokeWidth={1.5} />
            回到追蹤日曆
          </Link>
          <Link
            href="/patient"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
          >
            <Home className="w-4 h-4" strokeWidth={1.5} />
            返回追蹤首頁
          </Link>
        </div>

        <p className="text-center text-xs text-zinc-500 pb-2">
          本系統僅供輔助提醒，不構成醫療診斷
        </p>
      </main>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense>
      <ResultPageInner />
    </Suspense>
  );
}
