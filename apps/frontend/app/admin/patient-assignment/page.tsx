"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  type AdminAssignmentFilters,
  assignmentFiltersToSearchParams,
  parseAssignmentFilters,
} from "@/lib/admin/filters";
import { getReadableApiError } from "@/lib/api/client";
import {
  type AdminIdentityItem,
  type AdminPatientAssignmentByStaffPatientItem,
  type AdminPatientAssignmentItem,
  fetchAdminAssignments,
  fetchAdminAssignmentsByStaff,
  fetchAdminUsersPage,
  fetchStaffMe,
  unassignAdminAssignment,
  upsertAdminAssignment,
} from "@/lib/api/staff";

import { STAFF_PAGE_SIZE } from "./constants";
import { resolveDragEndResult } from "./drag-end";
import { PatientDragOverlay } from "./patient-drag-overlay";
import type { PatientTilePatient } from "./patient-tile";
import { StaffAssigneeSection } from "./staff-assignee-section";
import { StaffDetailSheet, type StaffSheetFocus } from "./staff-detail-sheet";
import { UnassignedPool } from "./unassigned-pool";

type ActiveDragPatient = {
  patient: PatientTilePatient;
  fromStaffId: number | null;
};

const LOT_LAYOUT_MEDIA_QUERIES = [
  "(min-width: 1280px)",
  "(min-width: 1024px)",
  "(min-width: 768px)",
  "(min-width: 640px)",
];

function useLotLayout() {
  const [layout, setLayout] = useState({ rows: 2, columns: 4, capacity: 8 });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const apply = () => {
      let nextLayout: typeof layout;
      if (window.matchMedia("(min-width: 1280px)").matches) {
        nextLayout = { rows: 2, columns: 4, capacity: 8 };
      } else if (window.matchMedia("(min-width: 1024px)").matches) {
        nextLayout = { rows: 2, columns: 4, capacity: 8 };
      } else if (window.matchMedia("(min-width: 768px)").matches) {
        nextLayout = { rows: 2, columns: 4, capacity: 8 };
      } else if (window.matchMedia("(min-width: 640px)").matches) {
        nextLayout = { rows: 1, columns: 4, capacity: 4 };
      } else {
        nextLayout = { rows: 1, columns: 4, capacity: 4 };
      }

      setLayout((current) =>
        current.rows === nextLayout.rows &&
        current.columns === nextLayout.columns &&
        current.capacity === nextLayout.capacity
          ? current
          : nextLayout
      );
    };
    apply();
    const mediaQueries = LOT_LAYOUT_MEDIA_QUERIES.map((query) => window.matchMedia(query));
    for (const mediaQuery of mediaQueries) {
      mediaQuery.addEventListener("change", apply);
    }
    return () => {
      for (const mediaQuery of mediaQueries) {
        mediaQuery.removeEventListener("change", apply);
      }
    };
  }, []);

  return layout;
}

function toTilePatient(patient: AdminPatientAssignmentItem | AdminPatientAssignmentByStaffPatientItem): PatientTilePatient {
  return {
    patient_id: patient.patient_id,
    case_number: patient.case_number,
    patient_full_name: patient.patient_full_name,
    gender: patient.gender ?? "unknown",
    picture_url: patient.picture_url ?? null,
  };
}

