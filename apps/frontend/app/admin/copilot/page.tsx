"use client";

import {
  ArrowDown,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Trash2,
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
import { CopilotComposer } from "./_components/copilot-composer";
import { groupSessions } from "./_components/session-groups";
import { VISIBILITY_META } from "./_components/visibility-meta";
import { visibilityOptionsFor } from "./_components/visibility-options";

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
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  // What the create screen will open the next thread with. A thread is created by asking a
  // question, so these have to live until that first send rather than inside a dialog.
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftVisibility, setDraftVisibility] = useState<CopilotVisibility>("private");
  const [isCreating, setIsCreating] = useState(false);
  const [isRailOpen, setIsRailOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const autoRepairCountRef = useRef(0);

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

  /**
   * Opens a thread with its first question, which is the only way a thread is created now.
   *
   * The session is created first and the question sent into it, so a failed creation leaves
   * nothing behind and the composer keeps the text (it clears only on a `true`). A creation
   * that succeeds and a send that then fails leaves an empty thread, which the reader can
   * simply ask again in -- better than silently discarding what they typed.
   */
  async function handleCreateAndSend(content: string): Promise<boolean> {
    if (!content.trim() || isCreating) {
      return false;
    }
    const model = draftModel ?? defaultModel ?? models[0];
    if (!model) {
      toast.error("沒有可用的模型，無法建立對話。");
      return false;
    }
    setIsCreating(true);
    let created: CopilotSessionSummary;
    try {
      created = await createCopilotSession({ model, visibility: draftVisibility });
    } catch (error) {
      toast.error(getReadableApiError(error));
      return false;
    } finally {
      setIsCreating(false);
    }
    setSessions((current) => [created, ...current]);
    setActiveSessionId(created.session_id);
    setDetail({ session: created, messages: [], handles: {} });
    setHandles({ sessionId: created.session_id, map: {} });
    await handleSend(content, { sessionId: created.session_id, canWriteOverride: true });
    return true;
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

  /**
   * Sends one question. Returns whether it went out, which is what lets the composer keep
   * the text on a refusal instead of swallowing it.
   *
   * `sessionId`/`canWriteOverride` exist for the create path: it has just created a session
   * and cannot wait for `activeSessionId` and `canWrite` to come back through React state.
   */
  async function handleSend(
    content: string,
    options?: { isAutoRepair?: boolean; sessionId?: number; canWriteOverride?: boolean },
  ): Promise<boolean> {
    const trimmed = content.trim();
    const sessionId = options?.sessionId ?? activeSessionId;
    if (!trimmed || sessionId === null || streaming || !(options?.canWriteOverride ?? canWrite)) {
      return false;
    }
    if (!options?.isAutoRepair) {
      // A fresh question starts the repair budget over.
      autoRepairCountRef.current = 0;
    }
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
          if (event.type === "session_title") {
            // The first turn's name, chosen after the answer. Applied in place so the rail
            // stops showing the truncated question without refetching the whole list.
            const title = event.title;
            setSessions((current) =>
              current.map((item) => (item.session_id === sessionId ? { ...item, title } : item)),
            );
            setDetail((current) =>
              current && current.session.session_id === sessionId
                ? { ...current, session: { ...current.session, title } }
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
    return true;
  }

  /**
   * Manual repair. Carries the full error text, the location in the report's own source and
   * the code at that location -- everything the automatic path withholds, because a nurse
   * read the error and chose to send it.
   */
  function handleRequestRepair(errors: ArtifactErrorMessage[], html: string) {
    autoRepairCountRef.current = 0;
    void handleSend(buildManualRepairPrompt(errors, html));
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
  const DraftVisibilityIcon = VISIBILITY_META[draftVisibility].Icon;

  return (
    <div className="-mx-3 -my-6 flex h-[calc(100vh-4.5rem)] overflow-hidden bg-white">
      {/* Session rail */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/60 transition-all duration-200 md:flex ${
          isRailOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="sticky top-0 z-10 bg-zinc-50/80 px-3 pt-4 pb-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setActiveSessionId(null)}
            disabled={models.length === 0}
            className="group flex w-full items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            新對話
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sessions.length === 0 ? (
            <p className="px-3 py-6 text-xs leading-5 text-zinc-400">還沒有任何對話。問一個問題就會開始。</p>
          ) : (
            groupSessions(sessions).map((group) => (
              <div key={group.key} className="mb-3">
                <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-zinc-400">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const { label, Icon } = VISIBILITY_META[session.visibility];
                    const isActive = session.session_id === activeSessionId;
                    // Only a thread someone else can open needs its scope spelled out; a
                    // private one would otherwise print the same noise on every row.
                    const showScope = session.visibility !== "private" || !session.is_owner;
                    return (
                      <li key={session.session_id} className="group relative">
                        <button
                          type="button"
                          onClick={() => setActiveSessionId(session.session_id)}
                          className={`w-full rounded-lg py-2 pr-9 pl-3 text-left transition-colors ${
                            isActive ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white/70"
                          }`}
                        >
                          {isActive ? (
                            <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-zinc-900" />
                          ) : null}
                          <span
                            className={`block truncate text-sm ${
                              isActive ? "font-medium text-zinc-900" : "text-zinc-600"
                            }`}
                          >
                            {session.title}
                          </span>
                          {showScope ? (
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
                          ) : null}
                        </button>
                        {session.is_owner ? (
                          <button
                            type="button"
                            onClick={() => void handleDelete(session.session_id)}
                            // Always in the layout, only visible on hover or keyboard focus:
                            // appearing on hover used to reflow the title it sits next to.
                            className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-zinc-200/70 hover:text-zinc-700"
                            aria-label={`刪除對話「${session.title}」`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
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
            onClick={() => setActiveSessionId(null)}
            disabled={models.length === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 md:hidden"
            aria-label="新對話"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
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
              <div className="flex min-h-[60vh] flex-col justify-center py-10">
                <div className="mb-6 flex flex-col items-center text-center">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900">
                    <Sparkles className="h-5 w-5 text-white" strokeWidth={1.5} />
                  </div>
                  <h2 className="mb-1.5 text-2xl font-semibold tracking-tight text-zinc-900">
                    有什麼需要分析的？
                  </h2>
                  <p className="max-w-sm text-sm leading-6 text-zinc-500">
                    直接問就會開啟新對話。Copilot 只讀取你有權限查看的資料，不會修改任何東西。
                  </p>
                </div>

                <CopilotComposer
                  onSend={handleCreateAndSend}
                  canWrite={models.length > 0 && !isCreating}
                  placeholder="問 PD Copilot…"
                  readOnlyPlaceholder={isCreating ? "正在建立對話…" : "目前沒有可用的模型"}
                  autoFocus
                >
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white py-1 pr-1 pl-2.5 text-xs text-zinc-500 transition-colors focus-within:border-zinc-400">
                    <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span className="sr-only">模型</span>
                    <select
                      value={draftModel ?? defaultModel ?? ""}
                      onChange={(event) => setDraftModel(event.target.value)}
                      className="max-w-[9rem] bg-transparent py-0.5 pr-1 text-xs text-zinc-700 outline-none"
                    >
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white py-1 pr-1 pl-2.5 text-xs text-zinc-500 transition-colors focus-within:border-zinc-400">
                    <DraftVisibilityIcon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span className="sr-only">可見範圍</span>
                    <select
                      value={draftVisibility}
                      onChange={(event) => setDraftVisibility(event.target.value as CopilotVisibility)}
                      className="bg-transparent py-0.5 pr-1 text-xs text-zinc-700 outline-none"
                    >
                      {visibilityOptionsFor(role).map((option) => (
                        <option key={option.value} value={option.value}>
                          {VISIBILITY_META[option.value].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </CopilotComposer>

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item.prompt}
                      type="button"
                      onClick={() => void handleCreateAndSend(item.prompt)}
                      disabled={models.length === 0 || isCreating}
                      className="rounded-xl border border-zinc-200 px-3.5 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <span className="block text-sm font-medium text-zinc-800">{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{item.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : isTranscriptPending && messages.length === 0 ? (
              <div className="space-y-4 py-4">
                <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
              </div>
            ) : messages.length === 0 ? (
              // The create screen asks "有什麼需要分析的？" and carries the suggestions; a
              // thread that exists but holds nothing (its first send failed, or it was
              // emptied) only needs to say so.
              <p className="py-10 text-sm leading-6 text-zinc-400">這個對話還沒有訊息，直接提問就會開始。</p>
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
              <CopilotComposer
                onSend={(content) => handleSend(content)}
                isStreaming={Boolean(streaming)}
                onStop={() => abortRef.current?.abort()}
                canWrite={canWrite}
              />
              <p className="mt-2 text-center text-[11px] leading-4 text-zinc-400">
                Copilot 可能會出錯，臨床判斷請以病歷與專業評估為準。
              </p>
            </div>
          </div>
        ) : null}
      </section>

    </div>
  );
}
