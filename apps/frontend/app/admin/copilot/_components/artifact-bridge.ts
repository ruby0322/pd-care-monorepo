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
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "pdcare:result") return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.ok) entry.resolve(data.data);
    else entry.reject(new Error(data.error || "query failed"));
  });
  window.pdcare = {
    query: function (tool, params) {
      counter += 1;
      var id = "q" + counter;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
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
  function postHeight() {
    var height = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
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

/** Extracts fenced ```html blocks, returning the prose around them and the blocks themselves. */
export type ParsedAssistantContent = {
  segments: Array<{ kind: "text"; value: string } | { kind: "html"; value: string }>;
  hasHtml: boolean;
};

export function parseAssistantContent(content: string): ParsedAssistantContent {
  const segments: ParsedAssistantContent["segments"] = [];
  const pattern = /```html\s*\n([\s\S]*?)(?:```|$)/g;
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
      segments.push({ kind: "html", value: html });
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
