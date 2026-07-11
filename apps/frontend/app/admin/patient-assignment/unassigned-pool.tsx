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
  loadingMore?: boolean;
  initialKeyword: string;
  bindingFilter: AdminBindingFilter;
  busy?: boolean;
  onKeywordSubmit: (keyword: string) => void;
  onBindingFilterChange: (value: AdminBindingFilter) => void;
  onLoadMore: () => void;
};

export function UnassignedPool({
  patients,
  total,
  loading,
  loadingMore,
  initialKeyword,
  bindingFilter,
  busy,
  onKeywordSubmit,
  onBindingFilterChange,
  onLoadMore,
}: UnassignedPoolProps) {
  const [keywordDraft, setKeywordDraft] = useState(initialKeyword);
  const { setNodeRef, isOver } = useDroppable({
    id: "unassigned-pool",
    data: { type: "pool" },
  });

  const hasMore = patients.length < total;

  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-3">
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
            <button type="submit" className="h-8 rounded-lg bg-zinc-900 px-3 text-xs text-white">
              搜尋
            </button>
          </form>
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            註冊狀態
            <select
              aria-label="註冊狀態"
              className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
              value={bindingFilter}
              onChange={(event) => onBindingFilterChange(event.target.value as AdminBindingFilter)}
            >
              <option value="bound">已綁定</option>
              <option value="all">全部</option>
              <option value="unbound_only">未綁定</option>
            </select>
          </label>
        </div>
      </div>

      {total > patients.length && patients.length > 0 ? (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          顯示 {patients.length} / {total} 位未分配病患
        </p>
      ) : null}

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[64px] gap-2 overflow-x-auto pb-1",
          isOver && "rounded-lg ring-2 ring-zinc-400 ring-offset-2"
        )}
      >
        {loading ? (
          <p className="px-1 text-xs text-zinc-500">載入中…</p>
        ) : patients.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400">目前沒有未分配病患</p>
        ) : (
          patients.map((patient) => (
            <PatientTile
              key={patient.patient_id}
              patient={patient}
              mode="chip"
              dragId={`pool-${patient.patient_id}`}
              fromStaffId={null}
              disabled={busy}
              className="h-12 w-[148px] shrink-0"
            />
          ))
        )}
      </div>

      {hasMore ? (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || loadingMore || busy}
            onClick={onLoadMore}
          >
            {loadingMore ? "載入中…" : "載入更多"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
