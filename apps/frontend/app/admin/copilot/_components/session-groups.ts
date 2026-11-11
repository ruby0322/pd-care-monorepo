import type { CopilotSessionSummary } from "@/lib/api/copilot";

export type SessionGroup = { key: "today" | "week" | "earlier"; label: string; sessions: CopilotSessionSummary[] };

const LABELS: Record<SessionGroup["key"], string> = {
  today: "今天",
  week: "近 7 天",
  earlier: "更早",
};

/**
 * Buckets by local calendar day, not by elapsed hours: a thread from 23:50 last night
 * belongs under 「今天」 at 00:10 only if the reader would call it today, and they would not.
 */
function bucketFor(updatedAt: string, now: Date): SessionGroup["key"] {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return "earlier";
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const updatedTime = updated.getTime();
  if (updatedTime >= startOfToday) {
    return "today";
  }
  // Six further days back, so "近 7 天" counts today plus the six before it.
  if (updatedTime >= startOfToday - 6 * 24 * 60 * 60 * 1000) {
    return "week";
  }
  return "earlier";
}

/**
 * Groups the rail's sessions for display, newest first within each group and empty groups
 * dropped, so the rail never shows a heading with nothing under it.
 */
export function groupSessions(sessions: CopilotSessionSummary[], now: Date = new Date()): SessionGroup[] {
  const buckets: Record<SessionGroup["key"], CopilotSessionSummary[]> = { today: [], week: [], earlier: [] };
  for (const session of sessions) {
    buckets[bucketFor(session.updated_at, now)].push(session);
  }
  return (["today", "week", "earlier"] as const)
    .map((key) => ({
      key,
      label: LABELS[key],
      sessions: [...buckets[key]].sort(
        (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      ),
    }))
    .filter((group) => group.sessions.length > 0);
}
