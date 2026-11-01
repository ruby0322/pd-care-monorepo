"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AdminBindingFilter } from "@/lib/admin/filters";
import { getReadableApiError } from "@/lib/api/client";
import type { AdminIdentityItem, AdminPatientAssignmentByStaffPatientItem } from "@/lib/api/staff";
import { fetchAdminAssignments } from "@/lib/api/staff";

import { POOL_PAGE_SIZE } from "./constants";
import { formatLastReviewAt, labeledRatioPercent } from "@/lib/admin/staff-overview";

import { genderBadgeLabel, staffDisplayName } from "./lot-math";
import type { PatientTilePatient } from "./patient-tile";
import { PersonAvatar } from "./person-avatar";

export type StaffSheetFocus = "assigned" | "add";

type StaffDetailSheetProps = {
  open: boolean;
  staff: AdminIdentityItem | null;
  assignedPatients: AdminPatientAssignmentByStaffPatientItem[];
  bindingFilter: AdminBindingFilter;
  boardRevision: number;
  focus: StaffSheetFocus;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (patientId: number) => void;
  onRemove: (patient: AdminPatientAssignmentByStaffPatientItem) => void;
};

function toTilePatient(patient: {
  patient_id: number;
  case_number: string;
  patient_full_name: string | null;
  gender?: PatientTilePatient["gender"];
  picture_url?: string | null;
}): PatientTilePatient {
  return {
    patient_id: patient.patient_id,
    case_number: patient.case_number,
    patient_full_name: patient.patient_full_name,
    gender: patient.gender ?? "unknown",
    picture_url: patient.picture_url ?? null,
  };
}

export function StaffDetailSheet({
  open,
  staff,
  assignedPatients,
  bindingFilter,
  boardRevision,
  focus,
  busy,
  onOpenChange,
  onAdd,
  onRemove,
}: StaffDetailSheetProps) {
  const [addQueryDraft, setAddQueryDraft] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [sheetPoolPatients, setSheetPoolPatients] = useState<PatientTilePatient[]>([]);
  const [sheetPoolTotal, setSheetPoolTotal] = useState(0);
  const [sheetPoolLoading, setSheetPoolLoading] = useState(false);
  const [sheetPoolLoadingMore, setSheetPoolLoadingMore] = useState(false);
  const [sheetPoolError, setSheetPoolError] = useState<string | null>(null);
  const addSectionRef = useRef<HTMLElement | null>(null);
  const title = staff ? staffDisplayName(staff.real_name, staff.display_name) : "";

  const loadSheetPool = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setSheetPoolLoadingMore(true);
      } else {
        setSheetPoolLoading(true);
      }
      setSheetPoolError(null);
      try {
        const data = await fetchAdminAssignments({
          query: addQuery.trim() || undefined,
          bindingFilter,
          assignmentFilter: "unassigned",
          limit: POOL_PAGE_SIZE,
          offset,
        });
        setSheetPoolTotal(data.total);
        const nextItems = data.items.map(toTilePatient);
        setSheetPoolPatients((current) => (append ? [...current, ...nextItems] : nextItems));
      } catch (requestError) {
        setSheetPoolError(getReadableApiError(requestError));
        if (!append) {
          setSheetPoolPatients([]);
          setSheetPoolTotal(0);
        }
      } finally {
        setSheetPoolLoading(false);
        setSheetPoolLoadingMore(false);
      }
    },
    [addQuery, bindingFilter]
  );

  /* eslint-disable react-hooks/set-state-in-effect -- load unassigned patients when sheet opens or filters change */
  useEffect(() => {
    if (!open || !staff) {
      return;
    }
    void loadSheetPool(0, false);
  }, [addQuery, boardRevision, bindingFilter, loadSheetPool, open, staff]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || focus !== "add") {
      return;
    }
    const timer = window.setTimeout(() => {
      addSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focus, open, staff?.id]);

  const sheetPoolHasMore = sheetPoolPatients.length < sheetPoolTotal;

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
                </p>
              </div>
            </div>
          </SheetHeader>
          <SheetBody className="space-y-5">
            <section aria-label="工作量">
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">工作量</h3>
              {staff.workload ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-zinc-500">指派病患</dt>
                    <dd className="text-sm tabular-nums text-zinc-900">{staff.workload.assigned_patient_count}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">負責佇列已標註</dt>
                    <dd className="text-sm tabular-nums text-zinc-900">
                      {staff.workload.labeled_assigned_upload_count} / {staff.workload.assigned_upload_count}
                      <span className="ml-1 text-xs text-zinc-500">（{labeledRatioPercent(staff.workload)}%）</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">本人標註數</dt>
                    <dd className="text-sm tabular-nums text-zinc-900">{staff.workload.reviewed_upload_count}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">近 7 / 30 日審核</dt>
                    <dd className="text-sm tabular-nums text-zinc-900">
                      {staff.workload.review_count_7d} / {staff.workload.review_count_30d}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-zinc-500">最近審核</dt>
                    <dd
                      className={
                        staff.workload.review_count_30d === 0 ? "text-sm text-amber-700" : "text-sm text-zinc-900"
                      }
                    >
                      {formatLastReviewAt(staff.workload.last_reviewed_at)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-zinc-400">無工作量資料</p>
              )}
            </section>

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

            <section id="staff-sheet-add" ref={addSectionRef} className={focus === "add" ? "scroll-mt-2" : undefined}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">新增病患</h3>
              <form
                className="mb-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setAddQuery(addQueryDraft.trim());
                }}
              >
                <Input
                  value={addQueryDraft}
                  onChange={(event) => setAddQueryDraft(event.target.value)}
                  placeholder="搜尋未分配病患…"
                  aria-label="搜尋可加入病患"
                  className="h-8 flex-1 text-sm"
                />
                <button type="submit" className="h-8 shrink-0 cursor-pointer rounded-lg bg-zinc-900 px-3 text-xs text-white">
                  搜尋
                </button>
              </form>
              {sheetPoolError ? <p className="mb-2 text-xs text-red-600">{sheetPoolError}</p> : null}
              {sheetPoolLoading ? (
                <p className="text-xs text-zinc-500">載入中…</p>
              ) : sheetPoolPatients.length === 0 ? (
                <p className="text-xs text-zinc-400">沒有可加入的未分配病患</p>
              ) : (
                <ul className="space-y-2">
                  {sheetPoolPatients.map((patient) => {
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
              {sheetPoolHasMore ? (
                <div className="mt-2 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sheetPoolLoading || sheetPoolLoadingMore || busy}
                    onClick={() => void loadSheetPool(sheetPoolPatients.length, true)}
                  >
                    {sheetPoolLoadingMore ? "載入中…" : "載入更多"}
                  </Button>
                </div>
              ) : null}
            </section>
          </SheetBody>
        </>
      ) : null}
    </Sheet>
  );
}
