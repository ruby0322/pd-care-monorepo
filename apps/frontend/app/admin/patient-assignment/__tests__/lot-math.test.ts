import { buildPatientLot, genderBadgeLabel, staffDisplayName } from "@/app/admin/patient-assignment/lot-math";

describe("buildPatientLot", () => {
  test("uses chip mode and pads to capacity when few patients", () => {
    const lot = buildPatientLot(2, 8, "chip");
    expect(lot.mode).toBe("chip");
    expect(lot.visibleCount).toBe(2);
    expect(lot.cells).toHaveLength(8);
    expect(lot.cells.filter((cell) => cell.type === "patient")).toHaveLength(2);
    expect(lot.cells.filter((cell) => cell.type === "add")).toHaveLength(1);
    expect(lot.cells.filter((cell) => cell.type === "pad")).toHaveLength(5);
  });

  test("uses square mode on desktop layout", () => {
    expect(buildPatientLot(4, 8, "square").mode).toBe("square");
    expect(buildPatientLot(7, 8, "square").mode).toBe("square");
  });

  test("uses chip mode on mobile layout", () => {
    expect(buildPatientLot(4, 4, "chip").mode).toBe("chip");
    expect(buildPatientLot(3, 4, "chip").mode).toBe("chip");
  });

  test("keeps tile mode with overflow tile when over capacity", () => {
    const lot = buildPatientLot(10, 8, "square");
    expect(lot.mode).toBe("square");
    expect(lot.visibleCount).toBe(6);
    expect(lot.cells).toEqual([
      { type: "patient", patientIndex: 0 },
      { type: "patient", patientIndex: 1 },
      { type: "patient", patientIndex: 2 },
      { type: "patient", patientIndex: 3 },
      { type: "patient", patientIndex: 4 },
      { type: "patient", patientIndex: 5 },
      { type: "overflow", count: 4 },
      { type: "add" },
    ]);
  });
});

describe("staffDisplayName / genderBadgeLabel", () => {
  test("prefers real name then LINE display name", () => {
    expect(staffDisplayName("王護理", "LINEName")).toBe("王護理");
    expect(staffDisplayName(null, "LINEName")).toBe("LINEName");
    expect(staffDisplayName(null, null)).toBe("未命名人員");
  });

  test("maps gender labels", () => {
    expect(genderBadgeLabel("male")).toBe("男");
    expect(genderBadgeLabel("female")).toBe("女");
    expect(genderBadgeLabel("other")).toBe("其他");
    expect(genderBadgeLabel("unknown")).toBe("?");
  });
});
