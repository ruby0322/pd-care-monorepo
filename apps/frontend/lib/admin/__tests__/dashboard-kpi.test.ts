import { getSuspectedKpi } from "@/lib/admin/dashboard-kpi";
      
describe("admin dashboard suspected KPI mapping", () => {
  test("uses today suspected upload count when period is today", () => {
    const result = getSuspectedKpi("today", 12, 1);

    expect(result).toEqual({
      label: "今日 疑似感染筆數",
      value: 1,
    });
  });

  test("falls back to zero for today when summary is missing", () => {
    const result = getSuspectedKpi("today", 12, undefined);

    expect(result).toEqual({
      label: "今日疑似感染筆數",
      value: 0,
    });
  });

  test("uses suspected patient count for non-today periods", () => {
    const result = getSuspectedKpi(1, 3, 0);

    expect(result).toEqual({
      label: "疑似感染人數",
      value: 3,
    });
  });
});
