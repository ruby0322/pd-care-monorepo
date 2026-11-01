import { buildAvgReviewSeries, buildReviewHeatmap, buildReviewKpis, reviewHeatmapScale } from "@/lib/admin/review-throughput-data";
import type { AdminDailySuspectedSeriesPoint, AdminReviewThroughputResponse } from "@/lib/api/staff";

function makeThroughput(overrides: Partial<AdminReviewThroughputResponse> = {}): AdminReviewThroughputResponse {
  return {
    lookback_days: 3,
    reviewed_uploads_total: 9,
    reviewer_count_total: 2,
    days: [
      { date: "2026-10-30", reviewed_uploads: 4, reviewer_count: 2 },
      { date: "2026-10-31", reviewed_uploads: 3, reviewer_count: 2 },
      { date: "2026-11-01", reviewed_uploads: 0, reviewer_count: 0 },
    ],
    top_staff: [
      {
        identity_id: 1,
        line_user_id: "U_A",
        display_name: "LINE A",
        real_name: "Nurse A",
        reviewed_uploads: 6,
        daily_counts: [4, 2, 0],
      },
      {
        identity_id: 2,
        line_user_id: "U_B",
        display_name: null,
        real_name: null,
        reviewed_uploads: 1,
        daily_counts: [0, 1, 0],
      },
    ],
    ...overrides,
  };
}

function makeUploadSeries(): AdminDailySuspectedSeriesPoint[] {
  return [
    { date: "2026-10-30", total_uploads: 10, labeled_uploads: 5, suspected_uploads: 1, symptom_elevated_uploads: 0, suspected_ratio: 0.1 },
    { date: "2026-10-31", total_uploads: 6, labeled_uploads: 3, suspected_uploads: 0, symptom_elevated_uploads: 0, suspected_ratio: 0 },
  ];
}

describe("buildAvgReviewSeries", () => {
  test("divides daily reviews by the reviewers active that day", () => {
    const points = buildAvgReviewSeries(makeThroughput());
    expect(points.map((point) => point.avg_per_reviewer)).toEqual([2, 1.5, 0]);
  });

  test("a day with no reviewers averages 0 instead of dividing by zero", () => {
    const points = buildAvgReviewSeries(makeThroughput());
    const idle = points[2];
    expect(idle.reviewer_count).toBe(0);
    expect(Number.isFinite(idle.avg_per_reviewer)).toBe(true);
    expect(idle.avg_per_reviewer).toBe(0);
  });

  test("formats a short axis label and tolerates a missing response", () => {
    expect(buildAvgReviewSeries(makeThroughput())[0].shortDate).toBe("10/30");
    expect(buildAvgReviewSeries(null)).toEqual([]);
  });
});

describe("buildReviewHeatmap", () => {
  test("scales intensity so a typical cell is readable", () => {
    const rows = buildReviewHeatmap(makeThroughput());
    expect(rows[0].cells[0].intensity).toBeCloseTo(1);
    expect(rows[0].cells[1].intensity).toBeGreaterThan(0.15);
  });

  test("one outlier day does not flatten every other cell", () => {
    // A single 40-review day next to ordinary 1-2 review days.
    const skewed = makeThroughput({
      top_staff: [
        { identity_id: 1, line_user_id: "U_A", display_name: null, real_name: "A", reviewed_uploads: 42, daily_counts: [40, 1, 2] },
        { identity_id: 2, line_user_id: "U_B", display_name: null, real_name: "B", reviewed_uploads: 3, daily_counts: [1, 2, 0] },
      ],
    });
    const rows = buildReviewHeatmap(skewed);
    const ordinary = rows[1].cells[1]; // a 2-review day
    expect(ordinary.count).toBe(2);
    // Against the maximum this would be 2/40 = 0.05, i.e. invisible.
    expect(ordinary.intensity).toBeGreaterThan(0.5);
    // The outlier saturates rather than stretching the scale.
    expect(rows[0].cells[0].intensity).toBe(1);
  });

  test("the scale ignores empty cells and never drops below 1", () => {
    expect(reviewHeatmapScale(makeThroughput({ top_staff: [] }))).toBe(1);
    expect(
      reviewHeatmapScale(
        makeThroughput({
          top_staff: [
            { identity_id: 1, line_user_id: "U_A", display_name: null, real_name: "A", reviewed_uploads: 1, daily_counts: [0, 0, 1] },
          ],
        })
      )
    ).toBe(1);
  });

  test("an empty cell is zero while a single review stays visible", () => {
    const rows = buildReviewHeatmap(makeThroughput());
    expect(rows[0].cells[2].intensity).toBe(0);
    // 1/4 = 0.25, already above the floor; check the floor with a sparser peak.
    const sparse = buildReviewHeatmap(
      makeThroughput({
        top_staff: [
          { identity_id: 3, line_user_id: "U_C", display_name: null, real_name: null, reviewed_uploads: 1, daily_counts: [20, 1, 0] },
        ],
      })
    );
    expect(sparse[0].cells[1].intensity).toBeGreaterThanOrEqual(0.15);
  });

  test("falls back through real name, LINE name, then the raw id", () => {
    const rows = buildReviewHeatmap(makeThroughput());
    expect(rows[0].name).toBe("Nurse A");
    expect(rows[1].name).toBe("U_B");
  });

  test("returns nothing when there is no data to plot", () => {
    expect(buildReviewHeatmap(null)).toEqual([]);
    expect(buildReviewHeatmap(makeThroughput({ top_staff: [] }))).toEqual([]);
  });
});

describe("buildReviewKpis", () => {
  test("averages uploads per day over the days present, not the lookback", () => {
    const [uploadsPerDay] = buildReviewKpis(makeThroughput(), makeUploadSeries());
    // (10 + 6) / 2 days = 8
    expect(uploadsPerDay.value).toBe("8");
    expect(uploadsPerDay.hint).toContain("16");
  });

  test("reports the labeled ratio as a whole percent", () => {
    const kpis = buildReviewKpis(makeThroughput(), makeUploadSeries());
    const ratio = kpis.find((kpi) => kpi.key === "labeled_ratio");
    // 8 labeled of 16 total
    expect(ratio?.value).toBe("50%");
  });

  test("divides window distinct reviews by window distinct reviewers", () => {
    const kpis = buildReviewKpis(makeThroughput(), makeUploadSeries());
    const avg = kpis.find((kpi) => kpi.key === "avg_per_reviewer");
    // 9 distinct uploads across 2 reviewers; summing the daily rows would have given 7
    expect(avg?.value).toBe("4.5");
    expect(avg?.hint).toBe("9 張 / 2 人");
  });

  test("survives an empty window without NaN or a divide by zero", () => {
    const kpis = buildReviewKpis(null, []);
    expect(kpis.map((kpi) => kpi.value)).toEqual(["0", "0%", "0"]);
    expect(kpis[2].hint).toBe("期間無人審核");
  });
});
