/**
 * Substitutes de-identified handles (`P#3`, `R#1`, ...) back into their per-viewer
 * labels for display.
 *
 * The backend never sends a real name to the LLM; it mints a session-scoped handle
 * instead, and resolves that handle to a label (gated per viewer) out-of-band. This is
 * the last-mile substitution that turns "P#3 需追蹤" back into "王小明 (P123456) 需追蹤"
 * on screen.
 */

import { createHtmlFencePattern } from "./artifact-bridge";

export type HandleLabelInfo = { label: string | null };
export type HandleLabelMap = Record<string, HandleLabelInfo>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies `transform` to every slice of `text` that falls outside a fenced ```html
 * block. Pulls a fresh regex from `createHtmlFencePattern()` on every call, so two
 * calls in a row (or two calls that happen to interleave) never share `lastIndex`.
 */
function replaceOutsideHtmlBlocks(text: string, transform: (segment: string) => string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(createHtmlFencePattern())) {
    const index = match.index ?? 0;
    result += transform(text.slice(lastIndex, index));
    result += match[0];
    lastIndex = index + match[0].length;
  }
  result += transform(text.slice(lastIndex));
  return result;
}

/**
 * Replaces every known handle in `text` with its resolved label. A handle whose label
 * is `null` (the viewer may not see that person) or whose label has not arrived yet is
 * left as the bare handle — never blank, never "unknown".
 *
 * Fenced ```html blocks are left byte-for-byte untouched: a generated report's own
 * markup may legitimately contain a handle-shaped string, and rewriting it would
 * corrupt that markup.
 */
export function applyHandleLabels(text: string, handles: HandleLabelMap): string {
  const labeled = Object.entries(handles).filter(
    (entry): entry is [string, { label: string }] => typeof entry[1]?.label === "string" && entry[1].label.length > 0,
  );
  if (labeled.length === 0) {
    return text;
  }

  // Longest handle first, so "P#12" is matched whole rather than clipped to "P#1" + a
  // stray "2" from a shorter handle that happens to be a prefix of it.
  const pattern = new RegExp(
    labeled
      .map(([handle]) => handle)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  const labelByHandle = new Map(labeled.map(([handle, info]) => [handle, info.label]));

  return replaceOutsideHtmlBlocks(text, (segment) =>
    segment.replace(pattern, (match) => labelByHandle.get(match) ?? match),
  );
}
