"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AdminIdentityItem, AdminPatientAssignmentByStaffPatientItem } from "@/lib/api/staff";

import { genderBadgeLabel, staffDisplayName } from "./lot-math";
import type { PatientTilePatient } from "./patient-tile";
import { PersonAvatar } from "./person-avatar";

export type StaffSheetFocus = "assigned" | "add";

type StaffDetailSheetProps = {
  open: boolean;
  staff: AdminIdentityItem | null;
  assignedPatients: AdminPatientAssignmentByStaffPatientItem[];
  unassignedPatients: PatientTilePatient[];
  focus: StaffSheetFocus;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (patientId: number) => void;
  onRemove: (patient: AdminPatientAssignmentByStaffPatientItem) => void;
};

export function StaffDetailSheet({
  open,
  staff,
  assignedPatients,
  unassignedPatients,
  focus,
  busy,
  onOpenChange,
  onAdd,
  onRemove,
}: StaffDetailSheetProps) {
  const [addQuery, setAddQuery] = useState("");
  const title = staff ? staffDisplayName(staff.real_name, staff.display_name) : "";

  const filteredUnassigned = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) {
      return unassignedPatients;
    }
    return unassignedPatients.filter((patient) => {
      const name = (patient.patient_full_name ?? "").toLowerCase();
      return name.includes(q) || patient.case_number.toLowerCase().includes(q);
    });
  }, [addQuery, unassignedPatients]);

  return (
    <Sheet
      open={open && Boolean(staff)}
      onOpenChange={onOpenChange}
      side="bottom"
      aria-label={staff ? `${title} 詳情` : "人員詳情"}
    >
      {staff ? (
        <>
          <SheetHeader>
            <div className="flex items-center gap-3">
              <PersonAvatar name={title} pictureUrl={staff.picture_url} size="lg" />
              <div className="min-w-0">
                <SheetTitle>{title}</SheetTitle>
                <p className="truncate text-xs text-zinc-500">
                  {staff.display_name ? `LINE: ${staff.display_name}` : staff.line_user_id}
                  {" · "}
                  {staff.role}
                  {" · "}
                  {staff.is_active ? "active" : "inactive"}
                </p>
              </div>
            </div>
          </SheetHeader>
          <SheetBody className="space-y-5">
            <section id="staff-sheet-assigned" className={focus === "assigned" ? "scroll-mt-2" : undefined}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">負責病患</h3>
              {assignedPatients.length === 0 ? (
                <p className="text-xs text-zinc-400">目前無指派病患</p>
              ) : (
                <ul className="space-y-2">
                  {assignedPatients.map((patient) => {
                    const name = patient.patient_full_name?.trim() || "未命名";
                    return (
                      <li
                        key={patient.patient_id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <PersonAvatar name={name} pictureUrl={patient.picture_url} size="md" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900">{name}</p>
                            <p className="text-[11px] text-zinc-500">
                              {patient.case_number} · {genderBadgeLabel(patient.gender)}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onRemove(patient)}
                          aria-label={`移除病患 ${patient.case_number} 指派`}
                        >
                          移除
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section id="staff-sheet-add" className={focus === "add" ? "scroll-mt-2" : undefined}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">新增病患</h3>
              <Input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="搜尋未分配病患…"
                aria-label="搜尋可加入病患"
                className="mb-2 h-8 text-sm"
              />
              {filteredUnassigned.length === 0 ? (
                <p className="text-xs text-zinc-400">沒有可加入的未分配病患</p>
              ) : (
                <ul className="space-y-2">
                  {filteredUnassigned.map((patient) => {
                    const name = patient.patient_full_name?.trim() || "未命名";
                    return (
                      <li
                        key={patient.patient_id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <PersonAvatar name={name} pictureUrl={patient.picture_url} size="md" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <p className="text-[11px] text-zinc-500">
                              {patient.case_number} · {genderBadgeLabel(patient.gender)}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" disabled={busy} onClick={() => onAdd(patient.patient_id)}>
                          加入
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </SheetBody>
        </>
      ) : null}
    </Sheet>
  );
}
