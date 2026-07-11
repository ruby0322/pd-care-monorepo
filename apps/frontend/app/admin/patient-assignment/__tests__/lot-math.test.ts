import { buildPatientLot, genderBadgeLabel, staffDisplayName } from "@/app/admin/patient-assignment/lot-math";

describe("buildPatientLot", () => {
  test("pads to capacity when few patients", () => {
    const lot = buildPatientLot(2, 8);
    expect(lot.visibleCount).toBe(2);
    expect(lot.cells).toHaveLength(8);
    expect(lot.cells.filter((cell) => cell.type === "patient")).toHaveLength(2);
    expect(lot.cells.filter((cell) => cell.type === "add")).toHaveLength(1);
    expect(lot.cells.filter((cell) => cell.type === "pad")).toHaveLength(5);
  });

  test("lays out more than three patients without overflow", () => {
    const lot = buildPatientLot(4, 8);
    expect(lot.visibleCount).toBe(4);
    expect(lot.cells.filter((cell) => cell.type === "patient")).toHaveLength(4);
  });

  test("uses overflow tile when over capacity", () => {
    const lot = buildPatientLot(10, 8);
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
