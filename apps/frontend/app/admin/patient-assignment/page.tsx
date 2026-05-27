"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, X } from "lucide-react";
import { type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getReadableApiError } from "@/lib/api/client";
import {
  AdminIdentityItem,
  AdminPatientAssignmentItem,
  AdminPatientAssignmentByStaffPatientItem,
  bulkUpsertAdminAssignments,
  fetchAdminAssignments,
  fetchAdminAssignmentsByStaff,
  fetchAdminUsersPage,
  fetchStaffMe,
  unassignAdminAssignment,
  upsertAdminAssignment,
} from "@/lib/api/staff";

const DEFAULT_PAGE_SIZE = 10;

export default function AdminPatientAssignmentPage() {
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [assigneeUsers, setAssigneeUsers] = useState<AdminIdentityItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const userPageSize = DEFAULT_PAGE_SIZE;

  const [assignments, setAssignments] = useState<AdminPatientAssignmentItem[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignedPatientsByStaffId, setAssignedPatientsByStaffId] = useState<
    Record<number, AdminPatientAssignmentByStaffPatientItem[]>
  >({});
  const [patientPage, setPatientPage] = useState(1);
  const patientPageSize = DEFAULT_PAGE_SIZE;
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [assigneeRoleFilter, setAssigneeRoleFilter] = useState<"all" | "staff" | "admin">("all");
  const [assigneeActiveFilter, setAssigneeActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");

  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<number>>(new Set());
  const [workingPatientId, setWorkingPatientId] = useState<number | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ patientId: number; caseNumber: string; fullName: string | null } | null>(
    null
  );
  const [assignmentSorting, setAssignmentSorting] = useState<SortingState>([]);

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
            setAssignments([]);
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

  const loadAssignees = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setUsersLoading(true);
    setError(null);
    try {
      const response = await fetchAdminUsersPage({
        limit: userPageSize,
        offset: (userPage - 1) * userPageSize,
      });
      setAssigneeUsers(response.items);
      setUserTotal(response.total);
      if (response.items.length > 0 && (selectedStaffId === null || !response.items.some((item) => item.id === selectedStaffId))) {
        setSelectedStaffId(response.items[0].id);
      }
      const currentOffset = (userPage - 1) * userPageSize;
      if (response.total > 0 && currentOffset >= response.total) {
        setUserPage(Math.max(1, Math.ceil(response.total / userPageSize)));
      }
    } catch (requestError) {
      setError(getReadableApiError(requestError));
      setAssigneeUsers([]);
      setUserTotal(0);
    } finally {
      setUsersLoading(false);
    }
  }, [isAdmin, selectedStaffId, userPage, userPageSize]);

  const loadAssignments = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setAssignmentsLoading(true);
    setError(null);
    try {
      const response = await fetchAdminAssignments({
        query: keyword.trim() || undefined,
        assignmentFilter,
        assigneeRole: assigneeRoleFilter,
        assigneeActive: assigneeActiveFilter,
        limit: patientPageSize,
        offset: (patientPage - 1) * patientPageSize,
      });
      setAssignments(response.items);
      setAssignmentTotal(response.total);
      setSelectedPatientIds((current) => {
        const visibleIds = new Set(response.items.map((item) => item.patient_id));
        const next = new Set<number>();
        for (const id of current) {
          if (visibleIds.has(id)) {
            next.add(id);
          }
        }
        return next;
      });
      const currentOffset = (patientPage - 1) * patientPageSize;
      if (response.total > 0 && currentOffset >= response.total) {
        setPatientPage(Math.max(1, Math.ceil(response.total / patientPageSize)));
      }
    } catch (requestError) {
      setError(getReadableApiError(requestError));
      setAssignments([]);
      setAssignmentTotal(0);
    } finally {
      setAssignmentsLoading(false);
    }
  }, [assignmentFilter, assigneeActiveFilter, assigneeRoleFilter, isAdmin, keyword, patientPage, patientPageSize]);

  const loadAssignmentsByStaff = useCallback(
    async (staffIds: number[]) => {
      const normalizedStaffIds = Array.from(new Set(staffIds.filter((staffId) => staffId > 0)));
      if (!isAdmin || normalizedStaffIds.length === 0) {
        setAssignedPatientsByStaffId({});
        return;
      }
      try {
        const response = await fetchAdminAssignmentsByStaff({ staffIdentityIds: normalizedStaffIds });
        const next: Record<number, AdminPatientAssignmentByStaffPatientItem[]> = {};
        for (const item of response.items) {
          next[item.staff_identity_id] = item.assigned_patients;
        }
        setAssignedPatientsByStaffId(next);
      } catch (requestError) {
        setError(getReadableApiError(requestError));
      }
    },
    [isAdmin]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordDraft);
      setPatientPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keywordDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssignees();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAssignees]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssignments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAssignments]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssignmentsByStaff(assigneeUsers.map((staff) => staff.id));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [assigneeUsers, loadAssignmentsByStaff]);

  function toggleSelectPatient(patientId: number, checked: boolean) {
    setSelectedPatientIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(patientId);
      } else {
        next.delete(patientId);
      }
      return next;
    });
  }

  const assignSingle = useCallback(async (patientId: number) => {
    if (!selectedStaffId) {
      toast.error("請先選擇要指派的人員。");
      return;
    }
    setWorkingPatientId(patientId);
    setError(null);
    try {
      const result = await upsertAdminAssignment({
        patient_id: patientId,
        staff_identity_id: selectedStaffId,
      });
      await Promise.all([
        loadAssignments(),
        loadAssignmentsByStaff(assigneeUsers.map((staff) => staff.id)),
      ]);
      toast.success(result.status === "unchanged" ? "病患已由此人員主責" : "已更新病患主責人員");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingPatientId(null);
    }
  }, [assigneeUsers, loadAssignments, loadAssignmentsByStaff, selectedStaffId]);

  async function assignBulk() {
    if (!selectedStaffId) {
      toast.error("請先選擇要指派的人員。");
      return;
    }
    if (selectedPatientIds.size === 0) {
      toast.error("請先勾選至少一位病患。");
      return;
    }
    setIsBulkAssigning(true);
    setError(null);
    try {
      const payload = {
        assignments: Array.from(selectedPatientIds).map((patientId) => ({
          patient_id: patientId,
          staff_identity_id: selectedStaffId,
        })),
      };
      const response = await bulkUpsertAdminAssignments(payload);
      const updated = response.results.filter((item) => item.status === "updated").length;
      const unchanged = response.results.filter((item) => item.status === "unchanged").length;
      const invalid = response.results.filter((item) => item.status === "invalid").length;
      await Promise.all([
        loadAssignments(),
        loadAssignmentsByStaff(assigneeUsers.map((staff) => staff.id)),
      ]);
      setSelectedPatientIds(new Set());
      toast.success(`批次完成：更新 ${updated} 筆、未變更 ${unchanged} 筆、失敗 ${invalid} 筆`);
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setIsBulkAssigning(false);
    }
  }

  function openRemoveModal(target: { patientId: number; caseNumber: string; fullName: string | null }) {
    setRemoveTarget(target);
  }

  function closeRemoveModal() {
    if (isUnassigning) {
      return;
    }
    setRemoveTarget(null);
  }

  async function confirmRemoveAssignedPatient() {
    if (!removeTarget) {
      return;
    }
    setIsUnassigning(true);
    setError(null);
    try {
      const response = await unassignAdminAssignment(removeTarget.patientId);
      await Promise.all([
        loadAssignments(),
        loadAssignmentsByStaff(assigneeUsers.map((staff) => staff.id)),
      ]);
      setRemoveTarget(null);
      toast.success(response.status === "updated" ? "已移除病患指派" : "病患目前無指派關係，無需移除");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setIsUnassigning(false);
    }
  }

  function toggleSelectAllForRows(patientIds: number[], checked: boolean) {
    setSelectedPatientIds((current) => {
      const next = new Set(current);
      for (const patientId of patientIds) {
        if (checked) {
          next.add(patientId);
        } else {
          next.delete(patientId);
        }
      }
      return next;
    });
  }

  const assignmentColumns = useMemo<ColumnDef<AdminPatientAssignmentItem>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => {
          const visiblePatientIds = table.getRowModel().rows.map((row) => row.original.patient_id);
          const allVisibleSelected =
            visiblePatientIds.length > 0 && visiblePatientIds.every((patientId) => selectedPatientIds.has(patientId));
          return (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleSelectAllForRows(visiblePatientIds, event.target.checked)}
              aria-label="全選可見病患"
            />
          );
        },
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedPatientIds.has(row.original.patient_id)}
            onChange={(event) => toggleSelectPatient(row.original.patient_id, event.target.checked)}
            aria-label={`勾選病患 ${row.original.case_number}`}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "case_number",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            病歷號
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => <span className="font-mono text-zinc-700">{row.original.case_number}</span>,
      },
      {
        accessorKey: "patient_full_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            病患姓名
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => row.original.patient_full_name ?? "未命名",
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.patient_full_name ?? "";
          const b = rowB.original.patient_full_name ?? "";
          return a.localeCompare(b);
        },
      },
      {
        accessorKey: "staff_display_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            目前主責人員
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => row.original.staff_display_name ?? "未分配",
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.staff_display_name ?? "";
          const b = rowB.original.staff_display_name ?? "";
          return a.localeCompare(b);
        },
      },
      {
        id: "actions",
        header: () => <span className="text-xs font-medium text-zinc-500">操作</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void assignSingle(row.original.patient_id)}
              disabled={workingPatientId === row.original.patient_id || selectedStaffId === null}
            >
              {workingPatientId === row.original.patient_id ? "分配中..." : "指派"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={workingPatientId === row.original.patient_id || !row.original.staff_identity_id}
              onClick={() =>
                openRemoveModal({
                  patientId: row.original.patient_id,
                  caseNumber: row.original.case_number,
                  fullName: row.original.patient_full_name,
                })
              }
            >
              移除
            </Button>
          </div>
        ),
        enableSorting: false,
      },
    ],
    [assignSingle, selectedPatientIds, selectedStaffId, workingPatientId]
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const assignmentTable = useReactTable({
    data: assignments,
    columns: assignmentColumns,
    state: { sorting: assignmentSorting },
    onSortingChange: setAssignmentSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const userTotalPages = Math.max(1, Math.ceil(userTotal / userPageSize));
  const userHasPreviousPage = userPage > 1;
  const userHasNextPage = userPage < userTotalPages;
  const userRangeStart = userTotal === 0 ? 0 : (userPage - 1) * userPageSize + 1;
  const userRangeEnd = userTotal === 0 ? 0 : Math.min(userPage * userPageSize, userTotal);

  const patientTotalPages = Math.max(1, Math.ceil(assignmentTotal / patientPageSize));
  const patientHasPreviousPage = patientPage > 1;
  const patientHasNextPage = patientPage < patientTotalPages;
  const patientRangeStart = assignmentTotal === 0 ? 0 : (patientPage - 1) * patientPageSize + 1;
  const patientRangeEnd = assignmentTotal === 0 ? 0 : Math.min(patientPage * patientPageSize, assignmentTotal);

  if (checkingAccess) {
    return <div className="mx-auto max-w-6xl py-12 text-sm text-zinc-500">載入中...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          不可踰越階級：僅 admin 可使用病患分配。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">病患分配</h1>
          <p className="text-xs text-zinc-500">單筆與批次分配，病患同時僅有一位主責人員。</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void Promise.all([loadAssignees(), loadAssignments()]);
          }}
        >
          重新整理
        </Button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-900">可指派人員</h2>
          <p className="mt-1 text-xs text-zinc-500">先選擇主責人員，再於下方病患列表進行單筆或批次分配。</p>
        </div>
        <Table>
          <TableHeader className="bg-zinc-50">
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>主要負責病患</TableHead>
              <TableHead className="text-right">選擇</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  載入中...
                </TableCell>
              </TableRow>
            ) : assigneeUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  目前沒有可指派人員
                </TableCell>
              </TableRow>
            ) : (
              assigneeUsers.map((staff) => (
                <TableRow key={staff.id}>
                  <TableCell>{staff.display_name ?? "未命名人員"}</TableCell>
                  <TableCell>{staff.role}</TableCell>
                  <TableCell>{staff.is_active ? "active" : "inactive"}</TableCell>
                  <TableCell>
                    {(assignedPatientsByStaffId[staff.id] ?? []).length === 0 ? (
                      <span className="text-xs text-zinc-400">目前無指派病患</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(assignedPatientsByStaffId[staff.id] ?? []).map((patient) => (
                          <span
                            key={patient.patient_id}
                            className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                          >
                            <button
                              type="button"
                              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-800"
                              aria-label={`移除病患 ${patient.case_number} 指派`}
                              onClick={() =>
                                openRemoveModal({
                                  patientId: patient.patient_id,
                                  caseNumber: patient.case_number,
                                  fullName: patient.patient_full_name,
                                })
                              }
                            >
                              <X className="h-3 w-3" />
                            </button>
                            <span>
                              {patient.case_number} {patient.patient_full_name ? `· ${patient.patient_full_name}` : ""}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant={selectedStaffId === staff.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedStaffId(staff.id)}
                    >
                      {selectedStaffId === staff.id ? "已選擇" : "設為主責"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          <span>
            顯示 {userRangeStart}-{userRangeEnd} / {userTotal} 位人員
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!userHasPreviousPage} onClick={() => setUserPage((prev) => Math.max(prev - 1, 1))}>
              上一頁
            </Button>
            <span>
              第 {Math.min(userPage, userTotalPages)} / {userTotalPages} 頁
            </span>
            <Button type="button" variant="outline" size="sm" disabled={!userHasNextPage} onClick={() => setUserPage((prev) => (userHasNextPage ? prev + 1 : prev))}>
              下一頁
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            目前指派人員
            <select
              value={selectedStaffId ?? ""}
              onChange={(event) => setSelectedStaffId(event.target.value ? Number(event.target.value) : null)}
              className="min-w-64 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              {assigneeUsers.length === 0 ? <option value="">目前沒有可指派人員</option> : null}
              {assigneeUsers.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {(staff.display_name ?? "未命名人員") + (staff.is_active ? "" : " (inactive)")}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={() => void assignBulk()} disabled={isBulkAssigning || selectedPatientIds.size === 0}>
            {isBulkAssigning ? "批次分配中..." : `批次分配 (${selectedPatientIds.size})`}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-medium text-zinc-900">病患篩選</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            關鍵字
            <Input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              className="w-72"
              placeholder="搜尋病歷號 / 病患姓名 / 人員"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            分配狀態
            <select
              aria-label="分配狀態"
              value={assignmentFilter}
              onChange={(event) => {
                setAssignmentFilter(event.target.value as "all" | "assigned" | "unassigned");
                setPatientPage(1);
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="all">全部分配狀態</option>
              <option value="assigned">僅已分配</option>
              <option value="unassigned">僅未分配</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            人員角色
            <select
              aria-label="人員角色"
              value={assigneeRoleFilter}
              onChange={(event) => {
                setAssigneeRoleFilter(event.target.value as "all" | "staff" | "admin");
                setPatientPage(1);
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="all">全部角色</option>
              <option value="staff">僅 staff</option>
              <option value="admin">僅 admin</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            人員狀態
            <select
              aria-label="人員狀態"
              value={assigneeActiveFilter}
              onChange={(event) => {
                setAssigneeActiveFilter(event.target.value as "all" | "active" | "inactive");
                setPatientPage(1);
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="all">全部狀態</option>
              <option value="active">僅 active</option>
              <option value="inactive">僅 inactive</option>
            </select>
          </label>
        </div>
      </section>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <Table>
          <TableHeader className="bg-zinc-50">
            {assignmentTable.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={header.id === "actions" ? "text-right" : undefined}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {assignmentsLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  載入中...
                </TableCell>
              </TableRow>
            ) : assignmentTable.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  找不到符合條件的病患
                </TableCell>
              </TableRow>
            ) : (
              assignmentTable.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.id === "actions" ? "text-right" : undefined}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          <span>
            顯示 {patientRangeStart}-{patientRangeEnd} / {assignmentTotal} 位病患
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!patientHasPreviousPage} onClick={() => setPatientPage((prev) => Math.max(prev - 1, 1))}>
              上一頁
            </Button>
            <span>
              第 {Math.min(patientPage, patientTotalPages)} / {patientTotalPages} 頁
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!patientHasNextPage}
              onClick={() => setPatientPage((prev) => (patientHasNextPage ? prev + 1 : prev))}
            >
              下一頁
            </Button>
          </div>
        </div>
      </div>

      {removeTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-900">確認移除病患指派</h2>
            <p className="mt-2 text-sm text-zinc-600">
              確定要移除病患 {removeTarget.caseNumber}
              {removeTarget.fullName ? `（${removeTarget.fullName}）` : ""} 的主責指派嗎？
            </p>
            <p className="mt-1 text-xs text-zinc-500">移除後可再重新指定新的主責人員。</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRemoveModal} disabled={isUnassigning}>
                取消
              </Button>
              <Button type="button" onClick={() => void confirmRemoveAssignedPatient()} disabled={isUnassigning}>
                {isUnassigning ? "移除中..." : "確認移除"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
