"use client";

import { AlertTriangle, ArrowLeft, Play, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { CopilotHtmlArtifact } from "@/app/admin/copilot/_components/copilot-html-artifact";
import { VISIBILITY_META } from "@/app/admin/copilot/_components/visibility-meta";
import { getReadableApiError } from "@/lib/api/client";
import { deleteCopilotModule, fetchCopilotModule, type CopilotModuleDetail } from "@/lib/api/copilot";

/**
 * One module, full screen.
 *
 * A module you do not own does not run until you ask it to. Its HTML is code a colleague
 * wrote, and the bridge answers its `pdcare.query` calls with *your* permissions -- so it
 * reads what you can read, not what the author could. That is a capability worth granting
 * deliberately, which is why the frame is not mounted until 執行此模組 is clicked. Your own
 * modules run straight away.
 */
export default function ModulePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const moduleId = Number(params?.id);

  const [detail, setDetail] = useState<CopilotModuleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasConsented, setHasConsented] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(moduleId)) {
      setLoadError("這個模組網址無效。");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await fetchCopilotModule(moduleId);
      setDetail(result);
      setLoadError(null);
    } catch (error) {
      const message = getReadableApiError(error);
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleDelete() {
    if (detail === null || !window.confirm("刪除這個模組？此動作無法復原。")) {
      return;
    }
    try {
      await deleteCopilotModule(detail.module_id);
      router.push("/admin/modules");
    } catch (error) {
      toast.error(getReadableApiError(error));
    }
  }

  const backLink = (
    <Link
      href="/admin/modules"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
      aria-label="返回模組列表"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
    </Link>
  );

  if (loadError !== null) {
    return (
      <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] flex-col bg-white">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-100 px-4">{backLink}</header>
        <div className="mx-auto max-w-md py-20 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
            <AlertTriangle className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
          </div>
          <h1 className="mb-1.5 text-base font-semibold text-zinc-900">無法開啟這個模組</h1>
          <p className="mb-5 text-sm leading-6 text-zinc-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
            重試
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || detail === null) {
    return (
      <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] flex-col bg-white">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-100 px-4">
          {backLink}
          <div className="h-3.5 w-40 animate-pulse rounded bg-zinc-100" />
        </header>
        <div className="flex-1 space-y-3 p-6">
          <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100" />
          <div className="h-48 animate-pulse rounded-xl bg-zinc-100" />
        </div>
      </div>
    );
  }

  const { label, Icon, badgeClass } = VISIBILITY_META[detail.visibility];
  const needsConsent = !detail.is_owner && !hasConsented;

  return (
    <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-100 px-4">
        {backLink}
        <h1 className="min-w-0 truncate text-[15px] font-semibold text-zinc-900">{detail.title}</h1>
        <span
          className={`hidden shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium sm:inline-flex ${badgeClass}`}
        >
          <Icon className="h-3 w-3" strokeWidth={1.5} />
          {label}
        </span>
        {detail.is_owner ? null : (
          <span className="hidden shrink-0 text-[11px] text-zinc-400 sm:inline">{detail.owner_name ?? "他人"}</span>
        )}
        <span className="flex-1" />
        {detail.is_owner ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="刪除模組"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-10">
          {detail.description ? (
            <p className="pt-4 text-sm leading-6 text-zinc-500">{detail.description}</p>
          ) : null}

          {needsConsent ? (
            <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-8 text-center">
              <h2 className="mb-1.5 text-sm font-semibold text-zinc-900">
                這是 {detail.owner_name ?? "其他人"} 建立的模組
              </h2>
              <p className="mx-auto mb-4 max-w-md text-xs leading-6 text-zinc-500">
                開啟後它會以你的權限查詢真實資料，只會看到你本來就能看到的病患。
              </p>
              <button
                type="button"
                onClick={() => setHasConsented(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                <Play className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
                執行此模組
              </button>
            </div>
          ) : (
            // A module always runs live: one that only ever showed the day it was saved
            // would be pointless, so the 即時資料 control is not offered here.
            <CopilotHtmlArtifact html={detail.html} liveEnabled />
          )}
        </div>
      </div>
    </div>
  );
}
