/**
 * Client-side mirror of the backend's read-only tool allowlist.
 *
 * The backend enforces the real boundary; this list exists so a generated artifact cannot
 * even cause a request for something outside the surface, and so the UI can describe what
 * a live artifact is allowed to fetch.
 */
export const ARTIFACT_ALLOWED_TOOLS = [
  "list_patients",
  "get_patient_detail",
  "list_patient_uploads",
  "get_patient_upload_calendar",
  "list_patient_annotations",
  "get_upload_queue",
  "get_today_attention",
  "get_history_overview",
  "get_history_overview_days",
  "get_workbench_dashboard",
  "get_cohort_suspected_series",
  "get_cohort_suspected_summary",
  "get_cohort_age_histogram",
  "get_cohort_gender_distribution",
  "get_cohort_active_users",
] as const;

export type ArtifactTool = (typeof ARTIFACT_ALLOWED_TOOLS)[number];

const ALLOWED = new Set<string>(ARTIFACT_ALLOWED_TOOLS);

export function isAllowedArtifactTool(tool: unknown): tool is ArtifactTool {
  return typeof tool === "string" && ALLOWED.has(tool);
}

export type ArtifactQueryMessage = {
  type: "pdcare:query";
  id: string;
  tool: string;
  params: Record<string, unknown>;
};

export function parseArtifactQuery(data: unknown): ArtifactQueryMessage | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const candidate = data as Partial<ArtifactQueryMessage>;
  if (candidate.type !== "pdcare:query" || typeof candidate.id !== "string" || typeof candidate.tool !== "string") {
    return null;
  }
  const params =
    typeof candidate.params === "object" && candidate.params !== null && !Array.isArray(candidate.params)
      ? (candidate.params as Record<string, unknown>)
      : {};
  return { type: "pdcare:query", id: candidate.id, tool: candidate.tool, params };
}

/**
 * The artifact's own CSP forbids every network scheme (`connect-src 'none'`), so the
 * postMessage bridge below is its only route to data — and that route is allowlisted and
 * executed by the parent with the user's token, which never enters the frame.
 */
const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const BRIDGE_SCRIPT = `
(function () {
  var pending = {};
  var counter = 0;
  // line/column are reported as their own numeric fields, not only baked into the message
  // text: this frame holds fully identified patient data, so the parent sends the automatic
  // repair request with the location alone and keeps message/detail for the manual button,
  // where a human reads them first. (This whole script is a TS template literal, so no
  // backticks in here, and a JS string that needs a double quote inside it is written with
  // single quotes: a backslash-escaped quote would be collapsed by the template literal
  // before the browser ever sees it, ending the string early and breaking the parse.)
  function report(kind, message, detail, line, column) {
    try {
      parent.postMessage({
        type: "pdcare:error",
        kind: kind,
        message: String(message || "unknown error"),
        detail: detail ? String(detail).slice(0, 2000) : "",
        line: typeof line === "number" && line > 0 ? line : null,
        column: typeof column === "number" && column > 0 ? column : null
      }, "*");
    } catch (e) {}
  }
  // The report is what lets the assistant repair its own output: a chart that throws is
  // otherwise just a blank box, with the cause visible only in a console nobody opens.
  window.addEventListener("error", function (event) {
    var where = event.lineno ? " (line " + event.lineno + ":" + event.colno + ")" : "";
    report(
      "script",
      (event.message || "script error") + where,
      event.error && event.error.stack,
      event.lineno,
      event.colno
    );
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    report("promise", (reason && reason.message) || reason || "unhandled rejection", reason && reason.stack);
  });
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "pdcare:result") return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.ok) {
      entry.resolve(data.data);
    } else {
      var err = new Error(data.error || "query failed");
      report("query", 'window.pdcare.query("' + entry.tool + '") failed: ' + err.message);
      entry.reject(err);
    }
  });
  window.pdcare = {
    query: function (tool, params) {
      counter += 1;
      var id = "q" + counter;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject, tool: tool };
        parent.postMessage({ type: "pdcare:query", id: id, tool: tool, params: params || {} }, "*");
        setTimeout(function () {
          if (pending[id]) {
            delete pending[id];
            reject(new Error("query timed out"));
          }
        }, 30000);
      });
    }
  };
  // documentElement is the scrolling box, so its scrollHeight is floored at the viewport --
  // which here is the height the parent has just applied to this frame. Reporting it handed
  // the parent its own number back, and with both sides polling, the frame climbed every
  // tick to the parent's ceiling. So it is read only when it exceeds the viewport, where it
  // means something the body's box does not: content overflowing a frame that is too short.
  // Otherwise the body's own box answers, and it does not grow when the frame does -- which
  // is what makes the height the parent applies leave the next measurement unchanged.
  function postHeight() {
    var body = document.body;
    if (!body) return;
    var root = document.documentElement;
    var viewport = window.innerHeight || 0;
    var overflowing = root && root.scrollHeight > viewport ? root.scrollHeight : 0;
    var height = Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, overflowing));
    parent.postMessage({ type: "pdcare:height", height: height }, "*");
  }
  window.addEventListener("load", postHeight);
  setInterval(postHeight, 500);
})();
`;

