"use client";

import {
  ArrowDown,
  ArrowUp,
  Eye,
  Lock,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { shouldSendOnEnter } from "@/app/admin/copilot/_components/composer-keys";
import { getReadableApiError } from "@/lib/api/client";
import {
  createCopilotSession,
  deleteCopilotSession,
  fetchCopilotModels,
  fetchCopilotSession,
  fetchCopilotSessions,
  streamCopilotMessage,
  type CopilotHandleLabel,
  type CopilotSessionDetail,
  type CopilotSessionSummary,
  type CopilotToolTraceEntry,
  type CopilotVisibility,
} from "@/lib/api/copilot";
import { getStaffRole } from "@/lib/auth/staff-session";
import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

import {
  buildAutoRepairPrompt,
  buildManualRepairPrompt,
  type ArtifactErrorMessage,
} from "./_components/artifact-bridge";
import { CopilotMessage, type CopilotMessageViewModel } from "./_components/copilot-message";
import { CopilotNewSessionDialog } from "./_components/copilot-new-session-dialog";

const VISIBILITY_META: Record<CopilotVisibility, { label: string; Icon: typeof Lock }> = {
  private: { label: "僅自己", Icon: Lock },
  staff: { label: "護理師可見", Icon: Users },
  admin: { label: "管理員可見", Icon: Shield },
};

const SUGGESTIONS = [
  { title: "今日需關注", prompt: "今天有哪些病患需要優先關注？" },
  { title: "近期疑似感染", prompt: "給我看最近幾筆疑似感染的病患上傳" },
  { title: "三個月感染趨勢", prompt: "請幫我分析近三個月所有病患的感染趨勢" },
  { title: "即時趨勢圖表", prompt: "做一份近 90 天感染趨勢的即時圖表" },
];

/** A broken report gets this many automatic repair rounds before it falls back to the button. */
const MAX_AUTO_REPAIRS = 2;

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
  // Handle -> label map for one session, held in page state (rather than derived inline)
  // because a handle can be minted mid-turn, after its own text has already streamed in:
  // the `handle` SSE event lands late and this state update is what makes the
  // already-rendered text pick up the label on the next render.
  //
  // It carries its own `sessionId` and is read through `activeHandles` below, the same
  // staleness guard `detail` gets from `activeDetail`. A flat map could outlive its
  // session: switching from A to B while B's fetch fails (the catch only toasts) left A's
  // map in place, and B's `P#1` then rendered under A's patient's name — one patient's
  // data labelled with another patient's identity, which is worse than showing no label.
  const [handles, setHandles] = useState<{ sessionId: number; map: Record<string, CopilotHandleLabel> } | null>(
    null,
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRailOpen, setIsRailOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const autoRepairCountRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const compositionGenerationRef = useRef(0);

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

  // Tracks the most recently *requested* session, independent of resolution order. The
  // `activeDetail` / `activeHandles` guards below already stop a mismatched payload being
  // *displayed*, but they do not stop it being stored: a slow fetch for session A landing
  // after a fast one for B still wrote `detail = A` and flipped `isLoadingDetail` off, so
  // `activeDetail` evaluated null with nothing in flight and the thread sat as a skeleton
  // until the nurse clicked the session again. `handleSend`'s trailing `loadDetail` is a
  // second producer of that interleaving. Same guard as `/admin/modules`.
  const latestRequestedSessionIdRef = useRef<number | null>(null);

  const loadDetail = useCallback(async (sessionId: number) => {
    latestRequestedSessionIdRef.current = sessionId;
    setIsLoadingDetail(true);
    try {
      const result = await fetchCopilotSession(sessionId);
      if (latestRequestedSessionIdRef.current !== sessionId) {
        return;
      }
      setDetail(result);
      setHandles({ sessionId, map: result.handles });
    } catch (error) {
      if (latestRequestedSessionIdRef.current !== sessionId) {
        return;
      }
      // Keyed to the session that failed, not left as whatever was there before: no labels
      // is correct here, a previous session's labels never are.
      setHandles({ sessionId, map: {} });
      toast.error(getReadableApiError(error));
    } finally {
      if (latestRequestedSessionIdRef.current === sessionId) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadDetail(activeSessionId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, loadDetail]);

  const activeDetail = detail !== null && detail.session.session_id === activeSessionId ? detail : null;
  const activeHandles = useMemo<Record<string, CopilotHandleLabel>>(
    () => (handles !== null && handles.sessionId === activeSessionId ? handles.map : {}),
    [handles, activeSessionId],
  );

  const messages = useMemo<CopilotMessageViewModel[]>(() => {
    const persisted = (activeDetail?.messages ?? []).map<CopilotMessageViewModel>((message) => ({
      key: `m-${message.message_id}`,
      role: message.role,
      content: message.content,
      toolTrace: message.tool_trace,
      messageId: message.message_id,
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

  // Only follow the stream while the reader is already at the bottom, and jump
  // instantly: a smooth scroll restarts on every token, so the animations pile up and
  // fight both each other and any manual scrolling.
  useEffect(() => {
    if (!isPinnedToBottom) {
      return;
    }
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, isPinnedToBottom]);

  const canWrite = activeDetail?.session.can_write ?? false;
  const isTranscriptPending = activeSessionId !== null && (isLoadingDetail || activeDetail === null);

  function resizeComposer() {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }

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

  async function handleSend(content: string, options?: { isAutoRepair?: boolean }) {
    const trimmed = content.trim();
    if (!trimmed || activeSessionId === null || streaming || !canWrite) {
      return;
    }
    if (!options?.isAutoRepair) {
      // A fresh question starts the repair budget over.
      autoRepairCountRef.current = 0;
    }
    const sessionId = activeSessionId;
    setInput("");
    window.setTimeout(resizeComposer, 0);
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
          if (event.type === "handle") {
            // Minted mid-turn, after its own handle may already have streamed into
            // `text` as a bare "P#3" — merging it here is what makes the already
            // -rendered text pick up the label once this re-renders. Merged only into
            // *this* session's map: if the reader switched away mid-stream, the handle
            // belongs to the session being streamed, not the one on screen, and the
            // final `loadDetail` below refetches whichever one is displayed.
            setHandles((current) =>
              current !== null && current.sessionId === sessionId
                ? {
                    sessionId,
                    map: {
                      ...current.map,
                      [event.handle]: { entity_type: event.entity_type, label: event.label },
                    },
                  }
                : current,
            );
          }
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

  /**
   * Manual fallback: the reader asks for a repair explicitly, so the full error text goes
   * with it — a human has already read it on screen and chosen to send it.
   */
  function handleRequestRepair(errors: ArtifactErrorMessage[]) {
    autoRepairCountRef.current = 0;
    void handleSend(buildManualRepairPrompt(errors));
  }

  /**
   * Automatic repair. Capped, because the assistant regenerating a report that throws again
   * would otherwise loop indefinitely on an error it cannot fix.
   *
   * Sends `buildAutoRepairPrompt`, which carries only the error type and location: this
   * fires with no nurse action at all, and the error text it would otherwise quote was
   * produced inside a frame holding identified patient data.
   */
  function handleAutoRepair(errors: ArtifactErrorMessage[]): boolean {
    if (!canWrite || streaming || activeSessionId === null) {
      return false;
    }
    if (autoRepairCountRef.current >= MAX_AUTO_REPAIRS) {
      return false;
    }
    autoRepairCountRef.current += 1;
    void handleSend(buildAutoRepairPrompt(errors), { isAutoRepair: true });
    return true;
  }

  if (isCopilotEnabled === false) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
          <Sparkles className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1.5 text-base font-semibold text-zinc-900">PD Copilot 目前無法使用</h1>
        <p className="text-sm leading-6 text-zinc-500">
          後端回報此功能未啟用或無法連線。請確認 <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">COPILOT_ENABLED</code> 與{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">OPENAI_API_KEY</code> 已設定，且後端服務正常。
        </p>
      </div>
    );
  }

  const greeting = activeDetail?.session.title ?? "PD Copilot";

  return (
    <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] overflow-hidden bg-white">
      {/* Session rail */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/60 transition-all duration-200 md:flex ${
          isRailOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="px-3 pt-4 pb-2">
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            disabled={models.length === 0}
            className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
            新對話
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sessions.length === 0 ? (
            <p className="px-3 py-6 text-xs leading-5 text-zinc-400">還沒有任何對話。建立一個開始分析。</p>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map((session) => {
                const { label, Icon } = VISIBILITY_META[session.visibility];
                const isActive = session.session_id === activeSessionId;
                return (
                  <li key={session.session_id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setActiveSessionId(session.session_id)}
                      className={`w-full rounded-lg px-3 py-2 pr-8 text-left transition-colors ${
                        isActive ? "bg-zinc-200/70" : "hover:bg-zinc-200/40"
                      }`}
                    >
                      <span
                        className={`block truncate text-sm ${
                          isActive ? "font-medium text-zinc-900" : "text-zinc-600"
                        }`}
                      >
                        {session.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                        <Icon className="h-3 w-3" strokeWidth={1.5} />
                        {label}
                        {session.is_owner ? null : (
                          <>
                            <span className="text-zinc-300">·</span>
                            {session.owner_name ?? "他人"}
                          </>
                        )}
                      </span>
                    </button>
                    {session.is_owner ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(session.session_id)}
                        className="absolute top-2 right-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors group-hover:flex hover:bg-zinc-300/50 hover:text-zinc-700"
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

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 px-4">
          <button
            type="button"
            onClick={() => setIsRailOpen((value) => !value)}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 md:inline-flex"
            aria-label={isRailOpen ? "收合對話列表" : "展開對話列表"}
          >
            {isRailOpen ? (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium text-zinc-900">{greeting}</h1>
          </div>
          {activeDetail ? (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 sm:inline-flex">
              {activeDetail.session.model}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            disabled={models.length === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 md:hidden"
            aria-label="新對話"
          >
            <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        {activeDetail && !canWrite ? (
          <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-500">
            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            這是 {activeDetail.session.owner_name ?? "其他人"} 的對話，唯讀檢視
          </div>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
            setIsPinnedToBottom(distanceFromBottom < 80);
          }}
          className="relative min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-8">
            {activeSessionId === null ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900">
                  <Sparkles className="h-5 w-5 text-white" strokeWidth={1.5} />
                </div>
                <h2 className="mb-1.5 text-xl font-semibold tracking-tight text-zinc-900">有什麼需要分析的？</h2>
                <p className="mb-8 max-w-sm text-sm leading-6 text-zinc-500">
                  Copilot 只會讀取你有權限查看的資料，並且不會修改任何東西。
                </p>
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(true)}
                  disabled={models.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                >
                  <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
                  建立新對話
                </button>
              </div>
            ) : isTranscriptPending && messages.length === 0 ? (
              <div className="space-y-4 py-4">
                <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
              </div>
            ) : messages.length === 0 ? (
              <div className="py-10">
                <h2 className="mb-1.5 text-xl font-semibold tracking-tight text-zinc-900">有什麼需要分析的？</h2>
                <p className="mb-7 text-sm leading-6 text-zinc-500">
                  用自然語言提問，Copilot 會自己拆解並查詢資料。
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item.prompt}
                      type="button"
                      onClick={() => void handleSend(item.prompt)}
                      disabled={!canWrite}
                      className="group rounded-xl border border-zinc-200 px-3.5 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <span className="block text-sm font-medium text-zinc-800">{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{item.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((message) => (
                  <CopilotMessage
                    key={message.key}
                    message={message}
                    handles={activeHandles}
                    role={role}
                    sessionId={activeSessionId ?? undefined}
                    onRequestRepair={handleRequestRepair}
                    onAutoRepair={handleAutoRepair}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        {activeSessionId !== null ? (
          <div className="relative shrink-0 bg-gradient-to-t from-white via-white to-transparent px-4 pb-4">
            {!isPinnedToBottom && messages.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const node = scrollRef.current;
                  if (node) {
                    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
                  }
                  setIsPinnedToBottom(true);
                }}
                className="absolute -top-5 left-1/2 inline-flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-md transition-colors hover:text-zinc-900"
                aria-label="捲動到最新訊息"
              >
                <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : null}
            <div className="mx-auto w-full max-w-3xl">
              <form
                className={`flex items-end gap-2 rounded-2xl border bg-white p-2 pl-4 shadow-sm transition-colors ${
                  canWrite ? "border-zinc-200 focus-within:border-zinc-400" : "border-zinc-100 bg-zinc-50"
                }`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend(input);
                }}
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    resizeComposer();
                  }}
                  onCompositionStart={() => {
                    compositionGenerationRef.current += 1;
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    // Safari dispatches the candidate-picking Enter's keydown right after
                    // compositionend, so the flag has to outlive this task to catch it. The
                    // generation guard keeps that delay from clearing a *later* composition:
                    // committing one word and starting the next within the same task would
                    // otherwise leave this timer to unset the flag mid-compose, and Safari
                    // has no native flag to fall back on.
                    const generation = compositionGenerationRef.current;
                    setTimeout(() => {
                      if (compositionGenerationRef.current === generation) {
                        isComposingRef.current = false;
                      }
                    }, 0);
                  }}
                  onKeyDown={(event) => {
                    if (shouldSendOnEnter(event, isComposingRef.current)) {
                      event.preventDefault();
                      void handleSend(input);
                    }
                  }}
                  rows={1}
                  maxLength={8000}
                  disabled={!canWrite || Boolean(streaming)}
                  placeholder={canWrite ? "問 PD Copilot…" : "唯讀對話，無法提問"}
                  className="max-h-[200px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
                />
                {streaming ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-700"
                    aria-label="停止產生"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canWrite || !input.trim()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-all hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400"
                    aria-label="送出"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </form>
              <p className="mt-2 text-center text-[11px] leading-4 text-zinc-400">
                Copilot 可能會出錯，臨床判斷請以病歷與專業評估為準。
              </p>
            </div>
          </div>
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
