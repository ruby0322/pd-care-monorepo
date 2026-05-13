"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, XCircle, ShieldAlert, ImageIcon } from "lucide-react";
import clsx from "clsx";

import { fetchPatientUploadDetail, fetchUploadsByDay, PatientDayUploadItem } from "@/lib/api/upload-history";
import { getReadableApiError } from "@/lib/api/client";

function ResultChip({ result }: { result: PatientDayUploadItem["screening_result"] }) {
  if (result === "suspected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-600">
        <AlertTriangle className="h-3 w-3" />
        疑似感染
      </span>
    );
  }
  if (result === "normal") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs text-emerald-600">
        <CheckCircle className="h-3 w-3" />
        正常
      </span>
    );
  }
  if (result === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-600">
        <XCircle className="h-3 w-3" />
        影像不合格
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
      <ShieldAlert className="h-3 w-3" />
      系統錯誤
    </span>
  );
}

export default function PatientDayTimelinePage() {
  const params = useParams<{ date: string }>();
  const dateKey = params.date;
  const [items, setItems] = useState<PatientDayUploadItem[]>([]);
  const [thumbnailUrlByUpload, setThumbnailUrlByUpload] = useState<Record<number, string>>({});
  const [brokenThumbnails, setBrokenThumbnails] = useState<Record<number, true>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setBrokenThumbnails({});
      try {
        const payload = await fetchUploadsByDay(dateKey);
        const thumbnailRows = await Promise.all(
          payload.items.map(async (item) => {
            try {
              const detail = await fetchPatientUploadDetail(item.upload_id);
              return { uploadId: item.upload_id, imageUrl: detail.image_url };
            } catch {
              return { uploadId: item.upload_id, imageUrl: "" };
            }
          })
        );
        if (!cancelled) {
          setItems(payload.items);
          const nextMap: Record<number, string> = {};
          for (const row of thumbnailRows) {
            if (row.imageUrl) {
              nextMap[row.uploadId] = row.imageUrl;
            }
          }
          setThumbnailUrlByUpload(nextMap);
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
  }, [dateKey]);

  const titleDate = useMemo(() => {
    const parsed = new Date(`${dateKey}T00:00:00+08:00`);
    if (Number.isNaN(parsed.getTime())) {
      return dateKey;
    }
    return parsed.toLocaleDateString("zh-TW");
  }, [dateKey]);

  return (
    <div className="min-h-[100dvh] bg-white px-6 py-10">
      <div className="flex items-center gap-3">
        <Link
          href="/patient"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">上傳紀錄時間軸</h1>
          <p className="text-xs text-zinc-500">{titleDate}</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
        點選一筆上傳可查看完整影像、AI 判讀資訊與護理標註。
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">載入中...</div>
      ) : null}

      {error ? <div className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">
          這一天沒有上傳紀錄。
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {items.map((item) => {
          const createdAt = new Date(item.created_at).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <Link
              key={item.upload_id}
              href={`/patient/uploads/${item.upload_id}`}
              className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-white px-4 py-4 transition-colors hover:bg-zinc-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 text-zinc-500">
                {thumbnailUrlByUpload[item.upload_id] && !brokenThumbnails[item.upload_id] ? (
                  <Image
                    src={thumbnailUrlByUpload[item.upload_id]}
                    alt={`timeline-upload-${item.upload_id}`}
                    width={40}
                    height={40}
                    unoptimized
                    className="h-full w-full object-cover"
                    onError={() =>
                      setBrokenThumbnails((current) => ({
                        ...current,
                        [item.upload_id]: true,
                      }))
                    }
                  />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <ResultChip result={item.screening_result} />
                  <span className="text-xs text-zinc-500">{createdAt}</span>
                </div>
                <p className={clsx("mt-1 text-xs", item.annotation_label ? "text-zinc-700" : "text-zinc-400")}>
                  {item.annotation_label
                    ? `護理標註：${item.annotation_label}${item.annotation_comment ? ` - ${item.annotation_comment}` : ""}`
                    : "尚無護理標註"}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-400" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
