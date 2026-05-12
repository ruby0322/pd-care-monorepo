"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  upsertAdminAssignment,
} from "@/lib/api/staff";

export default function AdminPatientAssignmentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assignments, setAssignments] = useState<AdminPatientAssignmentItem[]>([]);
  const [staffUsers, setStaffUsers] = useState<AdminIdentityItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<number>>(new Set());
  const [workingPatientId, setWorkingPatientId] = useState<number | null>(null);
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await fetchStaffMe();
      if (me.role !== "admin") {
        setIsAdmin(false);
        setAssignments([]);
        setStaffUsers([]);
        return;
      }
      setIsAdmin(true);
      const [assignmentItems, staffItems] = await Promise.all([
        fetchAdminAssignments(),
        fetchAdminUsers({ role: "staff" }),
      ]);
      setAssignments(assignmentItems);
      setStaffUsers(staffItems);
      if (staffItems.length > 0 && selectedStaffId === null) {
        setSelectedStaffId(staffItems[0].id);
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
        (item.staff_display_name ?? "").toLowerCase().includes(normalized) ||
        (item.staff_line_user_id ?? "").toLowerCase().includes(normalized)
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

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedPatientIds(new Set());
      return;
    }
    setSelectedPatientIds(new Set(filteredAssignments.map((item) => item.patient_id)));
  }

  async function assignSingle(patientId: number) {
    if (!selectedStaffId) {
      toast.error("請先選擇要指派的 staff。");
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
      toast.success(result.status === "unchanged" ? "病患已由此 staff 主責" : "已更新病患主責 staff");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingPatientId(null);
    }
  }

  async function assignBulk() {
    if (!selectedStaffId) {
      toast.error("請先選擇要指派的 staff。");
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

  const allVisibleSelected =
    filteredAssignments.length > 0 && filteredAssignments.every((item) => selectedPatientIds.has(item.patient_id));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">病患分配</h1>
          <p className="text-xs text-zinc-500">單筆與批次分配，病患同時僅有一位主責 staff。</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          重新整理
        </Button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            指派 staff
            <select
              value={selectedStaffId ?? ""}
              onChange={(event) => setSelectedStaffId(event.target.value ? Number(event.target.value) : null)}
              className="min-w-64 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              {staffUsers.length === 0 ? <option value="">目前沒有 staff</option> : null}
              {staffUsers.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {(staff.display_name ?? staff.line_user_id) + (staff.is_active ? "" : " (inactive)")}
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
          placeholder="搜尋病歷號 / 病患姓名 / staff"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <Table>
          <TableHeader className="bg-zinc-50">
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleSelectAll(event.target.checked)}
                  aria-label="全選可見病患"
                />
              </TableHead>
              <TableHead>病歷號</TableHead>
              <TableHead>病患姓名</TableHead>
              <TableHead>目前主責 staff</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAssignments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  找不到符合條件的病患
                </TableCell>
              </TableRow>
            ) : (
              filteredAssignments.map((item) => (
                <TableRow key={item.patient_id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedPatientIds.has(item.patient_id)}
                      onChange={(event) => toggleSelectPatient(item.patient_id, event.target.checked)}
                      aria-label={`勾選病患 ${item.case_number}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-zinc-700">{item.case_number}</TableCell>
                  <TableCell>{item.patient_full_name ?? "未命名"}</TableCell>
                  <TableCell>
                    {item.staff_identity_id
                      ? `${item.staff_display_name ?? item.staff_line_user_id ?? "未知 staff"} (${item.staff_line_user_id ?? "-"})`
                      : "未分配"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void assignSingle(item.patient_id)}
                      disabled={workingPatientId === item.patient_id}
                    >
                      {workingPatientId === item.patient_id ? "分配中..." : "指派"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
