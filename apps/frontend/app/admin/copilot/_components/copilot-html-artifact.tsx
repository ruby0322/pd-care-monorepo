"use client";

import { AlertTriangle, Code2, Download, Loader2, Maximize2, RefreshCw, Save, Wrench, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { queryCopilotProxy } from "@/lib/api/copilot";

import {
  buildArtifactDocument,
  isAllowedArtifactTool,
  parseArtifactError,
  parseArtifactQuery,
  type ArtifactErrorMessage,
} from "./artifact-bridge";

const MAX_CONCURRENT_QUERIES = 3;
const MIN_QUERY_INTERVAL_MS = 400;

type Props = {
  html: string;
  /** Live data is opt-in: an artifact only reaches the proxy once the user turns it on. */
  liveEnabled: boolean;
  /**
   * Omitted where the reader has no say over it -- a saved module always runs live, since
   * a module that only ever showed the day it was saved would be pointless. The 即時資料
   * control is then hidden rather than rendered as a button that does nothing.
   */
  onToggleLive?: (next: boolean) => void;
  /** Lets the thread offer to send the failure back so the assistant can repair its own HTML. */
  onRequestRepair?: (errors: ArtifactErrorMessage[]) => void;
  /**
   * Fires once per rendered report when its own JS throws, so the assistant can repair
   * without the reader having to notice and click. Returns false when the thread declines
   * (attempt cap reached, read-only, or a turn already running), which keeps the manual
   * button as the fallback.
   */
  onAutoRepair?: (errors: ArtifactErrorMessage[]) => boolean;
  /**
   * Offers to persist this report as a reusable module. Omitted entirely on a module's own
   * rendering (e.g. the modules browsing page), so a saved module cannot be re-saved from
   * itself; the thread that owns the save dialog and the API call supplies it instead.
   */
  onSaveAsModule?: (html: string) => void;
  /**
   * Set while the block's fence is still open, which is the one state in which the report is
   * not mounted at all: an unterminated `<script>` runs anyway at end of document, so a frame
   * fed an unfinished block executes a truncated report -- per streamed token while writing,
   * reloading under the reader's cursor. The source is shown instead.
   *
   * `"writing"` is the model still streaming it. `"truncated"` is a turn that ended without
   * closing the fence (stopped by the reader, or cut off), which stays unmounted for the same
   * reason: there is nothing to run but half a report, and running it would report faults
   * against code the model never finished writing.
   */
  incomplete?: "writing" | "truncated";
};

export function CopilotHtmlArtifact({
  html,
  liveEnabled,
  onToggleLive,
  onRequestRepair,
  onAutoRepair,
  onSaveAsModule,
  incomplete,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const draftRef = useRef<HTMLPreElement | null>(null);
  const [height, setHeight] = useState(320);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<ArtifactErrorMessage[]>([]);
  const [blockedWhileOff, setBlockedWhileOff] = useState(false);
  const [autoRepairState, setAutoRepairState] = useState<"idle" | "sent" | "declined">("idle");
  const autoRepairFiredRef = useRef(false);
  const inFlightRef = useRef(0);
  const lastQueryAtRef = useRef(0);

  const document_ = useMemo(() => (incomplete ? "" : buildArtifactDocument(html)), [html, incomplete]);

  const reply = useCallback(
    (frame: Window, id: string, payload: { ok: boolean; data?: unknown; error?: string }) => {
      // targetOrigin must be "*": a sandboxed frame without allow-same-origin has an
      // opaque origin that cannot be named. The payload only ever contains data this
      // user is already authorised to read, and the user's token stays in the parent.
      frame.postMessage({ type: "pdcare:result", id, ...payload }, "*");
    },
    [],
  );

  // Keeps the newest line of a report being written in view, the way a reader follows it.
  useEffect(() => {
    if (incomplete !== "writing") {
      return;
    }
    const node = draftRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [html, incomplete]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }

      const heightPayload = event.data as { type?: string; height?: number } | null;
      if (heightPayload && heightPayload.type === "pdcare:height" && typeof heightPayload.height === "number") {
        const next = Math.min(Math.max(heightPayload.height + 8, 160), 2400);
        setHeight((current) => (Math.abs(current - next) > 4 ? next : current));
        return;
      }

      const runtimeError = parseArtifactError(event.data);
      if (runtimeError) {
        setRuntimeErrors((current) =>
          current.some((item) => item.message === runtimeError.message) ? current : [...current, runtimeError],
        );
        return;
      }

      const query = parseArtifactQuery(event.data);
      if (!query) {
        return;
      }
      const target = frame.contentWindow;
      if (!target) {
        return;
      }

      if (!liveEnabled) {
        setBlockedWhileOff(true);
        reply(target, query.id, { ok: false, error: "即時資料未啟用，請在報表右上角開啟「即時資料」。" });
        return;
      }
      if (!isAllowedArtifactTool(query.tool)) {
        setLastError(`圖表嘗試呼叫未授權的查詢「${query.tool}」，已封鎖。`);
        reply(target, query.id, { ok: false, error: `Tool "${query.tool}" is not allowed.` });
        return;
      }
      if (inFlightRef.current >= MAX_CONCURRENT_QUERIES) {
        reply(target, query.id, { ok: false, error: "同時查詢過多，請稍後再試。" });
        return;
      }
      const now = Date.now();
      if (now - lastQueryAtRef.current < MIN_QUERY_INTERVAL_MS) {
        reply(target, query.id, { ok: false, error: "查詢過於頻繁，請稍後再試。" });
        return;
      }

      lastQueryAtRef.current = now;
      inFlightRef.current += 1;
      void queryCopilotProxy(query.tool, query.params)
        .then((result) => {
          if (!result.ok) {
            reply(target, query.id, { ok: false, error: `查詢被拒絕（HTTP ${result.status ?? "?"}）。` });
            return;
          }
          reply(target, query.id, { ok: true, data: result.data });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "查詢失敗";
          reply(target, query.id, { ok: false, error: message });
        })
        .finally(() => {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [liveEnabled, reply]);

  // Only script/promise faults are the report's own bug. A failed query means rate
  // limiting, missing permission or live data switched off -- regenerating the HTML cannot
  // fix any of those, so it stays a visible error rather than a silent retry.
  const repairableErrors = runtimeErrors.filter((item) => item.kind === "script" || item.kind === "promise");

  useEffect(() => {
    if (!onAutoRepair || autoRepairFiredRef.current || repairableErrors.length === 0) {
      return;
    }
    // Wait a beat so a report that throws several times reports them in one turn.
    const timer = window.setTimeout(() => {
      if (autoRepairFiredRef.current) {
        return;
      }
      autoRepairFiredRef.current = true;
      setAutoRepairState(onAutoRepair(repairableErrors) ? "sent" : "declined");
    }, 700);
    return () => window.clearTimeout(timer);
  }, [onAutoRepair, repairableErrors]);

  function downloadHtml() {
    const blob = new Blob([document_], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `pd-copilot-report-${Date.now()}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Exactly one iframe carries the ref, because the bridge only answers messages whose
  // `event.source` is that frame. Moving it into the fullscreen overlay remounts it
  // (a reload), which is preferable to a second frame whose queries silently hang.
  const frame = (
    <iframe
      key={reloadKey}
      ref={iframeRef}
      // No allow-same-origin: the frame gets an opaque origin, so it cannot touch
      // localStorage, cookies, or the parent DOM. Combined with connect-src 'none' in
      // the injected CSP, the postMessage bridge is its only path to data.
      sandbox="allow-scripts"
      srcDoc={document_}
      title="PD Copilot 報表"
      className="w-full border-0 bg-white"
      style={{ height: isFullscreen ? "100%" : `${height}px` }}
    />
  );

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2">
        {incomplete === "writing" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            報表編輯中
          </span>
        ) : incomplete === "truncated" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
            報表未完成
          </span>
        ) : (
          <span className="text-xs font-medium text-zinc-500">報表</span>
        )}
        {incomplete ? null : (
          <div className="flex items-center gap-1">
            {onToggleLive ? (
              <button
                type="button"
                onClick={() => {
                  if (!liveEnabled) {
                    setBlockedWhileOff(false);
                    setRuntimeErrors([]);
                    setReloadKey((key) => key + 1);
                  }
                  onToggleLive(!liveEnabled);
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
                  liveEnabled ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
                title="允許此報表即時向後端查詢資料"
              >
                <Zap className="h-3.5 w-3.5" strokeWidth={1.5} />
                即時資料
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setRuntimeErrors([]);
                setLastError(null);
                setReloadKey((key) => key + 1);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="重新整理報表"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setShowSource((value) => !value)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="檢視 HTML 原始碼"
            >
              <Code2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={downloadHtml}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="下載 HTML"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            {onSaveAsModule ? (
              <button
                type="button"
                onClick={() => onSaveAsModule(html)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="儲存為模組"
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="全螢幕檢視"
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {lastError ? (
        <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">{lastError}</p>
      ) : null}

      {blockedWhileOff && !liveEnabled && onToggleLive ? (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2.5">
          <Zap className="h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={1.5} />
          <p className="flex-1 text-xs text-amber-800">
            這份報表需要即時資料才能顯示內容，目前為關閉狀態。
          </p>
          <button
            type="button"
            onClick={() => {
              setBlockedWhileOff(false);
              setRuntimeErrors([]);
              setReloadKey((key) => key + 1);
              onToggleLive(true);
            }}
            className="shrink-0 rounded-lg bg-amber-600 px-2 py-1 text-xs text-white transition-colors hover:bg-amber-700"
          >
            啟用
          </button>
        </div>
      ) : null}

      {runtimeErrors.length > 0 ? (
        <div className="border-b border-rose-100 bg-rose-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-rose-800">這份報表執行時發生錯誤</p>
              <ul className="mt-1 space-y-0.5">
                {runtimeErrors.slice(0, 3).map((item, index) => (
                  <li key={index} className="truncate font-mono text-[11px] text-rose-700" title={item.message}>
                    {item.message}
                  </li>
                ))}
              </ul>
            </div>
            {autoRepairState === "sent" ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-rose-100 px-2 py-1 text-xs text-rose-700">
                <Wrench className="h-3 w-3 animate-pulse" strokeWidth={1.5} />
                已回報，Copilot 修正中
              </span>
            ) : onRequestRepair ? (
              <button
                type="button"
                onClick={() => onRequestRepair(runtimeErrors)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-xs text-white transition-colors hover:bg-rose-700"
              >
                <Wrench className="h-3 w-3" strokeWidth={1.5} />
                請 Copilot 修正
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {incomplete ? (
        <>
          <pre
            ref={draftRef}
            aria-label={incomplete === "writing" ? "報表產生中的原始碼" : "未完成報表的原始碼"}
            className="max-h-72 overflow-auto bg-zinc-900 px-3 py-3 text-xs leading-relaxed text-zinc-100"
          >
            <code>{html}</code>
          </pre>
          <p className="border-t border-zinc-100 bg-zinc-50 px-3 py-2 text-[11px] leading-4 text-zinc-500">
            {incomplete === "writing"
              ? "Copilot 正在撰寫這份報表，目前只能預覽內容；完成後會自動顯示並可以操作。"
              : "這份報表沒有寫完就停下了，因此沒有執行。請再問一次讓 Copilot 重新產生。"}
          </p>
        </>
      ) : showSource ? (
        <pre className="max-h-80 overflow-auto bg-zinc-900 px-3 py-3 text-xs leading-relaxed text-zinc-100">
          <code>{html}</code>
        </pre>
      ) : isFullscreen ? (
        <div className="flex h-[200px] items-center justify-center text-xs text-zinc-400">報表已在全螢幕中開啟</div>
      ) : (
        frame
      )}

      {isFullscreen ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-900/60 p-4">
          <div className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
              <span className="text-sm font-medium text-zinc-700">PD Copilot 報表</span>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="關閉全螢幕"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{frame}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
