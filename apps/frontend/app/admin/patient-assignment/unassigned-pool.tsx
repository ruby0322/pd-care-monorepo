"use client";

import { useState } from "react";

import { useDroppable } from "@dnd-kit/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminBindingFilter } from "@/lib/admin/filters";
import { cn } from "@/lib/utils";

import type { PatientTilePatient } from "./patient-tile";
import { PatientTile } from "./patient-tile";

type UnassignedPoolProps = {
  patients: PatientTilePatient[];
  total: number;
  loading: boolean;
  initialKeyword: string;
  bindingFilter: AdminBindingFilter;
  excludeStaffAdminPatients: boolean;
  page: number;
  pageSize: number;
  busy?: boolean;
  elevateForDrop?: boolean;
  onKeywordSubmit: (keyword: string) => void;
  onBindingFilterChange: (value: AdminBindingFilter) => void;
  onExcludeStaffAdminPatientsChange: (value: boolean) => void;
  onPageChange: (page: number) => void;
};

export function UnassignedPool({
  patients,
  total,
  loading,
  initialKeyword,
  bindingFilter,
  excludeStaffAdminPatients,
  page,
  pageSize,
  busy,
  elevateForDrop,
  onKeywordSubmit,
  onBindingFilterChange,
  onExcludeStaffAdminPatientsChange,
  onPageChange,
}: UnassignedPoolProps) {
  const [keywordDraft, setKeywordDraft] = useState(initialKeyword);
  const { setNodeRef, isOver } = useDroppable({
    id: "unassigned-pool",
    data: { type: "pool" },
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const displayTo = Math.min(page * pageSize, total);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-3",
        elevateForDrop && "relative z-40 bg-zinc-50 shadow-lg ring-1 ring-zinc-200",
        isOver && "ring-2 ring-zinc-400 ring-offset-2"
      )}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">未分配病患</h2>
          <p className="text-xs text-zinc-500">拖曳到人員卡片以指派；也可從人員卡片拖回此處取消指派</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onKeywordSubmit(keywordDraft);
            }}
          >
            <Input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜尋病患…"
              aria-label="搜尋未分配病患"
              className="h-8 w-40 text-sm sm:w-52"
            />
            <button type="submit" className="h-8 cursor-pointer rounded-lg bg-zinc-900 px-3 text-xs text-white">
              搜尋
            </button>
          </form>
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            註冊狀態
            <select
              aria-label="註冊狀態"
              className="h-8 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 text-xs"
              value={bindingFilter}
              onChange={(event) => onBindingFilterChange(event.target.value as AdminBindingFilter)}
            >
              <option value="bound">已綁定</option>
              <option value="all">全部</option>
              <option value="unbound_only">未綁定</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            身分
            <select
              aria-label="人員身分病患"
              className="h-8 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 text-xs"
              value={excludeStaffAdminPatients ? "exclude" : "include"}
              onChange={(event) => onExcludeStaffAdminPatientsChange(event.target.value === "exclude")}
            >
              <option value="include">包含工作人員／管理員</option>
              <option value="exclude">隱藏工作人員／管理員</option>
            </select>
          </label>
        </div>
      </div>

      <div className="grid min-h-[64px] grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading ? (
          <p className="px-1 text-xs text-zinc-500">載入中…</p>
        ) : patients.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400">目前沒有未分配病患</p>
        ) : (
          patients.map((patient) => (
            <PatientTile
              key={patient.patient_id}
              patient={patient}
              dragId={`pool-${patient.patient_id}`}
              fromStaffId={null}
              disabled={busy}
              expandOnHoverDesktop
              className="h-12 w-full"
            />
          ))
        )}
      </div>

      {total > 0 ? (
        <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            顯示 {displayFrom}-{displayTo} / {total} 位未分配病患
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || busy || page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="未分配病患上一頁"
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
            disabled={loading || busy || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="未分配病患下一頁"
          >
            下一頁
          </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
