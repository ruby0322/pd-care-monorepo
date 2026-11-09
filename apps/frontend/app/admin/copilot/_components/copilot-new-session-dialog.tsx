"use client";

import { X } from "lucide-react";
import { useState } from "react";

import type { CopilotVisibility } from "@/lib/api/copilot";

export const VISIBILITY_OPTIONS: Array<{
  value: CopilotVisibility;
  label: string;
  hint: string;
  adminOnly?: boolean;
}> = [
  { value: "private", label: "僅自己可見", hint: "只有你能看到。" },
  { value: "staff", label: "護理師與管理員可見", hint: "其他護理師與管理員可唯讀檢視。" },
  { value: "admin", label: "僅管理員可見", hint: "只有管理員可唯讀檢視。", adminOnly: true },
];

export function CopilotNewSessionDialog({
  models,
  defaultModel,
  role,
  isSubmitting,
  onClose,
  onCreate,
}: {
  models: string[];
  defaultModel: string | null;
  role: "staff" | "admin";
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: { title?: string; model: string; visibility: CopilotVisibility }) => void;
}) {
  const [title, setTitle] = useState("");
  const [model, setModel] = useState(defaultModel ?? models[0] ?? "");
  const [visibility, setVisibility] = useState<CopilotVisibility>("private");

  const options = VISIBILITY_OPTIONS.filter((option) => !option.adminOnly || role === "admin");

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">新對話</h2>
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
          <span className="mb-1 block text-xs text-zinc-500">標題（可留空，會自動以第一句提問命名）</span>
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
          <span className="mb-1 block text-xs text-zinc-500">模型</span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-400"
          >
            {models.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mb-5">
          <legend className="mb-1.5 text-xs text-zinc-500">可見度</legend>
          <div className="space-y-1.5">
            {options.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                  visibility === option.value ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={option.value}
                  checked={visibility === option.value}
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
          <p className="mt-2 text-xs text-zinc-400">分享出去的對話對其他人唯讀，只有你能繼續提問。</p>
          {/* The handle gate hides patient names in what the *model* wrote; it cannot touch
              the viewer's own user-role turns, which render verbatim for everyone who can
              read the transcript. */}
          <p className="mt-1 text-xs text-amber-600">
            分享會一併公開你自己輸入的內容。若對話中打過病患姓名或病歷號，請選「僅自己可見」。
          </p>
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
            disabled={isSubmitting || !model}
            onClick={() => onCreate({ title: title.trim() || undefined, model, visibility })}
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {isSubmitting ? "建立中…" : "建立"}
          </button>
        </div>
      </div>
    </div>
  );
}
