"use client";

import clsx from "clsx";
import { CalendarDays, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { getApiErrorDetail, getReadableApiError } from "@/lib/api/client";
import { getPatientUploadResult } from "@/lib/api/predict";
import { fetchPatientUploadDetail } from "@/lib/api/upload-history";
import { getPatientSession } from "@/lib/auth/patient-session";
import {
  activeSymptomLabels,
  highRiskSymptomAdvisorySentence,
  isSymptomElevatedFromNormal,
  symptomsFromApiFields,
  type ScreeningResult,
  type SymptomFlags,
} from "@/lib/symptoms";
import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

type ResultState = ScreeningResult;

const EDUCATION_MATERIALS = [
  { label: "導管出口換藥影片", href: "https://youtu.be/3aADSNm-9B0?si=lGOmXhqPxJgL11Gd" },
  { label: "導管出口照護影片", href: "https://youtu.be/KOMvyUt0ap4?si=O4IM6e2LONrNGhYn" },
] as const;

export function formatResultTimestamp(date: Date): string {
  return date
    .toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    // ICU may insert NBSP / narrow NBSP / other Zs separators; keep ASCII spaces only.
    .replace(/\p{Zs}/gu, " ");
}

function SignalDot({ tone }: { tone: "green" | "orange" | "amber" | "zinc" }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block h-2 w-2 shrink-0 rounded-sm",
        tone === "green" && "bg-emerald-500",
        tone === "orange" && "bg-orange-500",
        tone === "amber" && "bg-amber-500",
        tone === "zinc" && "bg-zinc-400"
      )}
    />
  );
}

