"use client";

import Image from "next/image";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useRapidReviewGridState } from "@/app/admin/_components/rapid-review-grid-state";
import { StaffAnnotationItem, StaffRapidReviewQueueItem } from "@/lib/api/staff";

type DraftVerdict = {
  label: StaffAnnotationItem["label"];
  comment: string;
};

function suggestedLabelFromPrediction(item: StaffRapidReviewQueueItem): StaffAnnotationItem["label"] {
  if (item.screening_result === "normal") {
    return "normal";
  }
  if (item.screening_result === "suspected") {
    return "suspected";
  }
  return "rejected";
}

function predictionLabelText(item: StaffRapidReviewQueueItem): string {
  if (item.screening_result === "normal") {
    return "normal";
  }
  if (item.screening_result === "suspected") {
    return "suspected";
  }
  if (item.screening_result === "rejected") {
    return "rejected";
  }
  return "technical_error";
}

function predictionBadgeClass(item: StaffRapidReviewQueueItem): string {
  if (item.screening_result === "normal") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (item.screening_result === "suspected") {
    return "bg-red-50 text-red-700";
  }
  if (item.screening_result === "technical_error") {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-zinc-100 text-zinc-700";
}

export default function AdminFastReviewPage() {
  const {
    loading,
    saving,
    bulkSaving,
    error,
    visibleItems,
    imageUrlByUploadId,
    imageLoadErrorByUploadId,
    selectedItem,
    remainingCount,
    reloadQueue,
    selectUpload,
    annotateUpload,
    acceptAllVisible,
  } = useRapidReviewGridState();
  const [draft, setDraft] = useState<DraftVerdict>({ label: "suspected", comment: "" });

  useEffect(() => {
    if (!selectedItem) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDraft({
        label: suggestedLabelFromPrediction(selectedItem),
        comment: "",
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedItem]);

  const canBulkAccept = useMemo(
    () => !bulkSaving && !saving && visibleItems.length > 0,
    [bulkSaving, saving, visibleItems.length]
  );

  async function onSaveSelected() {
    if (!selectedItem) {
      return;
    }
    try {
      await annotateUpload(selectedItem.upload_id, draft.label, draft.comment);
      toast.success("標註完成，已自動補下一張");
      selectUpload(null);
    } catch {
      toast.error("標註失敗，請稍後再試");
    }
  }

  async function onAcceptAllVisible() {
    try {
      await acceptAllVisible();
      toast.success("已套用全部接受");
    } catch {
      toast.error("全部接受失敗，請稍後再試");
    }
  }

  if (loading && visibleItems.length === 0) {
    return <div className="mx-auto max-w-6xl py-16 text-center text-sm text-zinc-500">載入極速審核佇列中...</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">極速審核</h1>
          <p className="text-xs text-zinc-500">4x4 一次審核 16 張，點擊卡片可放大並標註。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reloadQueue()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">剩餘待審核：{remainingCount} 張</div>

      {visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-zinc-500">目前沒有待審核上傳。</p>
        </div>
      ) : (
        <section className="grid grid-cols-4 gap-2">
          {visibleItems.map((item) => {
            const imageUrl = imageUrlByUploadId[item.upload_id];
            const hasImageLoadError = imageLoadErrorByUploadId[item.upload_id] ?? false;
            return (
              <button
                key={item.upload_id}
                type="button"
                onClick={() => selectUpload(item.upload_id)}
                className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-400"
              >
                {imageUrl ? (
                  <Image src={imageUrl} alt={`upload-${item.upload_id}`} fill unoptimized className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-zinc-400">
                    {hasImageLoadError ? "載入失敗" : "載入中"}
                  </div>
                )}

                <span
                  className={`absolute right-1 top-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium backdrop-blur ${predictionBadgeClass(item)}`}
                >
                  {predictionLabelText(item)}
                </span>
              </button>
            );
          })}
        </section>
      )}

      <div className="sticky bottom-2 z-10 rounded-2xl border border-zinc-200 bg-white/95 p-3 backdrop-blur">
        <button
          type="button"
          onClick={() => void onAcceptAllVisible()}
          disabled={!canBulkAccept}
          className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {bulkSaving ? "套用中..." : "全部接受"}
        </button>
      </div>

      {selectedItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">{selectedItem.full_name ?? "未命名病患"}</p>
                <p className="text-xs text-zinc-500">
                  {selectedItem.case_number} · model: {predictionLabelText(selectedItem)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => selectUpload(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="relative h-72 overflow-hidden rounded-xl bg-zinc-100 md:h-[28rem]">
                {imageUrlByUploadId[selectedItem.upload_id] ? (
                  <Image
                    src={imageUrlByUploadId[selectedItem.upload_id]}
                    alt={`preview-${selectedItem.upload_id}`}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-400">載入影像中...</div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  標註標籤
                  <select
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, label: event.target.value as StaffAnnotationItem["label"] }))
                    }
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                  >
                    <option value="normal">normal</option>
                    <option value="suspected">suspected</option>
                    <option value="confirmed_infection">confirmed_infection</option>
                    <option value="rejected">rejected</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  備註
                  <textarea
                    value={draft.comment}
                    onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))}
                    rows={5}
                    placeholder="comment..."
                    className="resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void onSaveSelected()}
                  disabled={saving}
                  className="mt-auto rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                >
                  {saving ? "儲存中..." : "儲存並補下一張"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
