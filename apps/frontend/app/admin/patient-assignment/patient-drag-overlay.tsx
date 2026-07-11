"use client";

import type { PatientTilePatient } from "./patient-tile";
import { PatientTile } from "./patient-tile";

type PatientDragOverlayProps = {
  patient: PatientTilePatient;
  mode: "chip" | "square";
  fromStaffId: number | null;
};

export function PatientDragOverlay({ patient, mode, fromStaffId }: PatientDragOverlayProps) {
  return (
    <PatientTile
      patient={patient}
      mode={mode}
      dragId={`overlay-${patient.patient_id}`}
      fromStaffId={fromStaffId}
      disabled
      className={mode === "chip" ? "h-12 w-[148px] shadow-lg" : "h-16 w-16 shadow-lg"}
    />
  );
}
