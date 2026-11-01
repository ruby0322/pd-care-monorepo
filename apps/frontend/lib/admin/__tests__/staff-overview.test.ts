import { formatLastReviewAt, isDormantStaff, staffOverviewKpis, staffRosterDisplayName } from "@/lib/admin/staff-overview";
import type { AdminStaffOverviewItem } from "@/lib/api/staff";

function makeItem(overrides: Partial<AdminStaffOverviewItem> = {}): AdminStaffOverviewItem {
  return {
    identity_id: 1,
    line_user_id: "U_STAFF",
    display_name: "LINE Name",
    real_name: "Nurse Chen",
    picture_url: null,
    role: "staff",
    is_active: true,
    assigned_patient_count: 3,
    assigned_upload_count: 12,
    labeled_assigned_upload_count: 9,
    labeled_assigned_ratio: 0.75,
    reviewed_upload_count: 10,
    review_count_7d: 2,
    review_count_30d: 8,
    last_review_at: "2026-11-01T00:00:00Z",
    created_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

describe("staffOverviewKpis", () => {
  test("returns zeroed tiles when the summary has not loaded", () => {
    const kpis = staffOverviewKpis(null);
    expect(kpis).toHaveLength(4);
    expect(kpis.every((kpi) => kpi.value === 0)).toBe(true);
    expect(kpis.every((kpi) => kpi.tone === "neutral")).toBe(true);
  });

  test("flags coverage gaps as warnings and leaves healthy counts neutral", () => {
    const kpis = staffOverviewKpis({
      staff_count: 5,
      staff_total: 5,
      truncated: false,
      active_staff_count: 4,
      pending_access_request_count: 0,
      zero_assignment_staff_count: 2,
      unassigned_patient_count: 7,
    });
    const byKey = Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));

    expect(byKey.active_staff.value).toBe(4);
    expect(byKey.active_staff.hint).toContain("5");
    expect(byKey.pending_requests.tone).toBe("neutral");
    expect(byKey.zero_assignment.tone).toBe("warning");
    expect(byKey.unassigned_patients.tone).toBe("warning");
  });
});

describe("formatLastReviewAt", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  test("reads as 從未審核 when there is no review and when the timestamp is unparseable", () => {
    expect(formatLastReviewAt(null, now)).toBe("從未審核");
    expect(formatLastReviewAt("not-a-date", now)).toBe("從未審核");
  });

  test("uses relative labels inside the 30 day window", () => {
    expect(formatLastReviewAt("2026-11-01T01:00:00Z", now)).toBe("今天");
    expect(formatLastReviewAt("2026-10-31T06:00:00Z", now)).toBe("昨天");
    expect(formatLastReviewAt("2026-10-25T12:00:00Z", now)).toBe("7 天前");
  });

  test("falls back to an absolute date beyond 30 days", () => {
    expect(formatLastReviewAt("2026-09-01T12:00:00Z", now)).toBe(new Date("2026-09-01T12:00:00Z").toLocaleDateString("zh-TW"));
  });

  test("treats a clock-skewed future timestamp as 剛剛 rather than a negative day count", () => {
    expect(formatLastReviewAt("2026-11-02T12:00:00Z", now)).toBe("剛剛");
  });
});

describe("isDormantStaff", () => {
  test("only active accounts with no 30 day reviews count as dormant", () => {
    expect(isDormantStaff(makeItem({ review_count_30d: 0 }))).toBe(true);
    expect(isDormantStaff(makeItem({ review_count_30d: 1 }))).toBe(false);
    expect(isDormantStaff(makeItem({ review_count_30d: 0, is_active: false }))).toBe(false);
  });
});

describe("staffRosterDisplayName", () => {
  test("prefers real name, then LINE display name, then the raw LINE id", () => {
    expect(staffRosterDisplayName(makeItem())).toBe("Nurse Chen");
    expect(staffRosterDisplayName(makeItem({ real_name: null }))).toBe("LINE Name");
    expect(staffRosterDisplayName(makeItem({ real_name: "   ", display_name: null }))).toBe("U_STAFF");
  });
});
