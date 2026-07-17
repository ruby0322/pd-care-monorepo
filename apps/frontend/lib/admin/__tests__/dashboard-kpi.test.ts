import { getElevatedUserKpi, getSuspectedKpi } from "@/lib/admin/dashboard-kpi";

describe("admin dashboard risk KPI mapping", () => {
  test("uses today suspected user count when period is today", () => {
    expect(getSuspectedKpi("today", 12, 1)).toEqual({
      label: "今日疑似感染人數",
      value: 1,
    });
  });

  test("falls back to zero for today when summary is missing", () => {
    expect(getSuspectedKpi("today", 12, undefined)).toEqual({
      label: "今日疑似感染人數",
      value: 0,
    });
  });

  test("uses period suspected patient count for non-today periods", () => {
    expect(getSuspectedKpi(3, 5, 0)).toEqual({
      label: "3 月疑似感染人數",
      value: 5,
    });
  });

  test("maps elevated user KPI for today and period", () => {
    expect(getElevatedUserKpi("today", 9, 2)).toEqual({
      label: "今日症狀高風險人數",
      value: 2,
    });
    expect(getElevatedUserKpi(6, 4, undefined)).toEqual({
      label: "6 月症狀高風險人數",
      value: 4,
    });
  });
});