function ResultPageInner() {
  const searchParams = useSearchParams();
  const queryResult = searchParams.get("result");
  const pain = searchParams.get("pain") === "true";
  const discharge = searchParams.get("discharge") === "true";
  const pus = searchParams.get("pus") === "true";
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
  const [hydratedSymptoms, setHydratedSymptoms] = useState<SymptomFlags | null>(null);
  const [hydratedCreatedAt, setHydratedCreatedAt] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ uploadId: number; url: string } | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);

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
          window.location.replace("/onboarding/patient");
          return;
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
        setHydratedSymptoms(
          symptomsFromApiFields({
            symptom_pain: payload.symptom_pain,
            symptom_discharge: payload.symptom_discharge,
            symptom_pus: payload.symptom_pus,
            symptom_cloudy_dialysate: payload.symptom_cloudy_dialysate,
          })
        );
        setHydratedCreatedAt(payload.created_at);
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

  useEffect(() => {
    let cancelled = false;
    if (uploadId === null) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        if (!getPatientSession()) {
          return;
        }
        const detail = await fetchPatientUploadDetail(uploadId);
        if (!cancelled) {
          setPreview({ uploadId, url: detail.image_url });
          setPreviewBroken(false);
        }
      } catch {
        // Keep page usable without a preview when detail fetch fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uploadId]);

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

  const symptomFlags: SymptomFlags = hydratedSymptoms ?? {
    pain,
    discharge,
    pus,
    cloudyDialysate,
  };
  const activeSymptoms = activeSymptomLabels(symptomFlags);
  const highRiskAdvisory = highRiskSymptomAdvisorySentence(symptomFlags);
  const elevatedFromNormal = isSymptomElevatedFromNormal(result, symptomFlags);
  const displayResult: ResultState = elevatedFromNormal ? "suspected" : result;
  const showEducation = displayResult === "normal" || displayResult === "suspected";
  const showModelConfidence =
    effectiveConfidence !== null && result !== "rejected" && result !== "technical_error";

  // Prefer durable upload created_at when hydrated; otherwise page-load time (query-only flows).
  const displayTimestamp = useClientSnapshot(() => {
    if (hydratedCreatedAt) {
      const parsed = new Date(hydratedCreatedAt);
      if (!Number.isNaN(parsed.getTime())) {
        return formatResultTimestamp(parsed);
      }
    }
    return formatResultTimestamp(new Date());
  }, "");

  const statusChip = (() => {
    if (elevatedFromNormal) {
      return {
        label: "疑似感染風險",
        className: "border-red-200 bg-red-50 text-red-700",
      };
    }
    if (result === "normal") {
      return {
        label: "判讀傷口正常",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }
    if (result === "suspected") {
      return {
        label: "疑似感染",
        className: "border-red-200 bg-red-50 text-red-700",
      };
    }
    if (result === "rejected") {
      return {
        label: "影像不符合判讀條件",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    }
    return {
      label: "系統暫時無法完成判讀",
      className: "border-zinc-200 bg-zinc-100 text-zinc-700",
    };
  })();

  const meaningCopy = (() => {
    if (elevatedFromNormal) {
      return "影像模型判讀正常，但您回報的症狀屬高風險，仍以症狀為準，建議盡速聯繫護理師並返院追蹤。";
    }
    if (result === "normal") {
      return "系統未偵測到明顯感染風險。建議維持隔日換藥一次，並持續依日曆追蹤出口狀況。";
    }
    if (result === "suspected") {
      return "系統偵測到疑似感染風險。建議盡速就醫接受處置。延遲治療可能導致病情惡化。已通知照護團隊儀表板，護理人員將進一步檢視。";
    }
    if (result === "rejected") {
      return effectiveReason
        ? `影像未通過原因：${effectiveReason}`
        : "本次照片無法完成判讀，可能是光線不足、對焦不清或出口位置未完整入鏡。";
    }
    return effectiveReason || hydrateError
      ? `技術性問題：${effectiveReason ?? hydrateError}`
      : "本次分析過程發生技術性問題，系統未產生可用結果。";
  })();

  const nextStepCopy = (() => {
    if (highRiskAdvisory) {
      return highRiskAdvisory;
    }
    if (result === "suspected") {
      return "請盡速與腹膜透析護理師聯繫，並安排返院追蹤。";
    }
    if (result === "normal") {
      return "維持日常換藥節奏，並回到追蹤日曆繼續紀錄。";
    }
    if (result === "rejected") {
      return "請調整光線與對焦後重新拍攝，再送出判讀。";
    }
    return "請稍後再試，或重新上傳一張清晰的出口照片。";
  })();

  const modelVerdictLabel = (() => {
    if (result === "suspected") {
      return "疑似感染";
    }
    if (result === "rejected") {
      return "不合格";
    }
    if (result === "technical_error") {
      return "無法判讀";
    }
    return "正常";
  })();

  const modelDotTone = (() => {
    if (result === "suspected") {
      return "orange" as const;
    }
    if (result === "rejected") {
      return "amber" as const;
    }
    if (result === "technical_error") {
      return "zinc" as const;
    }
    return "green" as const;
  })();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <header className="border-b border-zinc-100 px-5 pb-3 pt-12">
        <p className="text-xs text-zinc-400">分析結果</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
              statusChip.className
            )}
          >
            {statusChip.label}
          </span>
          {displayTimestamp ? <span className="text-xs text-zinc-400">{displayTimestamp}</span> : null}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-5 pb-8 pt-4">
        {uploadId !== null ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
            <div className="absolute right-2 top-2 z-10 rounded-md bg-zinc-900/70 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-50">
              上傳 #{uploadId}
            </div>
            {preview?.uploadId === uploadId && preview.url && !previewBroken ? (
              <Image
                src={preview.url}
                alt={`upload-preview-${uploadId}`}
                fill
                unoptimized
                className="object-cover"
                onError={() => setPreviewBroken(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                本次上傳預覽
              </div>
            )}
          </div>
        ) : null}

        <section>
          <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-zinc-600">本次症狀紀錄</h2>
          {activeSymptoms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {activeSymptoms.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-400">無症狀回報</p>
          )}
        </section>

        {isHydrating ? <p className="text-sm text-zinc-500">正在同步最新判讀紀錄...</p> : null}

        <section>
          <h2 className="mb-1.5 text-[10px] font-semibold tracking-wider text-zinc-600">這代表什麼</h2>
          <p className="text-sm leading-relaxed text-zinc-600">{meaningCopy}</p>

          {elevatedFromNormal ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-[10px] border border-zinc-200 bg-zinc-50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-zinc-500">影像模型</p>
                  <SignalDot tone="green" />
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900">
                  正常
                  {showModelConfidence ? (
                    <span className="font-normal text-zinc-400"> ({effectiveConfidence}%)</span>
                  ) : null}
                </p>
              </div>
              <div className="rounded-[10px] border border-zinc-200 bg-zinc-50 p-2.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-zinc-500">症狀綜合</p>
                  <SignalDot tone="orange" />
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900">高風險</p>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-[10px] border border-zinc-200 bg-zinc-50 p-2.5">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-zinc-500">影像模型</p>
                <SignalDot tone={modelDotTone} />
              </div>
              <p className="mt-1 text-sm font-semibold text-zinc-900">
                {modelVerdictLabel}
                {showModelConfidence ? (
                  <span className="font-normal text-zinc-400"> ({effectiveConfidence}%)</span>
                ) : null}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <h2
            className={clsx(
              "text-[10px] font-semibold tracking-wider",
              elevatedFromNormal || result === "suspected" || Boolean(highRiskAdvisory)
              ? "text-red-600"
              : "text-zinc-600"
            )}
          >
            建議下一步
          </h2>
          <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-900">{nextStepCopy}</p>
        </section>

        {showEducation ? (
          displayResult === "normal" ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-medium text-emerald-700">附加衛教影片及素材</p>
              <div className="mt-2 flex flex-col gap-2">
                {EDUCATION_MATERIALS.map(({ label, href }) => (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-emerald-700 underline underline-offset-2"
                  >
                    {label}
                  </a>
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-xl bg-red-600 px-4 py-3 text-white">
              <p className="text-sm font-medium text-red-100">附加衛教影片及素材</p>
              <div className="mt-2 flex flex-col gap-2">
                {EDUCATION_MATERIALS.map(({ label, href }) => (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-white underline underline-offset-2"
                  >
                    {label}
                  </a>
                ))}
              </div>
            </section>
          )
        ) : null}

        <div className="mt-auto flex flex-col gap-3 pt-2">
          {result === "rejected" || result === "technical_error" ? (
            <Link
              href="/patient/capture"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              重新拍攝
            </Link>
          ) : null}
          <Link
            href="/patient"
            className={clsx(
              "flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-medium transition-colors",
              result === "rejected" || result === "technical_error"
                ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                : "bg-zinc-900 text-white hover:bg-zinc-800"
            )}
          >
            <CalendarDays className="h-4 w-4" strokeWidth={1.5} />
            回到追蹤日曆
          </Link>
          {uploadId ? (
            <Link
              href={`/patient/uploads/${uploadId}`}
              className="flex w-full items-center justify-center py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-700"
            >
              查看本次上傳明細
            </Link>
          ) : null}
        </div>

        <div className="space-y-1 pb-2 text-center text-xs text-zinc-500">
          <p>本系統僅供輔助提醒，不構成醫療診斷</p>
          <p className="text-zinc-400">預測結果僅依據目前訓練資料。</p>
        </div>
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
