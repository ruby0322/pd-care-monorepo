"use client";

import Image from "next/image";

import type { StaffHistoryOverviewUploadItem } from "@/lib/api/staff";

import {
  formatHistoryUploadLocalTime,
  historyUploadRiskBadgeClass,
  historyUploadRiskLabel,
} from "./history-upload-review-helpers";

type HistoryUploadThumbnailGridProps = {
  uploads: StaffHistoryOverviewUploadItem[];
  imageUrlByUploadId: Record<number, string>;
  imageErrorByUploadId: Record<number, boolean>;
  onSelectUpload: (uploadId: number) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
};

export function HistoryUploadThumbnailGrid({
  uploads,
  imageUrlByUploadId,
  imageErrorByUploadId,
  onSelectUpload,
  hasMore,
  onLoadMore,
}: HistoryUploadThumbnailGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {uploads.map((item) => {
        const imageUrl = imageUrlByUploadId[item.upload_id];
        const imageError = imageErrorByUploadId[item.upload_id] ?? false;
        return (
          <button
            key={item.upload_id}
            type="button"
            onClick={() => onSelectUpload(item.upload_id)}
            className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-400"
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={`history-upload-${item.upload_id}`}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                {imageError ? "載入失敗" : "載入中"}
              </div>
            )}
            <span
              className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${historyUploadRiskBadgeClass(item)}`}
            >
              {historyUploadRiskLabel(item)}
            </span>
            <span className="absolute bottom-1 right-1 rounded bg-zinc-900/75 px-1.5 py-0.5 text-[10px] text-white">
              {formatHistoryUploadLocalTime(item.created_at)}
            </span>
          </button>
        );
      })}
      {hasMore && onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
