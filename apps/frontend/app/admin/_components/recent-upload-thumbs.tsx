"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import type { StaffUploadQueueItem } from "@/lib/api/staff";
import { fetchUploadImageAccess } from "@/lib/api/staff";
import { cn } from "@/lib/utils";

const VISIBLE_THUMBS = 5;

function formatLocalTime(raw: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(raw));
}

function queueRisk(item: StaffUploadQueueItem): { label: string; className: string } {
  if (item.screening_result === "suspected") {
    return { label: "疑似", className: "bg-red-50 text-red-700" };
  }
  if (item.has_high_risk_symptoms && item.screening_result === "normal") {
    return { label: "高風險", className: "bg-amber-50 text-amber-700" };
  }
  if (item.screening_result === "rejected") {
    return { label: "退回", className: "bg-zinc-100 text-zinc-600" };
  }
  return { label: "正常", className: "bg-zinc-100 text-zinc-600" };
}

type RecentUploadThumbsProps = {
  items: StaffUploadQueueItem[];
  loading: boolean;
  error: string | null;
};

export function RecentUploadThumbs({ items, loading, error }: RecentUploadThumbsProps) {
  const visible = useMemo(() => items.slice(0, VISIBLE_THUMBS), [items]);
  const overflow = Math.max(0, items.length - VISIBLE_THUMBS);
  const [imageUrlById, setImageUrlById] = useState<Record<number, string>>({});
  const [imageErrorById, setImageErrorById] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const missing = visible.filter((item) => !imageUrlById[item.upload_id] && !imageErrorById[item.upload_id]);
    if (missing.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.allSettled(missing.map((item) => fetchUploadImageAccess(item.upload_id))).then((results) => {
      if (cancelled) {
        return;
      }
      setImageUrlById((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            next[missing[index].upload_id] = result.value.image_url;
          }
        });
        return next;
      });
      setImageErrorById((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            next[missing[index].upload_id] = true;
          }
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, imageUrlById, imageErrorById]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">最新上傳</h2>
        <Link href="/admin/review-fast" className="text-xs text-zinc-500 hover:text-zinc-800">
          極速審核 →
        </Link>
      </div>
      {loading ? <p className="py-4 text-center text-sm text-zinc-400">載入中…</p> : null}
      {!loading && error ? <p className="py-4 text-center text-sm text-red-600">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">目前沒有上傳資料。</p>
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {visible.map((item) => {
            const risk = queueRisk(item);
            const imageUrl = imageUrlById[item.upload_id];
            const imageError = imageErrorById[item.upload_id] ?? false;
            return (
              <Link
                key={item.upload_id}
                href={`/admin/patients/${item.patient_id}`}
                className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200 transition hover:ring-zinc-400"
              >
                {imageUrl ? (
                  <Image src={imageUrl} alt="" fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-zinc-400">
                    {imageError ? "失敗" : "…"}
                  </div>
                )}
                <span className={cn("absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", risk.className)}>
                  {risk.label}
                </span>
                <span className="absolute bottom-1 right-1 rounded bg-zinc-900/75 px-1.5 py-0.5 text-[10px] text-white">
                  {formatLocalTime(item.created_at)}
                </span>
              </Link>
            );
          })}
          {overflow > 0 ? (
            <Link
              href="/admin/history-overview"
              className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
            >
              +{overflow}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
