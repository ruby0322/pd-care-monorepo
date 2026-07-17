import { getElevatedUserKpi, getSuspectedKpi } from "@/lib/admin/dashboard-kpi";

describe("admin dashboard risk KPI mapping", () => {
  test("uses summary suspected user count when period is today", () => {
    expect(getSuspectedKpi("today", 1)).toEqual({
      label: "今日疑似感染人數",
      value: 1,
    });
  });

  test("falls back to zero for today when summary is missing", () => {
    expect(getSuspectedKpi("today", undefined)).toEqual({
      label: "今日疑似感染人數",
      value: 0,
    });
  });

  test("uses summary suspected user count for non-today periods", () => {
    expect(getSuspectedKpi(3, 5)).toEqual({
      label: "3 月疑似感染人數",
      value: 5,
    });
  });

  test("maps elevated user KPI for today and period from summary", () => {
    expect(getElevatedUserKpi("today", 2)).toEqual({
      label: "今日症狀高風險人數",
      value: 2,
    });
    expect(getElevatedUserKpi(6, undefined)).toEqual({
      label: "6 月症狀高風險人數",
      value: 0,
    });
    expect(getElevatedUserKpi(6, 4)).toEqual({
      label: "6 月症狀高風險人數",
      value: 4,
    });
  });
});
