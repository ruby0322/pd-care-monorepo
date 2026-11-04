"use client";

import {
  Eye,
  Lock,
  MessageSquarePlus,
  Send,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import {
  createCopilotSession,
  deleteCopilotSession,
  fetchCopilotModels,
  fetchCopilotSession,
  fetchCopilotSessions,
  streamCopilotMessage,
  type CopilotSessionDetail,
  type CopilotSessionSummary,
  type CopilotToolTraceEntry,
  type CopilotVisibility,
} from "@/lib/api/copilot";
import { getStaffRole } from "@/lib/auth/staff-session";
import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

import { CopilotMessage, type CopilotMessageViewModel } from "./_components/copilot-message";
import { CopilotNewSessionDialog } from "./_components/copilot-new-session-dialog";

const VISIBILITY_META: Record<CopilotVisibility, { label: string; Icon: typeof Lock }> = {
  private: { label: "僅自己", Icon: Lock },
  staff: { label: "護理師可見", Icon: Users },
  admin: { label: "管理員可見", Icon: Shield },
};

const EXAMPLE_PROMPTS = [
  "給我看最近幾筆疑似感染的病患上傳",
  "請幫我分析近三個月所有病患的感染趨勢",
  "今天有哪些病患需要優先關注？",
  "做一份近 90 天感染趨勢的即時圖表",
];

type StreamingState = {
  text: string;
  toolTrace: CopilotToolTraceEntry[];
  pendingTool: string | null;
};

export default function CopilotPage() {
  const role = useClientSnapshot<"staff" | "admin">(() => getStaffRole() ?? "staff", "staff");
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [isCopilotEnabled, setIsCopilotEnabled] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<CopilotSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CopilotSessionDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [modelsResponse, sessionList] = await Promise.all([fetchCopilotModels(), fetchCopilotSessions()]);
        if (cancelled) {
          return;
        }
        setIsCopilotEnabled(modelsResponse.enabled);
        setModels(modelsResponse.models);
        setDefaultModel(modelsResponse.default_model);
        setSessions(sessionList);
        setActiveSessionId((current) => current ?? sessionList[0]?.session_id ?? null);
      } catch (error) {
        if (!cancelled) {
          setIsCopilotEnabled(false);
          toast.error(getReadableApiError(error));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDetail = useCallback(async (sessionId: number) => {
    setIsLoadingDetail(true);
    try {
      setDetail(await fetchCopilotSession(sessionId));
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    // Deferred by a tick, matching the loading pattern used elsewhere in /admin, so the
    // fetch's setState does not run synchronously inside the effect body.
    const timer = window.setTimeout(() => {
      void loadDetail(activeSessionId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, loadDetail]);

  const activeDetail = detail !== null && detail.session.session_id === activeSessionId ? detail : null;

  const messages = useMemo<CopilotMessageViewModel[]>(() => {
    const persisted = (activeDetail?.messages ?? []).map<CopilotMessageViewModel>((message) => ({
      key: `m-${message.message_id}`,
      role: message.role,
      content: message.content,
      toolTrace: message.tool_trace,
    }));
    if (streaming) {
      persisted.push({
        key: "streaming",
        role: "assistant",
        content: streaming.text,
        toolTrace: streaming.toolTrace,
        pendingTool: streaming.pendingTool,
        isStreaming: true,
      });
    }
    return persisted;
  }, [activeDetail, streaming]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const canWrite = activeDetail?.session.can_write ?? false;
  // The fetch is deferred by a tick, so "selected but no matching transcript yet" is also
  // pending — without this the empty state flashes when switching sessions.
  const isTranscriptPending = activeSessionId !== null && (isLoadingDetail || activeDetail === null);

  async function handleCreate(payload: { title?: string; model: string; visibility: CopilotVisibility }) {
    setIsCreating(true);
    try {
      const created = await createCopilotSession(payload);
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.session_id);
      setIsDialogOpen(false);
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(sessionId: number) {
    if (!window.confirm("刪除這個對話？此動作無法復原。")) {
      return;
    }
    try {
      await deleteCopilotSession(sessionId);
      setSessions((current) => current.filter((item) => item.session_id !== sessionId));
      setActiveSessionId((current) => (current === sessionId ? null : current));
    } catch (error) {
      toast.error(getReadableApiError(error));
    }
  }

  async function handleSend(content: string) {
    const trimmed = content.trim();
    if (!trimmed || activeSessionId === null || streaming) {
      return;
    }
    const sessionId = activeSessionId;
    setInput("");
    setDetail((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              {
                message_id: -Date.now(),
                role: "user",
                content: trimmed,
                model: null,
                tool_trace: [],
                created_at: new Date().toISOString(),
              },
            ],
          }
        : current,
    );
    setStreaming({ text: "", toolTrace: [], pendingTool: null });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamCopilotMessage(
        sessionId,
        trimmed,
        (event) => {
          setStreaming((current) => {
            if (!current) {
              return current;
            }
            switch (event.type) {
              case "token":
                return { ...current, text: current.text + event.text };
              case "tool_call":
                return { ...current, pendingTool: event.tool };
              case "tool_result":
                return {
                  ...current,
                  pendingTool: null,
                  toolTrace: [
                    ...current.toolTrace,
                    {
                      tool: event.tool,
                      ok: event.ok,
                      status: event.status,
                      truncated: event.truncated,
                      duration_ms: event.duration_ms,
                    },
                  ],
                };
              case "message_saved":
                return { ...current, text: event.content, toolTrace: event.tool_trace, pendingTool: null };
              default:
                return current;
            }
          });
          if (event.type === "error") {
            toast.error(event.message);
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "送出失敗");
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      await loadDetail(sessionId);
      try {
        setSessions(await fetchCopilotSessions());
      } catch {
        // The transcript is already refreshed; a stale sidebar is not worth an error toast.
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  if (isCopilotEnabled === false) {
    return (
      <div className="mx-auto max-w-2xl px-1 py-10">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
          <Sparkles className="mx-auto mb-3 h-6 w-6 text-zinc-300" strokeWidth={1.5} />
          <h1 className="mb-1 text-sm font-semibold text-zinc-900">PD Copilot 尚未啟用</h1>
          <p className="text-sm text-zinc-500">
            請在後端設定 <code className="rounded bg-zinc-100 px-1">COPILOT_ENABLED=true</code> 與{" "}
            <code className="rounded bg-zinc-100 px-1">OPENAI_API_KEY</code> 後重新啟動服務。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-6xl gap-4 px-1">
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          disabled={models.length === 0}
          className="mb-3 inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
          新對話
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-400">還沒有任何對話。</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => {
                const { label, Icon } = VISIBILITY_META[session.visibility];
                const isActive = session.session_id === activeSessionId;
                return (
                  <li key={session.session_id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setActiveSessionId(session.session_id)}
                      className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                        isActive ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      <span className="block truncate text-sm">{session.title}</span>
                      <span
                        className={`mt-0.5 flex items-center gap-1 text-xs ${
                          isActive ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        <Icon className="h-3 w-3" strokeWidth={1.5} />
                        {label}
                        {session.is_owner ? null : (
                          <>
                            <Eye className="ml-0.5 h-3 w-3" strokeWidth={1.5} />
                            {session.owner_name ?? "他人"}
                          </>
                        )}
                      </span>
                    </button>
                    {session.is_owner ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(session.session_id)}
                        className={`absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-lg group-hover:flex ${
                          isActive ? "text-zinc-300 hover:bg-zinc-700" : "text-zinc-400 hover:bg-zinc-200"
                        }`}
                        aria-label="刪除對話"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-zinc-200 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-900">
              {activeDetail?.session.title ?? "PD Copilot"}
            </h1>
            <p className="text-xs text-zinc-400">
              {activeDetail
                ? `${activeDetail.session.model}・${VISIBILITY_META[activeDetail.session.visibility].label}`
                : "資料分析助理"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            disabled={models.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 md:hidden"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
            新對話
          </button>
        </header>

        {activeDetail && !canWrite ? (
          <p className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-500">
            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            這是 {activeDetail.session.owner_name ?? "其他人"} 的對話，唯讀檢視。
          </p>
        ) : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {activeSessionId === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <Sparkles className="h-7 w-7 text-zinc-300" strokeWidth={1.5} />
              <div>
                <p className="text-sm text-zinc-600">建立一個新對話開始分析</p>
                <p className="mt-1 text-xs text-zinc-400">Copilot 只會讀取你有權限查看的資料。</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                disabled={models.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3.5 py-2 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
                新對話
              </button>
            </div>
          ) : isTranscriptPending && messages.length === 0 ? (
            <p className="text-sm text-zinc-400">載入中…</p>
          ) : messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500">試試這些問題：</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void handleSend(prompt)}
                    disabled={!canWrite}
                    className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => <CopilotMessage key={message.key} message={message} />)
          )}
          <div ref={threadEndRef} />
        </div>

        {activeSessionId !== null ? (
          <form
            className="flex items-end gap-2 border-t border-zinc-100 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend(input);
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(input);
                }
              }}
              rows={1}
              maxLength={8000}
              disabled={!canWrite || Boolean(streaming)}
              placeholder={canWrite ? "問 PD Copilot…（Shift + Enter 換行）" : "唯讀對話，無法提問"}
              className="max-h-40 min-h-[40px] flex-1 resize-y rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-900 disabled:bg-zinc-50"
            />
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50"
                aria-label="停止產生"
              >
                <Square className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canWrite || !input.trim()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
                aria-label="送出"
              >
                <Send className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </form>
        ) : null}
      </section>

      {isDialogOpen ? (
        <CopilotNewSessionDialog
          models={models}
          defaultModel={defaultModel}
          role={role}
          isSubmitting={isCreating}
          onClose={() => setIsDialogOpen(false)}
          onCreate={(payload) => void handleCreate(payload)}
        />
      ) : null}
    </div>
  );
}
