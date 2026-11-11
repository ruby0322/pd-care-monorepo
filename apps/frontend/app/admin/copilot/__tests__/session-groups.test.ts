import { groupSessions } from "@/app/admin/copilot/_components/session-groups";
import type { CopilotSessionSummary } from "@/lib/api/copilot";

function session(id: number, updatedAt: string): CopilotSessionSummary {
  return {
    session_id: id,
    title: `對話 ${id}`,
    model: "gpt-6.1-terra",
    visibility: "private",
    owner_identity_id: 1,
    owner_name: null,
    is_owner: true,
    can_write: true,
    message_count: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

// Local time throughout, because the grouping is about the viewer's calendar day: fixtures
// written as fixed `+08:00` instants passed in Taipei and failed on a UTC runner, which is
// a bug in the test rather than in the grouping.
const now = new Date(2026, 10, 11, 9, 30);

/** An instant `daysAgo` before `now`, at a local wall-clock time. */
function localIso(daysAgo: number, hour: number, minute = 0, base: Date = now): string {
  const when = new Date(base);
  when.setDate(when.getDate() - daysAgo);
  when.setHours(hour, minute, 0, 0);
  return when.toISOString();
}

describe("groupSessions", () => {
  it("splits today, the past week and everything earlier", () => {
    const groups = groupSessions(
      [session(1, localIso(0, 8)), session(2, localIso(3, 12)), session(3, localIso(70, 12))],
      now,
    );

    expect(groups.map((group) => [group.label, group.sessions.map((s) => s.session_id)])).toEqual([
      ["今天", [1]],
      ["近 7 天", [2]],
      ["更早", [3]],
    ]);
  });

  /** Elapsed hours would put last night's thread under 今天 at 00:10. A reader would not. */
  it("buckets by calendar day, not by elapsed hours", () => {
    const justAfterMidnight = new Date(2026, 10, 11, 0, 10);
    const lastNight = localIso(1, 23, 50, justAfterMidnight);

    expect(groupSessions([session(1, lastNight)], justAfterMidnight)[0].label).toBe("近 7 天");
  });

  it("orders newest first inside a group", () => {
    const groups = groupSessions([session(1, localIso(0, 2)), session(2, localIso(0, 8))], now);
    expect(groups[0].sessions.map((s) => s.session_id)).toEqual([2, 1]);
  });

  it("drops groups that would render an empty heading", () => {
    const groups = groupSessions([session(1, localIso(0, 8))], now);
    expect(groups.map((group) => group.key)).toEqual(["today"]);
  });

  it("returns nothing for no sessions", () => {
    expect(groupSessions([], now)).toEqual([]);
  });

  it("does not drop a session whose timestamp is unusable", () => {
    const groups = groupSessions([session(1, "not a date")], now);
    expect(groups).toEqual([expect.objectContaining({ key: "earlier" })]);
  });
});
