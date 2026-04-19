"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Camera, Sun, AlignCenter, Eye } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";

type DemoResult = "normal" | "suspected" | "rejected" | null;

function CameraView({
  onCapture,
  onError,
}: {
  onCapture: (dataUrl: string) => void;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => setReady(true));
        }
      })
      .catch(() => {
        if (!cancelled) onError();
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(canvas.toDataURL("image/jpeg", 0.8));
  };

  return (
    <>
      <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={handleCapture}
        disabled={!ready}
        className="mx-auto flex w-16 h-16 items-center justify-center rounded-full border-4 border-white bg-white/20 hover:bg-white/30 transition-colors disabled:opacity-40"
      >
        <div className="w-10 h-10 rounded-full bg-white" />
      </button>
    </>
  );
}

function CapturePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cameraKey, setCameraKey] = useState(0);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoResult, setDemoResult] = useState<DemoResult>(null);
  const [cameraError, setCameraError] = useState(false);

  const handleCapture = (dataUrl: string) => {
    setCapturedImage(dataUrl);
    setShowDemoModal(true);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setShowDemoModal(false);
    setDemoResult(null);
    setCameraError(false);
    setCameraKey((k) => k + 1);
  };

  const handleSimulate = () => {
    if (!demoResult) return;
    const params = new URLSearchParams({
      pain: searchParams.get("pain") ?? "false",
      discharge: searchParams.get("discharge") ?? "false",
      cloudyDialysate: searchParams.get("cloudyDialysate") ?? "false",
      result: demoResult,
    });
    router.push(`/patient/result?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="flex items-center gap-3 px-5 pt-12 pb-4 absolute top-0 left-0 right-0 z-10">
        <Link
          href="/patient"
          className="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-white" strokeWidth={1.5} />
        </Link>
        <span className="text-sm font-medium text-white">出口拍攝</span>
      </header>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden min-h-screen">
        {capturedImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capturedImage} alt="captured" className="w-full h-full object-cover absolute inset-0" />
        ) : cameraError ? (
          <div className="flex flex-col items-center gap-4 px-8 text-center">
            <Camera className="w-12 h-12 text-zinc-600" strokeWidth={1} />
            <p className="text-zinc-400 text-sm">無法存取相機，請確認相機權限</p>
            <button
              onClick={handleRetake}
              className="px-5 py-2.5 rounded-xl bg-zinc-800 text-white text-sm hover:bg-zinc-700 transition-colors"
            >
              重試
            </button>
          </div>
        ) : (
          <CameraView key={cameraKey} onCapture={handleCapture} onError={() => setCameraError(true)} />
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-72 h-72">
            <svg viewBox="0 0 288 288" className="absolute inset-0 w-full h-full">
              <circle cx="144" cy="144" r="130" fill="none" stroke="white" strokeWidth="2" strokeDasharray="12 8" opacity="0.8" />
              <line x1="144" y1="14" x2="144" y2="40" stroke="white" strokeWidth="1.5" opacity="0.5" />
              <line x1="144" y1="248" x2="144" y2="274" stroke="white" strokeWidth="1.5" opacity="0.5" />
              <line x1="14" y1="144" x2="40" y2="144" stroke="white" strokeWidth="1.5" opacity="0.5" />
              <line x1="248" y1="144" x2="274" y2="144" stroke="white" strokeWidth="1.5" opacity="0.5" />
            </svg>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-5 pb-10 pt-6 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-center gap-6 mb-6">
            {([{ icon: Sun, label: "確保光線充足" }, { icon: AlignCenter, label: "對齊出口位置" }, { icon: Eye, label: "導管清晰可見" }] as const).map(
              ({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <Icon className="w-4 h-4 text-white/60" strokeWidth={1.5} />
                  <span className="text-white/50 text-xs">{label}</span>
                </div>
              )
            )}
          </div>

          {capturedImage && !showDemoModal && (
            <button
              onClick={handleRetake}
              className="w-full py-3.5 rounded-2xl border border-white/30 text-white text-sm font-medium hover:bg-white/10 transition-colors"
            >
              重新拍攝
            </button>
          )}
        </div>
      </div>

      {showDemoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-20">
          <div className="w-full bg-white rounded-t-3xl px-6 pt-6 pb-10">
            <div className="w-10 h-1 rounded-full bg-zinc-200 mx-auto mb-6" />
            <p className="text-xs text-zinc-400 text-center mb-1">僅供展示使用</p>
            <h2 className="text-base font-semibold text-zinc-900 text-center mb-5">模擬 AI 辨識結果</h2>
            <div className="flex flex-col gap-3 mb-6">
              {(
                [
                  { value: "normal", label: "正常", desc: "無感染跡象", color: "emerald" },
                  { value: "suspected", label: "疑似感染", desc: "偵測到異常，建議聯絡護理師", color: "red" },
                  { value: "rejected", label: "拒絕上傳", desc: "影像品質不足，需重新拍攝", color: "amber" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDemoResult(opt.value)}
                  className={clsx(
                    "flex items-center gap-4 w-full px-4 py-3.5 rounded-xl border-2 transition-all text-left",
                    demoResult === opt.value
                      ? opt.color === "emerald" ? "border-emerald-500 bg-emerald-50"
                        : opt.color === "red" ? "border-red-500 bg-red-50"
                        : "border-amber-500 bg-amber-50"
                      : "border-zinc-100 bg-zinc-50"
                  )}
                >
                  <div
                    className={clsx(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                      demoResult === opt.value
                        ? opt.color === "emerald" ? "border-emerald-500"
                          : opt.color === "red" ? "border-red-500"
                          : "border-amber-500"
                        : "border-zinc-300"
                    )}
                  >
                    {demoResult === opt.value && (
                      <div className={clsx("w-2 h-2 rounded-full", opt.color === "emerald" ? "bg-emerald-500" : opt.color === "red" ? "bg-red-500" : "bg-amber-500")} />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">{opt.label}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRetake}
                className="flex-1 py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
              >
                重新拍攝
              </button>
              <button
                onClick={handleSimulate}
                disabled={!demoResult}
                className="flex-1 py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-30"
              >
                確認結果
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CapturePage() {
  return (
    <Suspense>
      <CapturePageInner />
    </Suspense>
  );
}
