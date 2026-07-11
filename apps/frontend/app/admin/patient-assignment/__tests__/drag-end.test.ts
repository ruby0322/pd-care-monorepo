import type { DragEndEvent } from "@dnd-kit/core";

import { resolveDragEndResult } from "@/app/admin/patient-assignment/drag-end";

function dragEvent(over: DragEndEvent["over"], activeData: Record<string, unknown>): DragEndEvent {
  return {
    active: { data: { current: activeData } },
    over,
  } as DragEndEvent;
}

describe("resolveDragEndResult", () => {
  const poolPatient = {
    patientId: 201,
    fromStaffId: null,
    caseNumber: "P-000201",
    fullName: "池中病患",
  };

  const assignedPatient = {
    patientId: 101,
    fromStaffId: 11,
    caseNumber: "P-000101",
    fullName: "王小明",
  };

  test("assigns pool patient dropped on staff", () => {
    const result = resolveDragEndResult(
      dragEvent({ data: { current: { type: "staff", staffId: 22 } } }, poolPatient)
    );
    expect(result).toEqual({ kind: "assign", patientId: 201, staffId: 22 });
  });

  test("reassigns patient dropped on different staff", () => {
    const result = resolveDragEndResult(
      dragEvent({ data: { current: { type: "staff", staffId: 22 } } }, assignedPatient)
    );
    expect(result).toEqual({ kind: "assign", patientId: 101, staffId: 22 });
  });

  test("prompts unassign when assigned patient is dropped on pool", () => {
    const result = resolveDragEndResult(
      dragEvent({ data: { current: { type: "pool" } } }, assignedPatient)
    );
    expect(result).toEqual({
      kind: "unassign",
      patient: assignedPatient,
    });
  });

  test("ignores noop drops", () => {
    expect(resolveDragEndResult(dragEvent(null, poolPatient))).toEqual({ kind: "noop" });
    expect(
      resolveDragEndResult(dragEvent({ data: { current: { type: "staff", staffId: 11 } } }, assignedPatient))
    ).toEqual({ kind: "noop" });
    expect(resolveDragEndResult(dragEvent({ data: { current: { type: "pool" } } }, poolPatient))).toEqual({
      kind: "noop",
    });
    expect(
      resolveDragEndResult(dragEvent({ data: { current: { type: "staff", staffId: 22 } } }, poolPatient), {
        busy: true,
      })
    ).toEqual({ kind: "noop" });
  });
});
