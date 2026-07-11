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

import { resolveDragEndResult } from "./drag-end";
import type { PatientTilePatient } from "./patient-tile";
import { StaffAssigneeSection } from "./staff-assignee-section";
import { StaffDetailSheet, type StaffSheetFocus } from "./staff-detail-sheet";
import { UnassignedPool } from "./unassigned-pool";

const STAFF_PAGE_SIZE = 12;
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
  const [staffQuery, setStaffQuery] = useState(parsedFilters.staffQ);
  const [staffPage, setStaffPage] = useState(parsedFilters.staffPage);
  const filterSyncKey = `${parsedFilters.binding}::${parsedFilters.q}`;
  const staffFilterSyncKey = `${parsedFilters.staffQ}::${parsedFilters.staffPage}`;

  // Sync local filters when the URL changes externally (e.g. browser navigation).
  /* eslint-disable react-hooks/set-state-in-effect -- mirror URL search params into editable filter state */
  useEffect(() => {
    setBindingFilter(parsedFilters.binding);
    setKeyword(parsedFilters.q);
    setStaffQuery(parsedFilters.staffQ);
    setStaffPage(parsedFilters.staffPage);
  }, [parsedFilters.binding, parsedFilters.q, parsedFilters.staffPage, parsedFilters.staffQ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [assigneeUsers, setAssigneeUsers] = useState<AdminIdentityItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [poolPatients, setPoolPatients] = useState<PatientTilePatient[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolLoadingMore, setPoolLoadingMore] = useState(false);
  const [staffTotal, setStaffTotal] = useState(0);
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
        staffQ: staffQuery.trim(),
        staffPage,
      }).toString(),
    [bindingFilter, keyword, staffPage, staffQuery]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const replaceFilters = useCallback(
    (next: { q: string; binding: AdminBindingFilter }) => {
      const trimmed = next.q.trim();
      setKeyword(trimmed);
      setBindingFilter(next.binding);
      const params = assignmentFiltersToSearchParams({
        q: trimmed,
        binding: next.binding,
        assignment: "unassigned",
        staffQ: staffQuery.trim(),
        staffPage,
      }).toString();
      const href = params ? `${pathname}?${params}` : pathname;
      router.replace(href, { scroll: false });
    },
    [pathname, router, staffPage, staffQuery]
  );

  const replaceStaffFilters = useCallback(
    (next: { staffQ: string; staffPage: number }) => {
      const trimmed = next.staffQ.trim();
      setStaffQuery(trimmed);
      setStaffPage(next.staffPage);
      const params = assignmentFiltersToSearchParams({
        q: keyword.trim(),
        binding: bindingFilter,
        assignment: "unassigned",
        staffQ: trimmed,
        staffPage: next.staffPage,
      }).toString();
      const href = params ? `${pathname}?${params}` : pathname;
      router.replace(href, { scroll: false });
    },
    [bindingFilter, keyword, pathname, router]
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
        query: staffQuery.trim() || undefined,
        limit: STAFF_PAGE_SIZE,
        offset: (staffPage - 1) * STAFF_PAGE_SIZE,
      });
      setStaffTotal(data.total);
      setAssigneeUsers(data.items);

      const currentOffset = (staffPage - 1) * STAFF_PAGE_SIZE;
      if (data.total > 0 && currentOffset >= data.total) {
        const lastPage = Math.max(1, Math.ceil(data.total / STAFF_PAGE_SIZE));
        if (lastPage !== staffPage) {
          replaceStaffFilters({ staffQ: staffQuery, staffPage: lastPage });
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
  }, [replaceStaffFilters, staffPage, staffQuery]);

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
      setPoolTotal(data.total);
      setPoolPatients(data.items.map(toTilePatient));
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setPoolLoading(false);
    }
  }, [bindingFilter, keyword]);

  const loadMorePool = useCallback(async () => {
    if (poolLoadingMore || poolPatients.length >= poolTotal) {
      return;
    }
    setPoolLoadingMore(true);
    try {
      const data = await fetchAdminAssignments({
        query: keyword.trim() || undefined,
        bindingFilter,
        assignmentFilter: "unassigned",
        limit: POOL_PAGE_SIZE,
        offset: poolPatients.length,
      });
      setPoolTotal(data.total);
      setPoolPatients((current) => [...current, ...data.items.map(toTilePatient)]);
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setPoolLoadingMore(false);
    }
  }, [bindingFilter, keyword, poolLoadingMore, poolPatients.length, poolTotal]);

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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <UnassignedPool
          key={filterSyncKey}
          patients={poolPatients}
          total={poolTotal}
          loading={poolLoading}
          loadingMore={poolLoadingMore}
          initialKeyword={keyword}
          bindingFilter={bindingFilter}
          busy={busy}
          onKeywordSubmit={(draft) => replaceFilters({ q: draft, binding: bindingFilter })}
          onBindingFilterChange={(value) => replaceFilters({ q: keyword, binding: value })}
          onLoadMore={() => void loadMorePool()}
        />

        <StaffAssigneeSection
          key={staffFilterSyncKey}
          staff={assigneeUsers}
          assignedPatientsByStaffId={assignedPatientsByStaffId}
          total={staffTotal}
          page={staffPage}
          pageSize={STAFF_PAGE_SIZE}
          loading={usersLoading}
          initialQuery={staffQuery}
          capacity={lotLayout.capacity}
          rows={lotLayout.rows}
          columns={lotLayout.columns}
          busy={busy}
          onSearch={(draft) => replaceStaffFilters({ staffQ: draft, staffPage: 1 })}
          onPageChange={(nextPage) => replaceStaffFilters({ staffQ: staffQuery, staffPage: nextPage })}
          onOpenCard={(staffId) => openSheet(staffId, "assigned")}
          onOpenAdd={(staffId) => openSheet(staffId, "add")}
          onOpenOverflow={(staffId) => openSheet(staffId, "assigned")}
        />
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
