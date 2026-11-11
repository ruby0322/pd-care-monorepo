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

const now = new Date("2026-11-11T09:30:00+08:00");

describe("groupSessions", () => {
  it("splits today, the past week and everything earlier", () => {
    const groups = groupSessions(
      [
        session(1, "2026-11-11T08:00:00+08:00"),
        session(2, "2026-11-08T12:00:00+08:00"),
        session(3, "2026-09-01T12:00:00+08:00"),
      ],
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
    const groups = groupSessions([session(1, "2026-11-10T23:50:00+08:00")], new Date("2026-11-11T00:10:00+08:00"));
    expect(groups[0].label).toBe("近 7 天");
  });

  it("orders newest first inside a group", () => {
    const groups = groupSessions(
      [session(1, "2026-11-11T02:00:00+08:00"), session(2, "2026-11-11T08:00:00+08:00")],
      now,
    );
    expect(groups[0].sessions.map((s) => s.session_id)).toEqual([2, 1]);
  });

  it("drops groups that would render an empty heading", () => {
    const groups = groupSessions([session(1, "2026-11-11T08:00:00+08:00")], now);
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
