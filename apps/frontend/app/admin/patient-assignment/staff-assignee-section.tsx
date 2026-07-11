"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminIdentityItem, AdminPatientAssignmentByStaffPatientItem } from "@/lib/api/staff";

import { StaffAssigneeCard } from "./staff-assignee-card";

type StaffAssigneeSectionProps = {
  staff: AdminIdentityItem[];
  assignedPatientsByStaffId: Record<number, AdminPatientAssignmentByStaffPatientItem[]>;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  initialQuery: string;
  capacity: number;
  rows: number;
  columns: number;
  busy?: boolean;
  onSearch: (query: string) => void;
  onPageChange: (page: number) => void;
  onOpenCard: (staffId: number) => void;
  onOpenAdd: (staffId: number) => void;
  onOpenOverflow: (staffId: number) => void;
};

export function StaffAssigneeSection({
  staff,
  assignedPatientsByStaffId,
  total,
  page,
  pageSize,
  loading,
  initialQuery,
  capacity,
  rows,
  columns,
  busy,
  onSearch,
  onPageChange,
  onOpenCard,
  onOpenAdd,
  onOpenOverflow,
}: StaffAssigneeSectionProps) {
  const [queryDraft, setQueryDraft] = useState(initialQuery);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentOffset = (page - 1) * pageSize;
  const displayFrom = total === 0 ? 0 : currentOffset + 1;
  const displayTo = total === 0 ? 0 : Math.min(currentOffset + staff.length, total);
  const canGoPreviousPage = page > 1;
  const canGoNextPage = page < totalPages;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">可指派人員</h2>
          {loading ? <span className="text-xs text-zinc-500">載入中…</span> : null}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(queryDraft);
          }}
        >
          <Input
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜尋人員…"
            aria-label="搜尋可指派人員"
            className="h-8 w-40 text-sm sm:w-52"
          />
          <button type="submit" className="h-8 rounded-lg bg-zinc-900 px-3 text-xs text-white">
            搜尋
          </button>
        </form>
      </div>

      {staff.length === 0 && !loading ? (
        <p className="text-sm text-zinc-500">目前沒有可指派人員</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {staff.map((member) => (
            <StaffAssigneeCard
              key={member.id}
              staff={member}
              patients={assignedPatientsByStaffId[member.id] ?? []}
              capacity={capacity}
              rows={rows}
              columns={columns}
              busy={busy}
              onOpenCard={() => onOpenCard(member.id)}
              onOpenAdd={() => onOpenAdd(member.id)}
              onOpenOverflow={() => onOpenOverflow(member.id)}
            />
          ))}
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            顯示 {displayFrom}-{displayTo} / {total} 位人員
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !canGoPreviousPage}
              onClick={() => onPageChange(page - 1)}
            >
              上一頁
            </Button>
            <span>
              第 {page} / {totalPages} 頁
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !canGoNextPage}
              onClick={() => onPageChange(page + 1)}
            >
              下一頁
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
