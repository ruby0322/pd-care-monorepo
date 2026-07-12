"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";

import { genderBadgeClass, genderBadgeLabel } from "./lot-math";
import { PersonAvatar } from "./person-avatar";

export type PatientTilePatient = {
  patient_id: number;
  case_number: string;
  patient_full_name: string | null;
  gender: "male" | "female" | "other" | "unknown";
  picture_url: string | null;
};

type PatientTileProps = {
  patient: PatientTilePatient;
  dragId: string;
  fromStaffId: number | null;
  className?: string;
  disabled?: boolean;
  /** Desktop only: show square avatar cover on hover while defaulting to chip. */
  expandOnHoverDesktop?: boolean;
};

export function PatientTile({
  patient,
  dragId,
  fromStaffId,
  className,
  disabled,
  expandOnHoverDesktop,
}: PatientTileProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: {
      patientId: patient.patient_id,
      fromStaffId,
      caseNumber: patient.case_number,
      fullName: patient.patient_full_name,
      gender: patient.gender,
      pictureUrl: patient.picture_url,
    },
    disabled,
  });

  const name = patient.patient_full_name?.trim() || "未命名";
  const initial = name.slice(0, 1);
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative min-h-0 min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50",
        expandOnHoverDesktop && "group/tile transition-none",
        isDragging && "z-20 opacity-80 shadow-md",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        className
      )}
      {...listeners}
      {...attributes}
    >
      <span
        className={cn(
          "absolute top-0 right-0 z-10 rounded-bl-md px-1.5 py-0.5 text-[9px] font-semibold leading-none",
          genderBadgeClass(patient.gender)
        )}
      >
        {genderBadgeLabel(patient.gender)}
      </span>
      {expandOnHoverDesktop ? (
        <div className="relative h-full w-full transition-none">
          <div className="absolute inset-0 flex items-center justify-center gap-2 px-2 py-1.5 md:group-hover/tile:invisible">
            <PersonAvatar name={name} pictureUrl={patient.picture_url} size="sm" />
            <span className="truncate text-xs font-semibold text-zinc-800">{name}</span>
          </div>
          <div className="absolute inset-0 invisible bg-zinc-300 md:group-hover/tile:visible">
            {patient.picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={patient.picture_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-zinc-600">
                {initial}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center gap-2 px-2 py-1.5">
          <PersonAvatar name={name} pictureUrl={patient.picture_url} size="sm" />
          <span className="truncate text-xs font-semibold text-zinc-800">{name}</span>
        </div>
      )}
    </div>
  );
}
