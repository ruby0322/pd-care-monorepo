import {
  buildTaipeiMonthGrid,
  buildTaipeiWeekRow,
  getMonthKeyFromDateKey,
  getMonthKeysForWeek,
  getWeekStartDateKey,
  parseTaipeiDateKey,
  getRelativeMonthKey,
  shiftTaipeiDateKey,
} from "@/lib/utils/upload-calendar";

describe("upload-calendar month helpers", () => {
  test("getMonthKeyFromDateKey returns YYYY-MM", () => {
    expect(getMonthKeyFromDateKey("2026-05-25")).toBe("2026-05");
    expect(getMonthKeyFromDateKey("2026-07-01")).toBe("2026-07");
  });

  test("parseTaipeiDateKey extracts numeric year month day", () => {
    expect(parseTaipeiDateKey("2026-07-01")).toEqual({ year: 2026, month: 7, day: 1 });
  });

  test("parseTaipeiDateKey rejects invalid calendar dates", () => {
    expect(() => parseTaipeiDateKey("2026-02-30")).toThrow("Invalid Taipei date key");
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

  test("week helpers align Sunday-start rows and cross-month weeks", () => {
    expect(getWeekStartDateKey("2026-07-30")).toBe("2026-07-26");
    expect(buildTaipeiWeekRow("2026-07-26").map((cell) => cell.dateKey)).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
    expect(getMonthKeysForWeek("2026-07-26")).toEqual(["2026-07", "2026-08"]);
    expect(shiftTaipeiDateKey("2026-07-30", 3)).toBe("2026-08-02");
  });
});
