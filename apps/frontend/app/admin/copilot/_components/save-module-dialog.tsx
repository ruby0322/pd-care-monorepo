"use client";

import { X } from "lucide-react";
import { useState } from "react";

import type { CopilotVisibility } from "@/lib/api/copilot";

import { VISIBILITY_OPTIONS } from "./copilot-new-session-dialog";

export function SaveModuleDialog({
  role,
  canShare,
  isSubmitting,
  onClose,
  onSave,
}: {
  role: "staff" | "admin";
  /**
   * Whether this report may be saved at anything but `private`. False for a report whose
   * figures are baked in: the backend refuses to store one as shared, because it would show
   * the author's rows to every viewer instead of each viewer's own.
   */
  canShare: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (payload: { title: string; description?: string; visibility: CopilotVisibility }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CopilotVisibility>("private");

  const options = VISIBILITY_OPTIONS.filter((option) => !option.adminOnly || role === "admin");
  const trimmedTitle = title.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">儲存為模組</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="關閉"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-500">標題</span>
          <input
            type="text"
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：三月感染趨勢分析"
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-400"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-500">描述（可留空）</span>
          <textarea
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="這個模組顯示什麼、適合在什麼情境下重新使用"
            className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-400"
          />
        </label>

        <fieldset className="mb-5">
          <legend className="mb-1.5 text-xs text-zinc-500">可見度</legend>
          <div className="space-y-1.5">
            {options.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                  !canShare && option.value !== "private"
                    ? "cursor-not-allowed border-zinc-200 opacity-50"
                    : visibility === option.value
                      ? "cursor-pointer border-zinc-900 bg-zinc-50"
                      : "cursor-pointer border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <input
                  type="radio"
                  name="module-visibility"
                  value={option.value}
                  checked={visibility === option.value}
                  disabled={!canShare && option.value !== "private"}
                  onChange={() => setVisibility(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-zinc-800">{option.label}</span>
                  <span className="block text-xs text-zinc-400">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {canShare ? (
            <p className="mt-2 text-xs text-zinc-400">分享出去的模組對其他人唯讀；日後更新內容請重新儲存。</p>
          ) : (
            <p className="mt-2 text-xs text-amber-600">
              這份報表的數字是產生當下就寫死的，沒有在執行時重新查詢，所以只能存成「僅自己」——
              分享出去的話每個人看到的都會是你的病患資料，而不是他們自己的。
              想分享請回到對話，請 Copilot 改成執行時自行查詢資料的版本。
            </p>
          )}
        </fieldset>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100"
          >
            取消
          </button>
          <button
            type="button"
            disabled={isSubmitting || !trimmedTitle}
            onClick={() => onSave({ title: trimmedTitle, description: description.trim() || undefined, visibility })}
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {isSubmitting ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}
