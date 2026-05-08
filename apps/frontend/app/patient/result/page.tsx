"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, AlertTriangle, XCircle, Home, RotateCcw } from "lucide-react";
import clsx from "clsx";

function ResultPageInner() {
  const searchParams = useSearchParams();
  const result = searchParams.get("result") as "normal" | "suspected" | "rejected" | null;
  const pain = searchParams.get("pain") === "true";
  const discharge = searchParams.get("discharge") === "true";
  const cloudyDialysate = searchParams.get("cloudyDialysate") === "true";
  const rejectionReason = searchParams.get("reason");
  const confidenceRaw = searchParams.get("confidence");
  const confidence =
    confidenceRaw && !Number.isNaN(Number(confidenceRaw))
      ? Math.max(0, Math.min(100, Number(confidenceRaw)))
      : null;

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
      title: "正常",
      subtitle: "AI 分析未偵測到感染跡象",
      message: "您的出口狀況看起來良好，請依照平時照護流程繼續護理。",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      iconColor: "text-emerald-500",
      titleColor: "text-emerald-700",
    },
    suspected: {
      icon: AlertTriangle,
      color: "red",
      title: "疑似感染",
      subtitle: "AI 偵測到潛在感染跡象",
      message: "系統已通知您的照護團隊，護理師將盡快與您確認。請勿自行用藥，等待醫療人員指示。",
      bg: "bg-red-50",
      border: "border-red-100",
      iconColor: "text-red-500",
      titleColor: "text-red-700",
    },
    rejected: {
      icon: XCircle,
      color: "amber",
      title: "上傳失敗",
      subtitle: "影像品質不足，無法進行分析",
      message: "可能原因：光線不足或出口未對齊圓形框線。請重新拍攝。",
      bg: "bg-amber-50",
      border: "border-amber-100",
      iconColor: "text-amber-500",
      titleColor: "text-amber-700",
    },
  };

  const currentConfig = result ? config[result] : config.normal;
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

        {confidence !== null && result !== "rejected" && (
          <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">AI 信心分數</p>
            <p className="text-lg font-semibold text-zinc-900">{confidence}%</p>
          </div>
        )}

        <div className="px-5 py-4 rounded-2xl bg-zinc-50 border border-zinc-100">
          <p className="text-sm text-zinc-700 leading-relaxed">
            {result === "rejected" && rejectionReason
              ? `上傳失敗原因：${rejectionReason}`
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

        {result === "suspected" && (
          <div className="flex flex-col gap-2 px-4 py-4 rounded-2xl bg-zinc-900 text-white">
            <p className="text-xs font-medium text-zinc-300">LINE 通知已發送</p>
            <p className="text-sm">您的照護護理師已收到警示通知，請保持電話暢通。</p>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-4">
          {result === "rejected" ? (
            <Link
              href="/patient/capture"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              重新拍攝
            </Link>
          ) : null}
          <Link
            href="/"
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
          >
            <Home className="w-4 h-4" strokeWidth={1.5} />
            返回首頁
          </Link>
        </div>

        <p className="text-center text-xs text-zinc-300 pb-2">
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
