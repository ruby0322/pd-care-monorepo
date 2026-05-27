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
  bulkUpsertAdminAssignments,
  fetchAdminAssignments,
  fetchAdminUsers,
  fetchStaffMe,
  unassignAdminAssignment,
  upsertAdminAssignment,
} from "@/lib/api/staff";

export default function AdminPatientAssignmentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assignments, setAssignments] = useState<AdminPatientAssignmentItem[]>([]);
  const [assigneeUsers, setAssigneeUsers] = useState<AdminIdentityItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<number>>(new Set());
  const [workingPatientId, setWorkingPatientId] = useState<number | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ patientId: number; caseNumber: string; fullName: string | null } | null>(
    null
  );
  const [assignmentSorting, setAssignmentSorting] = useState<SortingState>([]);
  const [previewSorting, setPreviewSorting] = useState<SortingState>([{ id: "assigned_count", desc: true }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await fetchStaffMe();
      if (me.role !== "admin") {
        setIsAdmin(false);
        setAssignments([]);
        setAssigneeUsers([]);
        return;
      }
      setIsAdmin(true);
      const [assignmentItems, assigneeItems] = await Promise.all([
        fetchAdminAssignments(),
        fetchAdminUsers(),
      ]);
      setAssignments(assignmentItems);
      setAssigneeUsers(assigneeItems);
      if (assigneeItems.length > 0 && selectedStaffId === null) {
        setSelectedStaffId(assigneeItems[0].id);
      }
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [selectedStaffId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredAssignments = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return assignments;
    }
    return assignments.filter((item) => {
      return (
        item.case_number.toLowerCase().includes(normalized) ||
        (item.patient_full_name ?? "").toLowerCase().includes(normalized) ||
        (item.staff_display_name ?? "").toLowerCase().includes(normalized)
      );
    });
  }, [assignments, keyword]);

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
      await load();
      toast.success(result.status === "unchanged" ? "病患已由此人員主責" : "已更新病患主責人員");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingPatientId(null);
    }
  }, [load, selectedStaffId]);

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
      await load();
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
      await load();
      setRemoveTarget(null);
      toast.success(
        response.status === "updated"
          ? "已移除病患指派"
          : "病患目前無指派關係，無需移除"
      );
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setIsUnassigning(false);
    }
  }

  type StaffPreviewRow = {
    staff_id: number;
    staff_name: string;
    is_active: boolean;
    assigned_count: number;
    assigned_patients: Array<{ patient_id: number; case_number: string; patient_full_name: string | null }>;
  };

  const staffPreviewRows = useMemo<StaffPreviewRow[]>(() => {
    return assigneeUsers.map((staff) => {
      const assignedPatients = assignments
        .filter((item) => item.staff_identity_id === staff.id)
        .map((item) => ({
          patient_id: item.patient_id,
          case_number: item.case_number,
          patient_full_name: item.patient_full_name,
        }))
        .sort((a, b) => a.case_number.localeCompare(b.case_number));
      return {
        staff_id: staff.id,
        staff_name: staff.display_name ?? "未命名人員",
        is_active: staff.is_active,
        assigned_count: assignedPatients.length,
        assigned_patients: assignedPatients,
      };
    });
  }, [assignments, assigneeUsers]);

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
          <div className="text-right">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void assignSingle(row.original.patient_id)}
              disabled={workingPatientId === row.original.patient_id || selectedStaffId === null}
            >
              {workingPatientId === row.original.patient_id ? "分配中..." : "指派"}
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
    data: filteredAssignments,
    columns: assignmentColumns,
    state: { sorting: assignmentSorting },
    onSortingChange: setAssignmentSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const previewColumns = useMemo<ColumnDef<StaffPreviewRow>[]>(
    () => [
      {
        accessorKey: "staff_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            醫護人員
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.staff_name}</span>
            {!row.original.is_active ? (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">inactive</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "assigned_count",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            負責病患數
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
      },
      {
        id: "assigned_patients",
        header: () => <span className="text-xs font-medium text-zinc-500">病患清單</span>,
        cell: ({ row }) => {
          if (row.original.assigned_patients.length === 0) {
            return <span className="text-zinc-400">目前無指派病患</span>;
          }
          return (
            <div className="flex flex-wrap gap-1.5">
              {row.original.assigned_patients.map((patient) => (
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
          );
        },
        enableSorting: false,
      },
    ],
    []
  );

  const previewTable = useReactTable({
    data: staffPreviewRows,
    columns: previewColumns,
    state: { sorting: previewSorting },
    onSortingChange: setPreviewSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (loading) {
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
        <Button type="button" variant="outline" onClick={() => void load()}>
          重新整理
        </Button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            指派人員
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

      <div className="flex items-center gap-2">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="w-72"
          placeholder="搜尋病歷號 / 病患姓名 / 人員"
        />
      </div>

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
            {assignmentTable.getRowModel().rows.length === 0 ? (
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
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-900">醫護人員預覽</h2>
          <p className="mt-1 text-xs text-zinc-500">直接查看每位醫護人員目前負責的病人，不需要逐筆對照。</p>
        </div>
        <Table>
          <TableHeader className="bg-zinc-50">
            {previewTable.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {previewTable.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-zinc-500">
                  目前沒有可預覽的醫護人員
                </TableCell>
              </TableRow>
            ) : (
              previewTable.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

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