export default function AdminPatientAssignmentPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const parsedFilters = useMemo(
    () => parseAssignmentFilters(new URLSearchParams(searchParamsKey)),
    [searchParamsKey]
  );

  const filterSyncKey = `${parsedFilters.binding}::${parsedFilters.excludeStaffAdminPatients}::${parsedFilters.q}::${parsedFilters.poolPage}`;
  const staffFilterSyncKey = `${parsedFilters.staffQ}::${parsedFilters.staffPage}::${parsedFilters.staffSort}`;

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [assigneeUsers, setAssigneeUsers] = useState<AdminIdentityItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [poolPatients, setPoolPatients] = useState<PatientTilePatient[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolPageSize, setPoolPageSize] = useState(12);
  const [staffTotal, setStaffTotal] = useState(0);
  const [assignedPatientsByStaffId, setAssignedPatientsByStaffId] = useState<
    Record<number, AdminPatientAssignmentByStaffPatientItem[]>
  >({});
  const [boardRevision, setBoardRevision] = useState(0);

  const [sheetStaffId, setSheetStaffId] = useState<number | null>(null);
  const [sheetFocus, setSheetFocus] = useState<StaffSheetFocus>("assigned");
  const [activeDragPatient, setActiveDragPatient] = useState<ActiveDragPatient | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    patientId: number;
    caseNumber: string;
    fullName: string | null;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const replaceAssignmentUrl = useCallback(
    (patch: Partial<AdminAssignmentFilters>) => {
      const params = assignmentFiltersToSearchParams({
        q: patch.q ?? parsedFilters.q,
        binding: patch.binding ?? parsedFilters.binding,
        assignment: "unassigned",
        excludeStaffAdminPatients: patch.excludeStaffAdminPatients ?? parsedFilters.excludeStaffAdminPatients,
        poolPage: patch.poolPage ?? parsedFilters.poolPage,
        staffQ: patch.staffQ ?? parsedFilters.staffQ,
        staffPage: patch.staffPage ?? parsedFilters.staffPage,
        staffSort: patch.staffSort ?? parsedFilters.staffSort,
      }).toString();
      const href = params ? `${pathname}?${params}` : pathname;
      router.replace(href, { scroll: false });
    },
    [parsedFilters, pathname, router]
  );
  const lotLayout = useLotLayout();
  const handlePoolPageSizeChange = useCallback(
    (nextPageSize: number) => {
      if (nextPageSize === poolPageSize) {
        return;
      }
      setPoolPageSize(nextPageSize);
      if (parsedFilters.poolPage > 1) {
        replaceAssignmentUrl({ poolPage: 1 });
      }
    },
    [parsedFilters.poolPage, poolPageSize, replaceAssignmentUrl]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const run = async () => {
        setCheckingAccess(true);
        setError(null);
        try {
          const me = await fetchStaffMe();
          if (me.role !== "admin") {
            setIsAdmin(false);
            setAssigneeUsers([]);
            setPoolPatients([]);
            return;
          }
          setIsAdmin(true);
        } catch (requestError) {
          setError(getReadableApiError(requestError));
          setIsAdmin(false);
        } finally {
          setCheckingAccess(false);
        }
      };
      void run();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadAssigneesWithAssignments = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await fetchAdminUsersPage({
        query: parsedFilters.staffQ.trim() || undefined,
        isActive: true,
        sort: parsedFilters.staffSort,
        limit: STAFF_PAGE_SIZE,
        offset: (parsedFilters.staffPage - 1) * STAFF_PAGE_SIZE,
      });
      setStaffTotal(data.total);
      setAssigneeUsers(data.items);

      const currentOffset = (parsedFilters.staffPage - 1) * STAFF_PAGE_SIZE;
      if (data.total > 0 && currentOffset >= data.total) {
        const lastPage = Math.max(1, Math.ceil(data.total / STAFF_PAGE_SIZE));
        if (lastPage !== parsedFilters.staffPage) {
          replaceAssignmentUrl({ staffPage: lastPage });
          return;
        }
      }

      const staffIds = data.items.map((user) => user.id);
      if (staffIds.length === 0) {
        setAssignedPatientsByStaffId({});
        return;
      }
      const byStaff = await fetchAdminAssignmentsByStaff({ staffIdentityIds: staffIds });
      const next: Record<number, AdminPatientAssignmentByStaffPatientItem[]> = {};
      for (const item of byStaff.items) {
        next[item.staff_identity_id] = item.assigned_patients;
      }
      for (const staffId of staffIds) {
        if (!(staffId in next)) {
          next[staffId] = [];
        }
      }
      setAssignedPatientsByStaffId(next);
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setUsersLoading(false);
    }
  }, [parsedFilters.staffPage, parsedFilters.staffQ, parsedFilters.staffSort, replaceAssignmentUrl]);

  const loadPool = useCallback(async () => {
    setPoolLoading(true);
    try {
      const data = await fetchAdminAssignments({
        query: parsedFilters.q.trim() || undefined,
        bindingFilter: parsedFilters.binding,
        assignmentFilter: "unassigned",
        excludeStaffAdminPatients: parsedFilters.excludeStaffAdminPatients,
        limit: poolPageSize,
        offset: (parsedFilters.poolPage - 1) * poolPageSize,
      });
      setPoolTotal(data.total);
      setPoolPatients(data.items.map(toTilePatient));
      const currentOffset = (parsedFilters.poolPage - 1) * poolPageSize;
      if (data.total > 0 && currentOffset >= data.total) {
        replaceAssignmentUrl({ poolPage: Math.max(1, Math.ceil(data.total / poolPageSize)) });
      }
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setPoolLoading(false);
    }
  }, [
    poolPageSize,
    parsedFilters.binding,
    parsedFilters.excludeStaffAdminPatients,
    parsedFilters.poolPage,
    parsedFilters.q,
    replaceAssignmentUrl,
  ]);

  const refreshBoard = useCallback(async () => {
    await Promise.all([loadPool(), loadAssigneesWithAssignments()]);
    setBoardRevision((current) => current + 1);
  }, [loadAssigneesWithAssignments, loadPool]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadAssigneesWithAssignments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadAssigneesWithAssignments]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadPool();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadPool]);

  const sheetStaff = useMemo(
    () => assigneeUsers.find((user) => user.id === sheetStaffId) ?? null,
    [assigneeUsers, sheetStaffId]
  );

  const openSheet = (staffId: number, focus: StaffSheetFocus) => {
    setSheetStaffId(staffId);
    setSheetFocus(focus);
  };

  const assignPatient = async (patientId: number, staffIdentityId: number) => {
    setBusy(true);
    setError(null);
    try {
      await upsertAdminAssignment({ patient_id: patientId, staff_identity_id: staffIdentityId });
      toast.success("已更新指派");
      await refreshBoard();
    } catch (requestError) {
      const message = getReadableApiError(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const confirmUnassign = async () => {
    if (!removeTarget) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unassignAdminAssignment(removeTarget.patientId);
      toast.success("已移除指派");
      setRemoveTarget(null);
      await refreshBoard();
    } catch (requestError) {
      const message = getReadableApiError(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    const patientId = Number(data?.patientId);
    if (!Number.isFinite(patientId) || patientId <= 0) {
      return;
    }
    const fromStaffId =
      data?.fromStaffId === null || data?.fromStaffId === undefined ? null : Number(data.fromStaffId);
    const gender = data?.gender;
    const pictureUrl = data?.pictureUrl;
    setActiveDragPatient({
      patient: {
        patient_id: patientId,
        case_number: String(data?.caseNumber ?? ""),
        patient_full_name: (data?.fullName as string | null) ?? null,
        gender:
          gender === "male" || gender === "female" || gender === "other" || gender === "unknown" ? gender : "unknown",
        picture_url: (pictureUrl as string | null) ?? null,
      },
      fromStaffId: Number.isFinite(fromStaffId) ? fromStaffId : null,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragPatient(null);
    const result = resolveDragEndResult(event, { busy });
    if (result.kind === "assign") {
      void assignPatient(result.patientId, result.staffId);
      return;
    }
    if (result.kind === "unassign") {
      setRemoveTarget({
        patientId: result.patient.patientId,
        caseNumber: result.patient.caseNumber,
        fullName: result.patient.fullName,
      });
    }
  };

  if (checkingAccess) {
    return <main className="p-6 text-sm text-zinc-600">檢查權限中…</main>;
  }

  if (!isAdmin) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold text-zinc-900">病患分配</h1>
        <p className="mt-2 text-sm text-zinc-600">僅管理員可使用此頁面。</p>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">病患分配</h1>
        <p className="mt-1 text-sm text-zinc-500">以拖曳方式將未分配病患指派給人員；點卡片可開啟詳細操作。</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragPatient(null)}
      >
        {activeDragPatient ? (
          <div className="pointer-events-none fixed inset-0 z-30 bg-zinc-900/45" aria-hidden />
        ) : null}

        <UnassignedPool
          key={filterSyncKey}
          patients={poolPatients}
          total={poolTotal}
          loading={poolLoading}
          initialKeyword={parsedFilters.q}
          bindingFilter={parsedFilters.binding}
          excludeStaffAdminPatients={parsedFilters.excludeStaffAdminPatients}
          page={parsedFilters.poolPage}
          pageSize={poolPageSize}
          busy={busy}
          elevateForDrop={Boolean(activeDragPatient)}
          onKeywordSubmit={(draft) => replaceAssignmentUrl({ q: draft, binding: parsedFilters.binding, poolPage: 1 })}
          onBindingFilterChange={(value) => replaceAssignmentUrl({ q: parsedFilters.q, binding: value, poolPage: 1 })}
          onExcludeStaffAdminPatientsChange={(value) =>
            replaceAssignmentUrl({ excludeStaffAdminPatients: value, poolPage: 1 })
          }
          onPageChange={(poolPage) => replaceAssignmentUrl({ poolPage })}
          onPageSizeChange={handlePoolPageSizeChange}
        />

        <StaffAssigneeSection
          key={staffFilterSyncKey}
          staff={assigneeUsers}
          assignedPatientsByStaffId={assignedPatientsByStaffId}
          total={staffTotal}
          page={parsedFilters.staffPage}
          pageSize={STAFF_PAGE_SIZE}
          loading={usersLoading}
          initialQuery={parsedFilters.staffQ}
          capacity={lotLayout.capacity}
          rows={lotLayout.rows}
          columns={lotLayout.columns}
          busy={busy}
          elevateForDrop={Boolean(activeDragPatient)}
          onSearch={(draft) => replaceAssignmentUrl({ staffQ: draft, staffPage: 1 })}
          onPageChange={(nextPage) => replaceAssignmentUrl({ staffQ: parsedFilters.staffQ, staffPage: nextPage })}
          staffSort={parsedFilters.staffSort}
          onStaffSortChange={(staffSort) => replaceAssignmentUrl({ staffSort, staffPage: 1 })}
          onOpenCard={(staffId) => openSheet(staffId, "assigned")}
          onOpenAdd={(staffId) => openSheet(staffId, "add")}
          onOpenOverflow={(staffId) => openSheet(staffId, "assigned")}
        />

        <DragOverlay dropAnimation={null} style={{ zIndex: 50 }}>
          {activeDragPatient ? (
            <PatientDragOverlay
              patient={activeDragPatient.patient}
              fromStaffId={activeDragPatient.fromStaffId}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <StaffDetailSheet
        open={sheetStaffId !== null}
        staff={sheetStaff}
        assignedPatients={sheetStaffId !== null ? (assignedPatientsByStaffId[sheetStaffId] ?? []) : []}
        bindingFilter={parsedFilters.binding}
        boardRevision={boardRevision}
        focus={sheetFocus}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) {
            setSheetStaffId(null);
          }
        }}
        onAdd={(patientId) => {
          if (sheetStaffId === null) {
            return;
          }
          void assignPatient(patientId, sheetStaffId);
        }}
        onRemove={(patient) => {
          setRemoveTarget({
            patientId: patient.patient_id,
            caseNumber: patient.case_number,
            fullName: patient.patient_full_name,
          });
        }}
      />

      {removeTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl" role="dialog" aria-modal="true" aria-label="確認移除指派">
            <h3 className="text-base font-semibold text-zinc-900">確認移除指派</h3>
            <p className="mt-2 text-sm text-zinc-600">
              確定要移除{" "}
              <span className="font-medium text-zinc-900">
                {removeTarget.caseNumber}
                {removeTarget.fullName ? ` · ${removeTarget.fullName}` : ""}
              </span>{" "}
              的主責人員嗎？
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setRemoveTarget(null)}>
                取消
              </Button>
              <Button variant="destructive" disabled={busy} onClick={() => void confirmUnassign()}>
                確認移除
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
