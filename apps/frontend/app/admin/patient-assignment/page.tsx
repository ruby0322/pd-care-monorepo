"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  type AdminBindingFilter,
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

import type { PatientTilePatient } from "./patient-tile";
import { StaffAssigneeCard } from "./staff-assignee-card";
import { StaffDetailSheet, type StaffSheetFocus } from "./staff-detail-sheet";
import { UnassignedPool } from "./unassigned-pool";

const STAFF_PAGE_SIZE = 200;
const POOL_PAGE_SIZE = 200;

function useLotLayout() {
  const [layout, setLayout] = useState({ rows: 2, columns: 4, capacity: 8 });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(min-width: 768px)");
    const apply = () => {
      if (media.matches) {
        setLayout({ rows: 2, columns: 4, capacity: 8 });
        return;
      }
      setLayout({ rows: 1, columns: 4, capacity: 4 });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
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
  const parsedFilters = useMemo(() => parseAssignmentFilters(searchParams), [searchParams]);
  const lotLayout = useLotLayout();

  const [bindingFilter, setBindingFilter] = useState<AdminBindingFilter>(parsedFilters.binding);
  const [keyword, setKeyword] = useState(parsedFilters.q);
  const [keywordDraft, setKeywordDraft] = useState(parsedFilters.q);
  const filterSyncKey = `${parsedFilters.binding}::${parsedFilters.q}`;
  const [lastFilterSyncKey, setLastFilterSyncKey] = useState(filterSyncKey);
  if (lastFilterSyncKey !== filterSyncKey) {
    setLastFilterSyncKey(filterSyncKey);
    setBindingFilter(parsedFilters.binding);
    setKeyword(parsedFilters.q);
    setKeywordDraft(parsedFilters.q);
  }

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [assigneeUsers, setAssigneeUsers] = useState<AdminIdentityItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [poolPatients, setPoolPatients] = useState<PatientTilePatient[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [assignedPatientsByStaffId, setAssignedPatientsByStaffId] = useState<
    Record<number, AdminPatientAssignmentByStaffPatientItem[]>
  >({});

  const [sheetStaffId, setSheetStaffId] = useState<number | null>(null);
  const [sheetFocus, setSheetFocus] = useState<StaffSheetFocus>("assigned");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    patientId: number;
    caseNumber: string;
    fullName: string | null;
  } | null>(null);

  const queryString = useMemo(
    () =>
      assignmentFiltersToSearchParams({
        q: keyword.trim(),
        binding: bindingFilter,
        assignment: "unassigned",
      }).toString(),
    [bindingFilter, keyword]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const replaceFilters = useCallback(
    (next: { q: string; binding: AdminBindingFilter }) => {
      setKeyword(next.q.trim());
      setBindingFilter(next.binding);
      setKeywordDraft(next.q.trim());
      const params = assignmentFiltersToSearchParams({
        q: next.q.trim(),
        binding: next.binding,
        assignment: "unassigned",
      }).toString();
      const href = params ? `${pathname}?${params}` : pathname;
      router.replace(href, { scroll: false });
    },
    [pathname, router]
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

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (currentQuery === queryString) {
      return;
    }
    const href = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(href, { scroll: false });
  }, [pathname, queryString, router, searchParams]);

  const loadAssigneesWithAssignments = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await fetchAdminUsersPage({
        limit: STAFF_PAGE_SIZE,
        offset: 0,
      });
      const users = data.items.filter((user) => user.role === "staff" || user.role === "admin");
      setAssigneeUsers(users);
      const staffIds = users.map((user) => user.id);
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
  }, []);

  const loadPool = useCallback(async () => {
    setPoolLoading(true);
    try {
      const data = await fetchAdminAssignments({
        query: keyword.trim() || undefined,
        bindingFilter,
        assignmentFilter: "unassigned",
        limit: POOL_PAGE_SIZE,
        offset: 0,
      });
      setPoolPatients(data.items.map(toTilePatient));
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setPoolLoading(false);
    }
  }, [bindingFilter, keyword]);

  const refreshBoard = useCallback(async () => {
    await Promise.all([loadPool(), loadAssigneesWithAssignments()]);
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || busy) {
      return;
    }
    const patientId = Number(active.data.current?.patientId);
    const fromStaffId =
      active.data.current?.fromStaffId === null || active.data.current?.fromStaffId === undefined
        ? null
        : Number(active.data.current.fromStaffId);
    if (!Number.isFinite(patientId) || patientId <= 0) {
      return;
    }

    const overType = over.data.current?.type;
    if (overType === "pool") {
      if (fromStaffId === null) {
        return;
      }
      setRemoveTarget({
        patientId,
        caseNumber: String(active.data.current?.caseNumber ?? ""),
        fullName: (active.data.current?.fullName as string | null) ?? null,
      });
      return;
    }

    if (overType === "staff") {
      const staffId = Number(over.data.current?.staffId);
      if (!Number.isFinite(staffId) || staffId <= 0) {
        return;
      }
      if (fromStaffId === staffId) {
        return;
      }
      void assignPatient(patientId, staffId);
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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <UnassignedPool
          patients={poolPatients}
          loading={poolLoading}
          keywordDraft={keywordDraft}
          bindingFilter={bindingFilter}
          busy={busy}
          onKeywordDraftChange={setKeywordDraft}
          onKeywordSubmit={() => replaceFilters({ q: keywordDraft, binding: bindingFilter })}
          onBindingFilterChange={(value) => replaceFilters({ q: keyword, binding: value })}
        />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">可指派人員</h2>
            {usersLoading ? <span className="text-xs text-zinc-500">載入中…</span> : null}
          </div>
          {assigneeUsers.length === 0 && !usersLoading ? (
            <p className="text-sm text-zinc-500">目前沒有可指派人員</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {assigneeUsers.map((staff) => (
                <StaffAssigneeCard
                  key={staff.id}
                  staff={staff}
                  patients={assignedPatientsByStaffId[staff.id] ?? []}
                  capacity={lotLayout.capacity}
                  rows={lotLayout.rows}
                  columns={lotLayout.columns}
                  busy={busy}
                  onOpenCard={() => openSheet(staff.id, "assigned")}
                  onOpenAdd={() => openSheet(staff.id, "add")}
                  onOpenOverflow={() => openSheet(staff.id, "assigned")}
                />
              ))}
            </div>
          )}
        </section>
      </DndContext>

      <StaffDetailSheet
        open={sheetStaffId !== null}
        staff={sheetStaff}
        assignedPatients={sheetStaffId !== null ? (assignedPatientsByStaffId[sheetStaffId] ?? []) : []}
        unassignedPatients={poolPatients}
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
