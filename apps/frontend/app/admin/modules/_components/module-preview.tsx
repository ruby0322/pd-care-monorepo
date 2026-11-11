"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildArtifactDocument, parseArtifactQuery } from "@/app/admin/copilot/_components/artifact-bridge";

/**
 * The width the module is laid out at before being scaled down. A report is written for a
 * reading-width page, so rendering it at card width and scaling up would reflow it into
 * something that looks nothing like the real thing.
 */
const LAYOUT_WIDTH = 900;
const LAYOUT_HEIGHT = 560;

/**
 * A module's own rendering, shrunk to fit a card and inert.
 *
 * Deliberately not `CopilotHtmlArtifact`: that component exists to *run* a report -- a
 * toolbar, height negotiation, live queries, error reporting and self-repair. A card wants
 * none of it. What it does share is `buildArtifactDocument`, so the preview is the same
 * sandboxed document with the same CSP, not a second rendering path that could drift.
 *
 * Queries are refused on the spot rather than ignored. The injected bridge still posts them,
 * and its own timeout is 30 seconds -- long enough that an unanswered card would sit blank
 * and then show an error. Answering immediately lets the module paint its own empty state,
 * which is what a preview should show. Nothing authenticated happens: the refusal is local,
 * so no request reaches `/v1/copilot/proxy` and no token is spent on a card nobody opened.
 */
export function ModulePreview({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.3);
  const document_ = useMemo(() => buildArtifactDocument(html), [html]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      const query = parseArtifactQuery(event.data);
      if (!query) {
        return;
      }
      frame.contentWindow?.postMessage(
        { type: "pdcare:result", id: query.id, ok: false, error: "預覽不連線即時資料，開啟模組後才會查詢。" },
        "*",
      );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The scale follows the card's real width, so the preview fills it on any screen.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) {
      return;
    }
    const measure = () => setScale(node.clientWidth / LAYOUT_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="pointer-events-none h-[104px] overflow-hidden border-b border-zinc-100 bg-white">
      <iframe
        ref={frameRef}
        sandbox="allow-scripts"
        srcDoc={document_}
        title="模組預覽"
        aria-hidden
        tabIndex={-1}
        style={{
          width: LAYOUT_WIDTH,
          height: LAYOUT_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
        }}
      />
    </div>
  );
}
