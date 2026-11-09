"use client";

import { AlertTriangle, Blocks, Lock, Play, RefreshCw, Shield, Trash2, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CopilotHtmlArtifact } from "@/app/admin/copilot/_components/copilot-html-artifact";
import { getReadableApiError } from "@/lib/api/client";
import {
  deleteCopilotModule,
  fetchCopilotModule,
  fetchCopilotModules,
  type CopilotModuleDetail,
  type CopilotModuleSummary,
  type CopilotVisibility,
} from "@/lib/api/copilot";

const VISIBILITY_META: Record<CopilotVisibility, { label: string; Icon: typeof Lock }> = {
  private: { label: "僅自己", Icon: Lock },
  staff: { label: "護理師可見", Icon: Users },
  admin: { label: "管理員可見", Icon: Shield },
};

export default function ModulesPage() {
  const [modules, setModules] = useState<CopilotModuleSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CopilotModuleDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  // Kept apart from "there is nothing here": an empty list is an invitation, a failed
  // fetch is not, and a nurse with twenty saved modules must never be told she has none.
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // The one module the viewer has explicitly asked to run. A module's HTML/JS is code
  // *somebody else* may have written, and it runs inside a bridge that answers
  // `pdcare.query` with the viewer's own token -- so a module the viewer does not own
  // stays inert until they click 執行此模組 for that specific module.
  const [consentedModuleId, setConsentedModuleId] = useState<number | null>(null);

  const loadList = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const items = await fetchCopilotModules();
      setModules(items);
      // Auto-select only among the viewer's *own* modules. The list is every module the
      // viewer can see -- theirs plus every shared one, newest first -- so selecting
      // `items[0]` would make merely opening this page execute whichever colleague saved
      // most recently. If the viewer owns nothing, select nothing.
      setSelectedModuleId((current) => current ?? items.find((item) => item.is_owner)?.module_id ?? null);
      setListError(null);
    } catch (error) {
      const message = getReadableApiError(error);
      setListError(message);
      toast.error(message);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  // Tracks the most recently *requested* module, independent of resolution order. A slow
  // fetch for a module the viewer has since clicked away from must not be allowed to
  // overwrite `detail` or flip `isLoadingDetail` off once a newer request is in flight —
  // otherwise last-resolve-wins can land a stale response on top of a faster, newer one
  // (or finish after it, leaving every render branch falling through to a blank pane).
  const latestRequestedModuleIdRef = useRef<number | null>(null);

  const loadDetail = useCallback(
    async (moduleId: number) => {
      latestRequestedModuleIdRef.current = moduleId;
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        const result = await fetchCopilotModule(moduleId);
        if (latestRequestedModuleIdRef.current !== moduleId) {
          return; // A newer selection superseded this request; drop the stale result.
        }
        setDetail(result);
      } catch (error) {
        if (latestRequestedModuleIdRef.current !== moduleId) {
          return;
        }
        const message = getReadableApiError(error);
        setDetailError(message);
        toast.error(message);
        // The usual cause is a module its owner has since deleted, which leaves a dead
        // entry in a list that is otherwise never re-fetched. Refresh it so the entry
        // goes away rather than staying clickable for the rest of the session.
        void loadList();
      } finally {
        if (latestRequestedModuleIdRef.current === moduleId) {
          setIsLoadingDetail(false);
        }
      }
    },
    [loadList],
  );

  useEffect(() => {
    if (selectedModuleId === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadDetail(selectedModuleId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedModuleId, loadDetail]);

  async function handleDelete(moduleId: number) {
    if (!window.confirm("刪除這個模組？此動作無法復原。")) {
      return;
    }
    try {
      await deleteCopilotModule(moduleId);
      setModules((current) => current.filter((item) => item.module_id !== moduleId));
      setSelectedModuleId((current) => (current === moduleId ? null : current));
      setDetail((current) => (current?.module_id === moduleId ? null : current));
    } catch (error) {
      toast.error(getReadableApiError(error));
    }
  }

  const activeDetail = detail && detail.module_id === selectedModuleId ? detail : null;
  // Someone else's code waits for an explicit click; the viewer's own runs as before.
  const needsRunConsent =
    activeDetail !== null && !activeDetail.is_owner && consentedModuleId !== activeDetail.module_id;

  if (!isLoadingList && modules.length === 0 && listError) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-600" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1.5 text-base font-semibold text-zinc-900">無法載入模組列表</h1>
        <p className="text-sm leading-6 text-zinc-500">{listError}</p>
        <button
          type="button"
          onClick={() => void loadList()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          重新載入
        </button>
      </div>
    );
  }

  if (!isLoadingList && modules.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
          <Blocks className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1.5 text-base font-semibold text-zinc-900">還沒有任何模組</h1>
        <p className="text-sm leading-6 text-zinc-500">
          在 PD Copilot 的對話中，把一份報表「儲存為模組」，就能在這裡重複開啟、分享給同事使用。
        </p>
        <Link
          href="/admin/copilot"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          <Blocks className="h-4 w-4" strokeWidth={1.5} />
          前往 PD Copilot
        </Link>
      </div>
    );
  }

  return (
    <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] flex-col overflow-hidden bg-white md:flex-row">
      {/* Module list */}
      <aside className="flex max-h-56 shrink-0 flex-col overflow-y-auto border-b border-zinc-100 bg-zinc-50/60 px-2 py-3 md:max-h-none md:w-[280px] md:border-r md:border-b-0 md:py-4">
        {isLoadingList ? (
          <div className="space-y-2 px-2 py-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200" />
          </div>
        ) : (
          <ul className="space-y-0.5">
            {modules.map((module) => {
              const { label, Icon } = VISIBILITY_META[module.visibility];
              const isActive = module.module_id === selectedModuleId;
              return (
                <li key={module.module_id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      // Consent covers one module, not the page: moving to another drops
                      // it, so one click cannot arm every shared module in the list.
                      if (module.module_id !== selectedModuleId) {
                        setConsentedModuleId(null);
                      }
                      setSelectedModuleId(module.module_id);
                    }}
                    className={`w-full rounded-lg px-3 py-2 pr-8 text-left transition-colors ${
                      isActive ? "bg-zinc-200/70" : "hover:bg-zinc-200/40"
                    }`}
                  >
                    <span
                      className={`block truncate text-sm ${isActive ? "font-medium text-zinc-900" : "text-zinc-600"}`}
                    >
                      {module.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                      <Icon className="h-3 w-3" strokeWidth={1.5} />
                      {label}
                      {module.is_owner ? null : (
                        <>
                          <span className="text-zinc-300">·</span>
                          <span>{module.owner_name ?? "他人"}</span>
                        </>
                      )}
                    </span>
                  </button>
                  {module.is_owner ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(module.module_id)}
                      className="absolute top-2 right-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors group-hover:flex hover:bg-zinc-300/50 hover:text-zinc-700"
                      aria-label="刪除模組"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Selected module */}
      <section className="min-w-0 flex-1 overflow-y-auto px-4 py-6">
        {selectedModuleId === null ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-zinc-400">
            請從左側選擇一個模組
          </div>
        ) : isLoadingDetail && !activeDetail ? (
          <div className="space-y-4 py-4">
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-100" />
            <div className="h-40 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : detailError && !activeDetail ? (
          // Without this branch the pane simply falls through to `null`: a white rectangle
          // and a toast that has already gone.
          <div className="mx-auto flex w-full max-w-lg flex-col items-center py-20 text-center">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600" strokeWidth={1.5} />
            </div>
            <h1 className="mb-1.5 text-base font-semibold text-zinc-900">無法開啟這個模組</h1>
            <p className="text-sm leading-6 text-zinc-500">{detailError}</p>
            <p className="mt-1 text-xs leading-6 text-zinc-400">模組可能已被作者刪除，列表已重新整理。</p>
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadDetail(selectedModuleId)}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
                重試
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetailError(null);
                  setSelectedModuleId(null);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                返回列表
              </button>
            </div>
          </div>
        ) : activeDetail ? (
          <div className="mx-auto w-full max-w-3xl">
            <header className="mb-1">
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900">{activeDetail.title}</h1>
              {activeDetail.description ? (
                <p className="mt-1 text-sm leading-6 text-zinc-500">{activeDetail.description}</p>
              ) : null}
              {!activeDetail.is_owner ? (
                <p className="mt-1 text-xs text-zinc-400">由 {activeDetail.owner_name ?? "他人"} 分享</p>
              ) : null}
            </header>

            {needsRunConsent ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-4">
                <p className="text-xs leading-6 text-zinc-500">
                  這個模組的程式碼由其他使用者撰寫，執行後會以你的帳號權限讀取你可存取的資料。
                </p>
                <button
                  type="button"
                  onClick={() => setConsentedModuleId(activeDetail.module_id)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                  執行此模組
                </button>
              </div>
            ) : (
              /* No `onToggleLive`: a saved module always runs live, so the 即時資料
                 control is hidden rather than rendered as a button that does nothing. */
              <CopilotHtmlArtifact html={activeDetail.html} liveEnabled />
            )}

            <div className="mt-3">
              <Link
                href="/admin/copilot"
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-900"
              >
                <Wrench className="h-3.5 w-3.5" strokeWidth={1.5} />
                在 Copilot 中開啟修正
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
