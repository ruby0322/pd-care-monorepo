"use client";

import type { PatientTilePatient } from "./patient-tile";
import { PatientTile } from "./patient-tile";

type PatientDragOverlayProps = {
  patient: PatientTilePatient;
  fromStaffId: number | null;
};

export function PatientDragOverlay({ patient, fromStaffId }: PatientDragOverlayProps) {
  return (
    <div data-testid="patient-drag-overlay">
      <PatientTile
        patient={patient}
        dragId={`overlay-${patient.patient_id}`}
        fromStaffId={fromStaffId}
        disabled
        className="h-12 w-[148px] shadow-lg"
      />
    </div>
  );
}
