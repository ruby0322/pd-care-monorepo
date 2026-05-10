"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Expand, Minimize, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import clsx from "clsx";

import { useRapidReviewState } from "@/app/admin/_components/rapid-review-state";
import { StaffAnnotationItem } from "@/lib/api/staff";

type DraftVerdict = {
  label: StaffAnnotationItem["label"];
  comment: string;
};

const DEFAULT_VERDICT: DraftVerdict["label"] = "suspected";

export default function AdminRapidReviewPage() {
  const {
    loading,
    saving,
    error,
    queue,
    currentIndex,
    currentItem,
    currentPatient,
    currentUploadImageUrl,
    currentUploadAnnotation,
    canMovePrev,
    canMoveNext,
    reloadQueue,
    movePrev,
    moveNext,
    saveCurrentVerdict,
  } = useRapidReviewState();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draftByUploadId, setDraftByUploadId] = useState<Record<number, DraftVerdict>>({});

  const currentUpload = useMemo(
    () => currentPatient?.uploads.find((upload) => upload.upload_id === currentItem?.upload_id) ?? null,
    [currentItem?.upload_id, currentPatient?.uploads]
  );

  const draft = useMemo(() => {
    if (!currentItem) {
      return null;
    }
    return (
      draftByUploadId[currentItem.upload_id] ?? {
        label: currentUploadAnnotation?.label ?? DEFAULT_VERDICT,
        comment: currentUploadAnnotation?.comment ?? "",
      }
    );
  }, [currentItem, currentUploadAnnotation?.comment, currentUploadAnnotation?.label, draftByUploadId]);

  const onChangeDraft = (partial: Partial<DraftVerdict>) => {
    if (!currentItem || !draft) {
      return;
    }
    setDraftByUploadId((current) => ({
      ...current,
      [currentItem.upload_id]: {
        ...draft,
        ...partial,
      },
    }));
  };

  const onSave = useCallback(async () => {
    if (!currentItem || !draft) {
      return;
    }
    await saveCurrentVerdict(draft.label, draft.comment);
  }, [currentItem, draft, saveCurrentVerdict]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const targetTag = target?.tagName?.toLowerCase();
      const isInputFocused = targetTag === "input" || targetTag === "textarea" || targetTag === "select";

      if (event.key === "Escape") {
        setIsFullscreen(false);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        movePrev();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        moveNext();
        return;
      }
      if (event.key === "Enter" && !isInputFocused) {
        event.preventDefault();
        void onSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, moveNext, movePrev, onSave]);

  if (loading && queue.length === 0) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-sm text-zinc-500">載入審核佇列中...</div>;
  }

  if (!currentItem) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">快速審核</h1>
        <p className="text-sm text-zinc-500">目前沒有待審核上傳。</p>
        <button
          type="button"
          onClick={() => void reloadQueue()}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className="h-4 w-4" />
          重新整理
        </button>
      </div>
    );
  }

  const reviewCanvas = (
    <div className={clsx("grid h-full min-h-0", isFullscreen ? "grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)]" : "grid-cols-1 gap-4")}>
      <aside className={clsx("rounded-2xl border border-zinc-200 bg-white p-4", isFullscreen && "lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:p-6")}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">病患資料</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
            {currentIndex + 1} / {queue.length}
          </span>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">姓名</dt>
            <dd className="text-right text-zinc-900">{currentItem.full_name ?? "未命名"}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">病例號</dt>
            <dd className="font-mono text-right text-zinc-900">{currentItem.case_number}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">年齡</dt>
            <dd className="text-right text-zinc-900">{currentPatient?.age ?? "-"}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">上傳時間</dt>
            <dd className="text-right text-zinc-900">{new Date(currentItem.created_at).toLocaleString("zh-TW")}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">AI 結果</dt>
            <dd className="text-right text-zinc-900">{currentItem.screening_result}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">機率</dt>
            <dd className="text-right text-zinc-900">
              {currentItem.probability !== null ? `${(currentItem.probability * 100).toFixed(1)}%` : "-"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">Threshold</dt>
            <dd className="text-right text-zinc-900">
              {currentUpload?.threshold !== null && currentUpload?.threshold !== undefined
                ? currentUpload.threshold.toFixed(2)
                : "-"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-zinc-400">Model</dt>
            <dd className="text-right text-zinc-900">{currentUpload?.model_version ?? "-"}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <Link href={`/admin/patients/${currentItem.patient_id}`} className="text-xs text-zinc-500 hover:text-zinc-800">
            開啟病患完整頁
          </Link>
        </div>
      </aside>

      <section className={clsx("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950", isFullscreen && "lg:rounded-none lg:border-0")}>
        <div className="flex flex-1 items-center justify-center p-4">
          {currentUploadImageUrl ? (
            <Image
              src={currentUploadImageUrl}
              alt={`review-upload-${currentItem.upload_id}`}
              width={1800}
              height={1800}
              unoptimized
              className="max-h-[68vh] w-full object-contain"
            />
          ) : (
            <p className="text-sm text-zinc-300">載入影像中...</p>
          )}
        </div>

        <div className="border-t border-zinc-800 bg-zinc-900 p-4 text-zinc-100">
          <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <select
              value={draft?.label ?? DEFAULT_VERDICT}
              onChange={(event) => onChangeDraft({ label: event.target.value as DraftVerdict["label"] })}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="normal">normal</option>
              <option value="suspected">suspected</option>
              <option value="confirmed_infection">confirmed_infection</option>
              <option value="rejected">rejected</option>
            </select>
            <input
              value={draft?.comment ?? ""}
              onChange={(event) => onChangeDraft({ comment: event.target.value })}
              placeholder="comment..."
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50"
            >
              {saving ? "儲存中..." : "儲存並下一張"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">快捷鍵：↑/← 上一張、↓/→ 下一張、Enter 儲存、Esc 離開全螢幕</p>
        </div>
      </section>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">快速審核</h1>
          <p className="text-xs text-zinc-500">依感染風險排序，僅顯示尚未標註項目</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={movePrev}
            disabled={!canMovePrev}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
          >
            <ChevronLeft className="h-4 w-4" />
            上一張
          </button>
          <button
            type="button"
            onClick={moveNext}
            disabled={!canMoveNext}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
          >
            下一張
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((current) => !current)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            {isFullscreen ? "離開全螢幕" : "全螢幕"}
          </button>
          <button
            type="button"
            onClick={() => void reloadQueue()}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {!isFullscreen ? <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">剩餘待審核：{queue.length} 張</div> : null}

      {!isFullscreen ? reviewCanvas : null}

      {isFullscreen ? (
        <div className="fixed inset-0 z-50 bg-zinc-950 p-4 lg:p-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-zinc-200">快速審核（全螢幕）</p>
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              關閉
            </button>
          </div>
          {reviewCanvas}
        </div>
      ) : null}
    </div>
  );
}
