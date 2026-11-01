import { assignmentKpis, formatLastReviewAt, isDormantWorkload, labeledRatioPercent } from "@/lib/admin/staff-overview";
import type { AdminIdentityWorkloadStats } from "@/lib/api/staff";

function makeWorkload(overrides: Partial<AdminIdentityWorkloadStats> = {}): AdminIdentityWorkloadStats {
  return {
    assigned_patient_count: 3,
    assigned_upload_count: 12,
    labeled_assigned_upload_count: 9,
    labeled_assigned_ratio: 0.75,
    reviewed_upload_count: 10,
    review_count_7d: 2,
    review_count_30d: 8,
    last_reviewed_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

describe("assignmentKpis", () => {
  test("returns zeroed neutral tiles before the summary loads", () => {
    const kpis = assignmentKpis(null);
    expect(kpis).toHaveLength(3);
    expect(kpis.every((kpi) => kpi.value === 0)).toBe(true);
    expect(kpis.every((kpi) => kpi.tone === "neutral")).toBe(true);
  });

  test("leads with unassigned patients and warns only on real gaps", () => {
    const kpis = assignmentKpis({
      staff_total: 7,
      active_staff_count: 6,
      pending_access_request_count: 2,
      idle_staff_count: 0,
      unassigned_patient_count: 5,
    });

    expect(kpis[0].key).toBe("unassigned_patients");
    const byKey = Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));
    expect(byKey.unassigned_patients.tone).toBe("warning");
    expect(byKey.idle_staff.tone).toBe("neutral");
    expect(byKey.active_staff.value).toBe(6);
    expect(byKey.active_staff.hint).toContain("7");
  });

  test("omits account-admin counters that are not assignment actions", () => {
    const kpis = assignmentKpis({
      staff_total: 1,
      active_staff_count: 1,
      pending_access_request_count: 9,
      idle_staff_count: 0,
      unassigned_patient_count: 0,
    });
    expect(kpis.map((kpi) => kpi.key)).not.toContain("pending_requests");
  });
});

describe("formatLastReviewAt", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  test("reads as 從未審核 with no review and with an unparseable timestamp", () => {
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

  test("treats a clock-skewed future timestamp as 剛剛", () => {
    expect(formatLastReviewAt("2026-11-02T12:00:00Z", now)).toBe("剛剛");
  });
});

describe("isDormantWorkload", () => {
  test("only flags accounts with no 30 day review activity", () => {
    expect(isDormantWorkload(makeWorkload({ review_count_30d: 0 }))).toBe(true);
    expect(isDormantWorkload(makeWorkload({ review_count_30d: 1 }))).toBe(false);
  });

  test("a patient row with no workload is not dormant", () => {
    expect(isDormantWorkload(null)).toBe(false);
  });
});

describe("labeledRatioPercent", () => {
  test("rounds the ratio and treats an empty queue as zero rather than NaN", () => {
    expect(labeledRatioPercent(makeWorkload())).toBe(75);
    expect(labeledRatioPercent(makeWorkload({ assigned_upload_count: 0, labeled_assigned_ratio: 0 }))).toBe(0);
    expect(labeledRatioPercent(null)).toBe(0);
  });
});