export function buildArtifactDocument(html: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}" />
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Noto Sans TC", sans-serif;
    color: #18181b;
    padding: 16px;
    font-size: 14px;
  }
  * { box-sizing: border-box; }
</style>
<script>${BRIDGE_SCRIPT}</script>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * How far the report's own source sits below the top of the document it runs in.
 *
 * `buildArtifactDocument` prepends a head — CSP, styles, the whole bridge script — so the
 * line a browser reports for a fault is ~100 lines below the line the model actually wrote.
 * Every repair prompt quoted the document's number at a report whose source was dozens of
 * lines shorter, which pointed the model at nothing at all. Derived from the builder rather
 * than hard-coded, so editing the head cannot silently put it back.
 */
const REPORT_LINE_OFFSET = (() => {
  const marker = "__pdcare_report_source_marker__";
  return buildArtifactDocument(marker)
    .split("\n")
    .findIndex((line) => line.includes(marker));
})();

/**
 * A document line number as a line of the report's own source.
 *
 * Null when the fault did not land in the report at all: a line inside the injected head is
 * the bridge's own code, and telling the model to look at its line 0 (or -40) is worse than
 * telling it the location is unknown.
 */
export function toReportLine(documentLine: number | null): number | null {
  if (documentLine === null) {
    return null;
  }
  const line = documentLine - REPORT_LINE_OFFSET;
  return line >= 1 ? line : null;
}

type ValidationItem = { loc?: unknown; msg?: unknown; input?: unknown };

/**
 * The field a FastAPI validation item is about.
 *
 * `loc[0]` names where the value came from (`query`, `body`, …) and the rest is the path to
 * the field, so the head is dropped positionally rather than by name: the parameter that
 * caused this whole investigation is itself called `query`, and filtering by name erased it
 * along with its own wrapper.
 */
function validationField(item: ValidationItem): string | null {
  if (!Array.isArray(item.loc) || item.loc.length === 0) {
    return null;
  }
  const parts = (item.loc.length > 1 ? item.loc.slice(1) : item.loc).filter(
    (part): part is string | number => typeof part === "string" || typeof part === "number",
  );
  return parts.length > 0 ? parts.join(".") : null;
}

function describeValidation(items: ValidationItem[]): string {
  return items
    .slice(0, 3)
    .map((item) => {
      const field = validationField(item);
      const message = typeof item.msg === "string" ? item.msg : "參數不被接受";
      const got = "input" in item ? `（收到 ${JSON.stringify(item.input)}）` : "";
      return field ? `參數 ${field}：${message}${got}` : `${message}${got}`;
    })
    .join("；");
}

function describeDetail(data: unknown): string {
  if (typeof data === "string") {
    return data.slice(0, 400);
  }
  if (typeof data !== "object" || data === null) {
    return "";
  }
  const detail = (data as { detail?: unknown }).detail;
  if (detail === undefined) {
    return "";
  }
  if (Array.isArray(detail)) {
    return describeValidation(detail as ValidationItem[]).slice(0, 400);
  }
  // FastAPI's own error body is `{"detail": ...}`, which the proxy nests under `detail`.
  return describeDetail(detail) || JSON.stringify(detail).slice(0, 400);
}

/**
 * What the frame is told when the proxy refuses a query.
 *
 * The proxy answers an upstream rejection with that endpoint's own `detail` — for a 422,
 * the field it refused and the value it got. Passing on the status alone made the failure
 * unfixable by construction: the report displays "HTTP 422", the model is asked to repair
 * it, and with no field named it can only guess. In dev it guessed by sending *more*
 * parameters each turn, keeping the empty one that caused the 422, and said so outright:
 * 「僅憑 HTTP 422，無法確認是哪個欄位被拒絕」.
 */
export function formatProxyRejection(status: number | null, data: unknown): string {
  const base = `查詢被拒絕（HTTP ${status ?? "?"}）`;
  const detail = describeDetail(data);
  return detail ? `${base}：${detail}` : `${base}。`;
}

/**
 * True when the markup calls the live-data bridge. Such a report is inert without it, so
 * the thread enables live data for it by default rather than rendering a dead dashboard.
 */
