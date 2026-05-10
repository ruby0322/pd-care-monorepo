"use client";

import { getApiErrorDetail, getReadableApiError } from "@/lib/api/client";
import { uploadPatientExitSiteImage } from "@/lib/api/predict";
import { getLiffProfile } from "@/lib/auth/liff";
import { AlignCenter, Camera, ChevronLeft, Eye, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

function CameraView({
  onCapture,
  onError,
}: {
  onCapture: (dataUrl: string) => void;
  onError: (message?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isInsecureContext =
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost";

    if (isInsecureContext) {
      onError("目前連線不是 HTTPS，手機瀏覽器通常會封鎖即時相機，請改用下方拍照上傳。");
      return () => {
        cancelled = true;
      };
    }

    const mediaDevices =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

    if (!mediaDevices?.getUserMedia) {
      onError("此裝置不支援即時相機，請改用下方拍照上傳。");
      return () => {
        cancelled = true;
      };
    }

    mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setReady(true);
          void videoRef.current.play().catch(() => {
            // Some browsers block autoplay without a user gesture even when camera permission is granted.
            // Keep camera view active instead of treating it as a hard camera access error.
          });
        }
      })
      .catch(() => {
        if (!cancelled) onError("無法開啟即時相機，請確認權限或改用下方拍照上傳。");
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
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={handleCapture}
        disabled={!ready}
        className="absolute bottom-28 left-1/2 z-20 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white bg-white/20 transition-colors hover:bg-white/30 disabled:opacity-40"
      >
        <div className="w-10 h-10 rounded-full bg-white" />
      </button>
    </>
  );
}

function CapturePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState("無法存取相機，請確認相機權限");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lineUserId, setLineUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getLiffProfile();
        if (!cancelled) {
          setLineUserId(profile.userId);
        }
      } catch (error) {
        if (!cancelled) {
          setSubmitError(getReadableApiError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCapture = (dataUrl: string) => {
    setCapturedImage(dataUrl);
    setShowSubmitModal(true);
    setSubmitError(null);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setShowSubmitModal(false);
    setCameraError(false);
    setCameraErrorMessage("無法存取相機，請確認相機權限");
    setSubmitError(null);
    setIsSubmitting(false);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
    setCameraKey((k) => k + 1);
  };

  const handleSelectPhoto = () => {
    uploadInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        handleCapture(reader.result);
      }
    };
    reader.onerror = () => {
      setSubmitError("無法讀取照片，請重新選擇");
    };
    reader.readAsDataURL(file);
  };

  const dataUrlToJpegFile = async (dataUrl: string): Promise<File> => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("無法解析照片格式，請改用 JPEG/PNG 再試"));
      img.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("瀏覽器不支援影像轉檔");
    }
    context.drawImage(image, 0, 0);

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("照片轉成 JPEG 失敗"));
          return;
        }
        resolve(blob);
      }, "image/jpeg", 0.9);
    });

    return new File([jpegBlob], `exit-site-${Date.now()}.jpg`, { type: "image/jpeg" });
  };

  const handleSubmit = async () => {
    if (!capturedImage) return;
    if (!lineUserId) {
      setSubmitError("尚未取得 LINE 身分，請返回上一頁重新進入。");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const file = await dataUrlToJpegFile(capturedImage);
      const payload = await uploadPatientExitSiteImage(lineUserId, file);
      const result = payload.screening_result;
      const confidence = Math.round(payload.prediction.predicted_probability * 100);

      const params = new URLSearchParams({
        pain: searchParams.get("pain") ?? "false",
        discharge: searchParams.get("discharge") ?? "false",
        cloudyDialysate: searchParams.get("cloudyDialysate") ?? "false",
        result,
        confidence: String(confidence),
        uploadId: String(payload.upload_id),
        aiResultId: String(payload.ai_result_id),
      });
      router.push(`/patient/result?${params.toString()}`);
    } catch (error) {
      const detail = getApiErrorDetail(error);
      if (detail) {
        const params = new URLSearchParams({
          pain: searchParams.get("pain") ?? "false",
          discharge: searchParams.get("discharge") ?? "false",
          cloudyDialysate: searchParams.get("cloudyDialysate") ?? "false",
          result: "rejected",
          reason: detail,
        });
        router.push(`/patient/result?${params.toString()}`);
        return;
      }
      setSubmitError(getReadableApiError(error));
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    setShowSubmitModal(false);
    setSubmitError(null);
  };

  const handleReopenSubmitModal = () => {
    setShowSubmitModal(true);
    setSubmitError(null);
  };

  return (
    <div className="min-h-[100dvh] bg-black flex flex-col">
      <header className="flex items-center gap-3 px-5 pt-12 pb-4 absolute top-0 left-0 right-0 z-10">
        <Link
          href="/patient"
          className="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-white" strokeWidth={1.5} />
        </Link>
        <span className="text-sm font-medium text-white">出口拍攝</span>
      </header>

      <div className="relative min-h-[100dvh] flex-1 overflow-hidden">
        {capturedImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capturedImage} alt="captured" className="w-full h-full object-cover absolute inset-0" />
        ) : cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="w-12 h-12 text-zinc-600" strokeWidth={1} />
            <p className="text-zinc-400 text-sm">{cameraErrorMessage}</p>
            <button
              onClick={handleSelectPhoto}
              className="px-5 py-2.5 rounded-xl bg-zinc-700 text-white text-sm hover:bg-zinc-600 transition-colors"
            >
              改用拍照上傳
            </button>
            <button
              onClick={handleRetake}
              className="px-5 py-2.5 rounded-xl bg-zinc-800 text-white text-sm hover:bg-zinc-700 transition-colors"
            >
              重試
            </button>
          </div>
        ) : (
          <CameraView
            key={cameraKey}
            onCapture={handleCapture}
            onError={(message) => {
              setCameraErrorMessage(message ?? "無法存取相機，請確認相機權限");
              setCameraError(true);
            }}
          />
        )}
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

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

          {capturedImage && !showSubmitModal && (
            <button
              onClick={handleReopenSubmitModal}
              className="w-full py-3.5 rounded-2xl border border-white/30 text-white text-sm font-medium hover:bg-white/10 transition-colors"
            >
              送出分析
            </button>
          )}
        </div>
      </div>

      {showSubmitModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-20">
          <div className="w-full bg-white rounded-t-3xl px-6 pt-6 pb-10">
            <div className="w-10 h-1 rounded-full bg-zinc-200 mx-auto mb-6" />
            <p className="text-xs text-zinc-400 text-center mb-1">即將送至後端分析</p>
            <h2 className="text-base font-semibold text-zinc-900 text-center mb-2">確認上傳照片</h2>
            <p className="text-sm text-zinc-500 text-center mb-6">
              系統會呼叫 AI 服務進行傷口感染風險判讀
            </p>
            {submitError && (
              <div className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleRetake}
                disabled={isSubmitting}
                className="flex-1 py-4 rounded-2xl border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
              >
                重新拍攝
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 py-4 rounded-2xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-30"
              >
                {isSubmitting ? "分析中..." : "送出分析"}
              </button>
            </div>
            <button
              onClick={handleCloseModal}
              disabled={isSubmitting}
              className="w-full mt-3 text-xs text-zinc-400 hover:text-zinc-500 disabled:opacity-40"
            >
              先不要，返回預覽
            </button>
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
