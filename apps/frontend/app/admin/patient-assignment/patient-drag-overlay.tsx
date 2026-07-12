"use client";

import { PATIENT_TILE_DRAG_SIZE_CLASS } from "./lot-math";
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
        className={`${PATIENT_TILE_DRAG_SIZE_CLASS} shadow-lg`}
      />
    </div>
  );
}
