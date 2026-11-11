"use client";

import { AlertTriangle, Blocks, RefreshCw, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import { deleteCopilotModule, fetchCopilotModules, type CopilotModuleSummary } from "@/lib/api/copilot";

import { ModuleCard } from "./_components/module-card";

/**
 * The selection page: every module this user may see, newest first.
 *
 * Opening a module is its own page (`/admin/modules/[id]`) rather than a pane beside the
 * list, so a module can be linked to, and the browser's own back button returns to the grid.
 * Nothing here runs a module: a card renders an inert preview, and the live data -- which a
 * module fetches with the viewer's own permissions -- only starts on the module's own page.
 */
export default function ModulesPage() {
  const [modules, setModules] = useState<CopilotModuleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Kept apart from "there is nothing here": an empty list is an invitation, a failed
  // fetch is not, and a nurse with twenty saved modules must never be told she has none.
  const [listError, setListError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await fetchCopilotModules();
      setModules(items);
      setListError(null);
    } catch (error) {
      const message = getReadableApiError(error);
      setListError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  async function handleDelete(moduleId: number) {
    if (!window.confirm("刪除這個模組？此動作無法復原。")) {
      return;
    }
    try {
      await deleteCopilotModule(moduleId);
      setModules((current) => current.filter((item) => item.module_id !== moduleId));
    } catch (error) {
      toast.error(getReadableApiError(error));
    }
  }

  if (!isLoading && modules.length === 0 && listError) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
          <AlertTriangle className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1.5 text-base font-semibold text-zinc-900">無法載入模組列表</h1>
        <p className="mb-5 text-sm leading-6 text-zinc-500">{listError}</p>
        <button
          type="button"
          onClick={() => void loadList()}
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          重新載入
        </button>
      </div>
    );
  }

  if (!isLoading && modules.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
          <Blocks className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1.5 text-base font-semibold text-zinc-900">還沒有任何模組</h1>
        <p className="mb-5 text-sm leading-6 text-zinc-500">
          在 PD Copilot 產生一份報表後，按報表上的儲存圖示就會留在這裡，之後可以重複開啟。
        </p>
        <Link
          href="/admin/copilot"
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          <Wrench className="h-4 w-4" strokeWidth={1.5} />
          去 PD Copilot
        </Link>
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">分析模組</h1>
          <p className="mt-0.5 text-sm leading-6 text-zinc-500">
            存下來的報表。每次開啟都會用你自己的權限重新查詢，不會顯示儲存當下的資料。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="重新載入模組列表"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {isLoading && modules.length === 0 ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="h-[104px] animate-pulse bg-zinc-100" />
              <div className="space-y-2 px-3 py-3">
                <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-full animate-pulse rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <ModuleCard key={module.module_id} module={module} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
