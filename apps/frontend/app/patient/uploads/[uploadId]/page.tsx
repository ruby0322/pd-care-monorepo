"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarDays, CheckCircle, ChevronLeft, ChevronRight, ShieldAlert, XCircle } from "lucide-react";
import clsx from "clsx";

import { fetchPatientUploadDetail, PatientUploadDetailResponse } from "@/lib/api/upload-history";
import { getReadableApiError } from "@/lib/api/client";

function ResultBadge({ result }: { result: PatientUploadDetailResponse["screening_result"] }) {
  const config = {
    normal: {
      icon: CheckCircle,
      label: "正常",
      className: "border-emerald-100 bg-emerald-50 text-emerald-600",
    },
    suspected: {
      icon: AlertTriangle,
      label: "疑似感染",
      className: "border-red-100 bg-red-50 text-red-600",
    },
    rejected: {
      icon: XCircle,
      label: "影像不合格",
      className: "border-amber-100 bg-amber-50 text-amber-600",
    },
    technical_error: {
      icon: ShieldAlert,
      label: "系統錯誤",
      className: "border-zinc-200 bg-zinc-100 text-zinc-600",
    },
  } as const;
  const { icon: Icon, label, className } = config[result];
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", className)}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default function PatientUploadDetailPage() {
  const params = useParams<{ uploadId: string }>();
  const numericUploadId = Number(params.uploadId);
  const [detail, setDetail] = useState<PatientUploadDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (Number.isNaN(numericUploadId)) {
        setError("無效的上傳編號。");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchPatientUploadDetail(numericUploadId);
        if (!cancelled) {
          setDetail(payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getReadableApiError(err));
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
  }, [numericUploadId]);

  const createdAtText = useMemo(() => {
    if (!detail) {
      return "";
    }
    return new Date(detail.created_at).toLocaleString("zh-TW");
  }, [detail]);

  if (loading && !detail) {
    return <div className="min-h-[100dvh] bg-white px-6 py-10 text-sm text-zinc-500">載入中...</div>;
  }

  if (!detail) {
    return (
      <div className="min-h-[100dvh] bg-white px-6 py-10">
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "讀取上傳明細失敗"}</div>
        <Link href="/patient" className="mt-6 inline-flex text-sm text-zinc-600 underline underline-offset-4">
          回到追蹤首頁
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-white px-6 py-10">
      <div className="flex items-center gap-3">
        <Link
          href={`/patient/day/${detail.date}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">上傳明細</h1>
          <p className="text-xs text-zinc-500">{createdAtText}</p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-zinc-100 bg-zinc-50">
        <Image
          src={detail.image_url}
          alt={`upload-${detail.upload_id}`}
          width={1200}
          height={1200}
          unoptimized
          className="h-auto w-full object-cover"
        />
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-100 bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <ResultBadge result={detail.screening_result} />
          <span className="text-xs text-zinc-500">上傳 #{detail.upload_id}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-600">
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-zinc-400">信心分數</p>
            <p className="font-medium text-zinc-800">
              {detail.probability === null ? "N/A" : `${Math.round(detail.probability * 100)}%`}
            </p>
          </div>
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-zinc-400">閾值</p>
            <p className="font-medium text-zinc-800">{detail.threshold === null ? "N/A" : detail.threshold.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-zinc-400">模型版本</p>
            <p className="font-medium text-zinc-800">{detail.model_version ?? "N/A"}</p>
          </div>
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <p className="text-zinc-400">影像日期</p>
            <p className="font-medium text-zinc-800">{detail.date}</p>
          </div>
        </div>
        {detail.error_reason ? <p className="mt-3 text-xs text-amber-700">錯誤訊息：{detail.error_reason}</p> : null}
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-100 bg-white px-4 py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">護理標註</p>
        <p className={clsx("mt-2 text-sm", detail.annotation_label ? "text-zinc-800" : "text-zinc-500")}>
          {detail.annotation_label ? `標籤：${detail.annotation_label}` : "尚無護理標註"}
        </p>
        {detail.annotation_comment ? <p className="mt-1 text-sm text-zinc-600">{detail.annotation_comment}</p> : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link
          href={detail.prev_upload_id ? `/patient/uploads/${detail.prev_upload_id}` : "#"}
          aria-disabled={!detail.prev_upload_id}
          className={clsx(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm transition-colors",
            detail.prev_upload_id
              ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              : "cursor-not-allowed border border-zinc-100 text-zinc-300"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          上一筆
        </Link>
        <Link
          href={detail.next_upload_id ? `/patient/uploads/${detail.next_upload_id}` : "#"}
          aria-disabled={!detail.next_upload_id}
          className={clsx(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm transition-colors",
            detail.next_upload_id
              ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
              : "cursor-not-allowed border border-zinc-100 text-zinc-300"
          )}
        >
          下一筆
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <Link
        href={`/patient/day/${detail.date}`}
        className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-600 underline underline-offset-4"
      >
        <CalendarDays className="h-4 w-4" />
        回到當日時間軸
      </Link>
    </div>
  );
}
