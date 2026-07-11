import type { DragEndEvent } from "@dnd-kit/core";

export type DragEndPatientMeta = {
  patientId: number;
  fromStaffId: number | null;
  caseNumber: string;
  fullName: string | null;
};

export type DragEndResult =
  | { kind: "noop" }
  | { kind: "assign"; patientId: number; staffId: number }
  | { kind: "unassign"; patient: DragEndPatientMeta };

export function resolveDragEndResult(event: DragEndEvent, options?: { busy?: boolean }): DragEndResult {
  const { active, over } = event;
  if (!over || options?.busy) {
    return { kind: "noop" };
  }

  const patientId = Number(active.data.current?.patientId);
  const fromStaffId =
    active.data.current?.fromStaffId === null || active.data.current?.fromStaffId === undefined
      ? null
      : Number(active.data.current.fromStaffId);
  if (!Number.isFinite(patientId) || patientId <= 0) {
    return { kind: "noop" };
  }

  const patient: DragEndPatientMeta = {
    patientId,
    fromStaffId,
    caseNumber: String(active.data.current?.caseNumber ?? ""),
    fullName: (active.data.current?.fullName as string | null) ?? null,
  };

  const overType = over.data.current?.type;
  if (overType === "pool") {
    if (fromStaffId === null) {
      return { kind: "noop" };
    }
    return { kind: "unassign", patient };
  }

  if (overType === "staff") {
    const staffId = Number(over.data.current?.staffId);
    if (!Number.isFinite(staffId) || staffId <= 0) {
      return { kind: "noop" };
    }
    if (fromStaffId === staffId) {
      return { kind: "noop" };
    }
    return { kind: "assign", patientId, staffId };
  }

  return { kind: "noop" };
}