export function usesLiveBridge(html: string): boolean {
  return /\bpdcare\s*\.\s*query\s*\(/.test(html) || /window\s*\.\s*pdcare\b/.test(html);
}

/**
 * Stricter than `usesLiveBridge`: an actual `pdcare.query(` call, not a mention.
 *
 * `usesLiveBridge` may stay loose because it only decides whether to switch live data on
 * by default, and a bare `window.pdcare` reference is a fair hint. Sharing is a different
 * question — a module that never calls the bridge shows its author's rows to everyone who
 * opens it — so the backend requires a call before it will store a module at anything but
 * `private` visibility. This mirrors that rule so the nurse learns it in the save dialog
 * instead of from a `422` after submitting. The backend remains the authority; this is a
 * hint, and it deliberately errs towards the same answer rather than a friendlier one.
 */
export function callsLiveBridge(html: string): boolean {
  return /\bpdcare\s*\.\s*query\s*\(/.test(html);
}

/**
 * One runtime fault reported by an artifact.
 *
 * `message` and `detail` come out of a frame that was handed *identified* patient data, so
 * they are the only fields here that may carry a name or case number — a report that throws
 * `new Error("找不到 " + patient.full_name + " 的資料")` puts one straight into this object.
 * They are shown to the reader and sent to the model only on the manual repair path.
 * `kind`, `line` and `column` are safe to send automatically: they describe the code, not
 * the data.
 */
export type ArtifactErrorMessage = {
  type: "pdcare:error";
  kind: string;
  message: string;
  detail: string;
  line: number | null;
  column: number | null;
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseArtifactError(data: unknown): ArtifactErrorMessage | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const candidate = data as Partial<ArtifactErrorMessage>;
  if (candidate.type !== "pdcare:error" || typeof candidate.message !== "string") {
    return null;
  }
  return {
    type: "pdcare:error",
    kind: typeof candidate.kind === "string" ? candidate.kind : "script",
    message: candidate.message.slice(0, 500),
    detail: typeof candidate.detail === "string" ? candidate.detail.slice(0, 2000) : "",
    line: finiteOrNull(candidate.line),
    column: finiteOrNull(candidate.column),
  };
}

/**
 * Where a fault happened, as a short label — the whole of what the automatic repair path is
 * allowed to tell the model about it.
 */
export function describeErrorLocation(error: ArtifactErrorMessage): string {
  const line = toReportLine(error.line);
  if (line === null) {
    return error.line === null ? "位置不明" : "位置在系統注入的程式碼，不在你的 HTML 內";
  }
  return error.column === null
    ? `你的 HTML 第 ${line} 行`
    : `你的 HTML 第 ${line} 行第 ${error.column} 欄`;
}

/**
 * The automatic repair request: error *type and location only*.
 *
 * `handleAutoRepair` fires with no nurse action at all, so whatever this returns is sent to
 * OpenAI unprompted. The iframe's own `message` and `detail` are therefore dropped here —
 * they are generated inside a frame holding identified data, and the prompt that produces
 * these reports encourages exactly the kind of error string that interpolates a patient
 * name. The full text stays available behind the manual 「請 Copilot 修正」 button, where a
 * human sees it before it goes anywhere.
 */
export function buildAutoRepairPrompt(errors: ArtifactErrorMessage[]): string {
  const lines = errors.slice(0, 5).map((item) => `- [${item.kind}] ${describeErrorLocation(item)}`);
  return [
    "上一份報表在瀏覽器執行時發生 JS 錯誤。錯誤原文可能含有病患識別資訊，因此沒有送出，",
    "這裡只提供錯誤類型與發生位置：",
    "",
    ...lines,
    "",
    "請依照位置檢視你上一份 HTML／JS 的對應程式碼，修正最可能的根因，",
    "並重新輸出完整的 ```html 區塊，保留原本的分析結論與數據。",
    "若無法僅憑位置判斷，請說明你需要什麼資訊，並提醒使用者可以按報表上的「請 Copilot 修正」送出完整錯誤訊息。",
  ].join("\n");
}

const EXCERPT_RADIUS = 4;
const MAX_EXCERPT_LINE_LENGTH = 200;

/** The report's own source around one line, numbered the way the model can act on. */
function sourceExcerpt(html: string, line: number): string[] {
  const lines = html.split("\n");
  if (line > lines.length) {
    return [];
  }
  const from = Math.max(1, line - EXCERPT_RADIUS);
  const to = Math.min(lines.length, line + EXCERPT_RADIUS);
  const width = String(to).length;
  const excerpt: string[] = [];
  for (let number = from; number <= to; number += 1) {
    const text = lines[number - 1].slice(0, MAX_EXCERPT_LINE_LENGTH);
    const marker = number === line ? "   <-- 錯誤發生在這一行" : "";
    excerpt.push(`${String(number).padStart(width, " ")}| ${text}${marker}`);
  }
  return excerpt;
}

/**
 * The manual repair request: every fault in full, where it is in the report's own source,
 * and the code that sits there.
 *
 * Safe to include because this only runs from the 「請 Copilot 修正」 button — a nurse has
 * read the error on screen and chosen to send it. Which is also why it is the place to be
 * generous: the automatic path is deliberately starved (type and location only, since the
 * frame holds identified data), so this button is the one route by which the model learns
 * what actually went wrong. It used to carry little more than the automatic path did — one
 * `detail` block for the whole batch, no locations, no source — and a model given
 * 「HTTP 422」 with no field name, or a line number from the wrapped document, cannot do
 * anything but guess.
 */
export function buildManualRepairPrompt(errors: ArtifactErrorMessage[], html?: string): string {
  const blocks = errors.slice(0, 5).map((item, index) => {
    const lines = [`### ${index + 1}. [${item.kind}] ${describeErrorLocation(item)}`, "", item.message];
    if (item.detail) {
      lines.push("", "```", item.detail.slice(0, 1200), "```");
    }
    const reportLine = toReportLine(item.line);
    const excerpt = html !== undefined && reportLine !== null ? sourceExcerpt(html, reportLine) : [];
    if (excerpt.length > 0) {
      lines.push("", "出錯位置附近、你上一版輸出的程式碼：", "```", ...excerpt, "```");
    }
    return lines.join("\n");
  });

  return [
    "上一份報表在瀏覽器執行時發生錯誤。以下是完整的錯誤訊息、在你 HTML 中的位置，",
    "以及該位置附近你自己寫的程式碼：",
    "",
    blocks.join("\n\n"),
    "",
    "請依照這些訊息修正根因，不要只用 try/catch 把錯誤藏起來，",
    "並重新輸出完整的 ```html 區塊，保留原本的分析結論與數據。",
    "",
    "若錯誤來自 window.pdcare.query：HTTP 422 是查詢參數驗證失敗——上面會指出被拒絕的欄位，",
    "照它修正那一個欄位（空字串請直接不要傳），不要改成多傳其他參數；403 是權限邊界；",
    "429 是查詢過於頻繁，請降低查詢次數或改用聚合工具。",
  ].join("\n");
}

/**
 * The one definition of "what counts as a fenced ```html block" — matched against the
 * capturing group so callers can read the block's inner HTML out of `match[1]`.
 *
 * Returns a fresh `RegExp` on every call rather than a shared module-level constant:
 * the pattern carries the global flag, and a global regex mutates its own `lastIndex`
 * as it's exec'd, which would leak between unrelated call sites (or between two calls
 * from the same site) if they shared one instance. A factory sidesteps that outright
 * instead of relying on every caller remembering to reset `lastIndex`.
 */
export function createHtmlFencePattern(): RegExp {
  return /```html\s*\n([\s\S]*?)(?:```|$)/g;
}

/** Extracts fenced ```html blocks, returning the prose around them and the blocks themselves. */
export type ParsedAssistantContent = {
  segments: Array<HtmlSegment | { kind: "text"; value: string }>;
  hasHtml: boolean;
};

/**
 * One fenced ```html block.
 *
 * `closed` is false while the block is still being written: the pattern ends at `$` as well
 * as at a closing fence, so a report appears here from its first line. Rendering a half-
 * written block is worse than not rendering it — the browser runs an unterminated `<script>`
 * at EOF, so every streamed token executes a truncated copy of the report in a frame that
 * reloads under the reader's cursor. The viewer waits for a closed fence before it renders.
 */
export type HtmlSegment = { kind: "html"; value: string; closed: boolean };

export function parseAssistantContent(content: string): ParsedAssistantContent {
  const segments: ParsedAssistantContent["segments"] = [];
  const pattern = createHtmlFencePattern();
  let lastIndex = 0;
  let hasHtml = false;
  let match = pattern.exec(content);

  while (match !== null) {
    const before = content.slice(lastIndex, match.index).trim();
    if (before) {
      segments.push({ kind: "text", value: before });
    }
    const html = match[1].trim();
    if (html) {
      segments.push({ kind: "html", value: html, closed: match[0].endsWith("```") });
      hasHtml = true;
    }
    lastIndex = match.index + match[0].length;
    match = pattern.exec(content);
  }

  const rest = content.slice(lastIndex).trim();
  if (rest) {
    segments.push({ kind: "text", value: rest });
  }
  if (segments.length === 0) {
    segments.push({ kind: "text", value: content });
  }
  return { segments, hasHtml };
}
