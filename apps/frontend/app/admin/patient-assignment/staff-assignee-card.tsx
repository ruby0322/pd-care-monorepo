"use client";

/* dnd-kit exposes setNodeRef/isOver from hooks for render-time use; React Compiler refs rule is a false positive here. */
/* eslint-disable react-hooks/refs */

import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AdminIdentityItem, AdminPatientAssignmentByStaffPatientItem } from "@/lib/api/staff";

import { buildPatientLot, staffDisplayName } from "./lot-math";
import { PersonAvatar } from "./person-avatar";
import { PatientTile } from "./patient-tile";

type StaffAssigneeCardProps = {
  staff: AdminIdentityItem;
  patients: AdminPatientAssignmentByStaffPatientItem[];
  capacity: number;
  rows: number;
  columns: number;
  busy?: boolean;
  elevateForDrop?: boolean;
  onOpenCard: () => void;
  onOpenAdd: () => void;
  onOpenOverflow: () => void;
};

export function StaffAssigneeCard({
  staff,
  patients,
  capacity,
  rows,
  columns,
  busy,
  elevateForDrop,
  onOpenCard,
  onOpenAdd,
  onOpenOverflow,
}: StaffAssigneeCardProps) {
  const droppable = useDroppable({
    id: `staff-${staff.id}`,
    data: { type: "staff", staffId: staff.id },
  });
  const addDroppable = useDroppable({
    id: `staff-add-${staff.id}`,
    data: { type: "staff", staffId: staff.id },
  });

  const title = staffDisplayName(staff.real_name, staff.display_name);
  const lot = buildPatientLot(patients.length, capacity);
  const isOver = droppable.isOver || addDroppable.isOver;

  return (
    <article
      ref={droppable.setNodeRef}
      className={cn(
        "flex h-[168px] flex-col rounded-xl border border-zinc-200 bg-white p-3 shadow-sm md:h-[188px]",
        elevateForDrop && "relative z-40 shadow-lg ring-1 ring-zinc-200",
        isOver && "ring-2 ring-zinc-400"
      )}
    >
      <button
        type="button"
        className="mb-2 flex min-w-0 cursor-pointer items-center gap-2 text-left disabled:cursor-default"
        onClick={onOpenCard}
        disabled={busy}
      >
        <PersonAvatar name={title} pictureUrl={staff.picture_url} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{title}</p>
          {staff.real_name?.trim() && staff.display_name?.trim() ? (
            <p className="truncate text-[11px] text-zinc-500">LINE: {staff.display_name}</p>
          ) : (
            <p className="truncate text-[11px] text-zinc-500">
              {staff.role}
              {staff.is_active ? "" : " · inactive"}
            </p>
          )}
        </div>
      </button>

      <div
        className="grid min-h-0 flex-1 gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {lot.cells.map((cell, index) => {
          if (cell.type === "patient") {
            const patient = patients[cell.patientIndex];
            if (!patient) {
              return <div key={`missing-${index}`} className="rounded-lg bg-zinc-100" />;
            }
            return (
              <PatientTile
                key={`p-${patient.patient_id}`}
                patient={patient}
                dragId={`assigned-${staff.id}-${patient.patient_id}`}
                fromStaffId={staff.id}
                disabled={busy}
                expandOnHoverDesktop
                className="h-full w-full"
              />
            );
          }
          if (cell.type === "overflow") {
            return (
              <button
                key={`overflow-${index}`}
                type="button"
                className="flex h-full w-full cursor-pointer items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold text-zinc-600 disabled:cursor-default"
                onClick={onOpenOverflow}
                disabled={busy}
                aria-label={`查看另外 ${cell.count} 位病患`}
              >
                +{cell.count}
              </button>
            );
          }
          if (cell.type === "add") {
            return (
              <button
                key={`add-${index}`}
                type="button"
                ref={addDroppable.setNodeRef}
                className={cn(
                  "flex h-full w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 disabled:cursor-default",
                  addDroppable.isOver && "border-zinc-500 bg-zinc-100"
                )}
                onClick={onOpenAdd}
                disabled={busy}
                aria-label={`新增病患至 ${title}`}
              >
                <Plus className="h-4 w-4" />
              </button>
            );
          }
          return <div key={`pad-${index}`} className="rounded-lg bg-zinc-100/80" aria-hidden />;
        })}
      </div>
    </article>
  );
}
