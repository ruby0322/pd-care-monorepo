import {
  buildTaipeiMonthGrid,
  getMonthKeyFromDateKey,
  getRelativeMonthKey,
} from "@/lib/utils/upload-calendar";

describe("upload-calendar month helpers", () => {
  test("getMonthKeyFromDateKey returns YYYY-MM", () => {
    expect(getMonthKeyFromDateKey("2026-05-25")).toBe("2026-05");
  });

  test("getRelativeMonthKey shifts month keys correctly", () => {
    expect(getRelativeMonthKey("2026-05", -1)).toBe("2026-04");
    expect(getRelativeMonthKey("2026-05", -5)).toBe("2025-12");
    expect(getRelativeMonthKey("2026-05", 2)).toBe("2026-07");
  });

  test("buildTaipeiMonthGrid returns 42 aligned cells for a month", () => {
    const grid = buildTaipeiMonthGrid("2026-05");
    expect(grid.cells).toHaveLength(42);
    expect(grid.cells[0]).toMatchObject({
      dateKey: "2026-04-26",
      dayOfMonth: 26,
      isCurrentMonth: false,
    });
    expect(grid.cells[6]).toMatchObject({
      dateKey: "2026-05-02",
      dayOfMonth: 2,
      isCurrentMonth: true,
    });
  });
});
