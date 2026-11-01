"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PersonAvatar } from "@/app/admin/patient-assignment/person-avatar";
import { formatLastReviewAt, isDormantStaff, staffOverviewKpis, staffRosterDisplayName } from "@/lib/admin/staff-overview";
import type { AdminStaffOverviewItem, AdminStaffOverviewSummary } from "@/lib/api/staff";

type StaffOverviewSectionProps = {
  items: AdminStaffOverviewItem[];
  summary: AdminStaffOverviewSummary | null;
  workingId: number | null;
  currentLineUserId: string | null;
  onEditRealName: (item: AdminStaffOverviewItem) => void;
  onToggleRole: (item: AdminStaffOverviewItem) => void;
  onToggleStatus: (item: AdminStaffOverviewItem) => void;
};

function SortableHeader({ label, hint, onToggle }: { label: string; hint?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={hint}
      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
      onClick={onToggle}
    >
      {label}
      {hint ? <span className="text-zinc-400">ⓘ</span> : null}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </button>
  );
}

function LabelProgressCell({ item }: { item: AdminStaffOverviewItem }) {
  const labeled = item.labeled_assigned_upload_count;
  const total = item.assigned_upload_count;
  const percent = Math.round(item.labeled_assigned_ratio * 100);
  return (
    <div className="min-w-[112px]">
      <p className="text-sm tabular-nums text-zinc-900">
        {labeled} / {total}
        <span className="ml-1 text-xs text-zinc-500">（{percent}%）</span>
      </p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={cn("h-full rounded-full", total > 0 && labeled >= total ? "bg-emerald-500" : "bg-cyan-500")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function StaffOverviewSection({
  items,
  summary,
  workingId,
  currentLineUserId,
  onEditRealName,
  onToggleRole,
  onToggleStatus,
}: StaffOverviewSectionProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "assigned_patient_count", desc: true }]);
  const [queryDraft, setQueryDraft] = useState("");
  const kpis = staffOverviewKpis(summary);

  const filteredItems = useMemo(() => {
    const needle = queryDraft.trim().toLowerCase();
    if (!needle) {
      return items;
    }
    return items.filter((item) =>
      [item.real_name, item.display_name, item.line_user_id]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [items, queryDraft]);

  const columns: ColumnDef<AdminStaffOverviewItem>[] = [
    {
      id: "name",
      accessorFn: (item) => staffRosterDisplayName(item),
      header: ({ column }) => (
        <SortableHeader label="醫護" onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")} />
      ),
      cell: ({ row }) => {
        const item = row.original;
        const name = staffRosterDisplayName(item);
        return (
          <div className="flex items-center gap-2">
            <PersonAvatar name={name} pictureUrl={item.picture_url} />
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-900">
                {name}
                {item.is_active ? null : (
                  <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-700">inactive</span>
                )}
              </p>
              <p className="truncate text-xs text-zinc-500">{item.line_user_id}</p>
            </div>
          </div>
        );
      },
      sortingFn: (rowA, rowB) => staffRosterDisplayName(rowA.original).localeCompare(staffRosterDisplayName(rowB.original)),
    },
    {
      accessorKey: "role",
      header: ({ column }) => (
        <SortableHeader label="角色" onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")} />
      ),
      cell: ({ row }) => <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">{row.original.role}</span>,
    },
    {
      accessorKey: "assigned_patient_count",
      header: ({ column }) => (
        <SortableHeader
          label="指派病患"
          hint="指派給此人且仍在追蹤中的病患數（停用病患不計）"
          onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")}
        />
      ),
      cell: ({ row }) => {
        const count = row.original.assigned_patient_count;
        return (
          <span className={count === 0 && row.original.is_active ? "text-sm font-medium text-amber-700" : "text-sm text-zinc-900"}>
            {count}
          </span>
        );
      },
    },
    {
      id: "label_progress",
      accessorFn: (item) => item.labeled_assigned_ratio,
      header: ({ column }) => (
        <SortableHeader
          label="已標註 / 指派上傳"
          hint="此人負責佇列的完成度：由任何人標註皆計入"
          onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")}
        />
      ),
      cell: ({ row }) => <LabelProgressCell item={row.original} />,
      sortingFn: (rowA, rowB) => {
        const ratioDiff = rowA.original.labeled_assigned_ratio - rowB.original.labeled_assigned_ratio;
        return ratioDiff !== 0 ? ratioDiff : rowA.original.assigned_upload_count - rowB.original.assigned_upload_count;
      },
    },
    {
      accessorKey: "reviewed_upload_count",
      header: ({ column }) => (
        <SortableHeader
          label="本人標註數"
          hint="此人親自標註過的上傳數：含不在其負責佇列的上傳"
          onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")}
        />
      ),
      cell: ({ row }) => <span className="text-sm tabular-nums text-zinc-900">{row.original.reviewed_upload_count}</span>,
    },
    {
      accessorKey: "review_count_7d",
      header: ({ column }) => (
        <SortableHeader label="近 7 日審核" onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")} />
      ),
      cell: ({ row }) => <span className="text-sm text-zinc-900">{row.original.review_count_7d}</span>,
    },
    {
      accessorKey: "review_count_30d",
      header: ({ column }) => (
        <SortableHeader label="近 30 日審核" onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")} />
      ),
      cell: ({ row }) => <span className="text-sm text-zinc-900">{row.original.review_count_30d}</span>,
    },
    {
      id: "last_review_at",
      accessorFn: (item) => (item.last_review_at ? new Date(item.last_review_at).getTime() : 0),
      header: ({ column }) => (
        <SortableHeader label="最近審核" onToggle={() => column.toggleSorting(column.getIsSorted() !== "desc")} />
      ),
      cell: ({ row }) => (
        <span className={isDormantStaff(row.original) ? "text-xs text-amber-700" : "text-xs text-zinc-500"}>
          {formatLastReviewAt(row.original.last_review_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="text-xs font-medium text-zinc-500">操作</span>,
      cell: ({ row }) => {
        const item = row.original;
        const busy = workingId === item.identity_id;
        // Demoting or deactivating your own account would lock you out of this page.
        const isSelf = currentLineUserId !== null && item.line_user_id === currentLineUserId;
        return (
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/admin/patient-assignment?staffQ=${encodeURIComponent(item.line_user_id)}`}
              className="inline-flex h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              查看分配
            </Link>
            <Button
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              disabled={busy}
              onClick={() => onEditRealName(item)}
            >
              更新姓名
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              disabled={busy || isSelf}
              title={isSelf ? "無法調整自己的角色" : undefined}
              onClick={() => onToggleRole(item)}
            >
              {item.role === "admin" ? "降為 staff" : "升為 admin"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              disabled={busy || isSelf}
              title={isSelf ? "無法停用自己的帳號" : undefined}
              onClick={() => onToggleStatus(item)}
            >
              {item.is_active ? "停用" : "啟用"}
            </Button>
          </div>
        );
      },
    },
  ];

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <>
      <section aria-label="醫護團隊概況" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs text-zinc-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${kpi.tone === "warning" ? "text-amber-700" : "text-zinc-900"}`}>
              {kpi.value}
            </p>
            <p className="mt-1 text-xs text-zinc-400">{kpi.hint}</p>
          </div>
        ))}
      </section>

      {summary?.truncated ? (
        <p className="text-xs text-amber-700">
          名單僅顯示前 {summary.staff_count} 位（共 {summary.staff_total} 位），上方統計以顯示範圍計算。
        </p>
      ) : null}

      <section aria-label="醫護團隊" className="rounded-2xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div className="text-sm font-medium text-zinc-900">醫護團隊</div>
          <Input
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜尋醫護姓名 / LINE ID"
            className="max-w-xs"
            aria-label="搜尋醫護"
          />
        </div>
        <Table>
          <TableHeader className="bg-zinc-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-zinc-50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={header.id === "actions" ? "text-right" : undefined}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-zinc-500">
                  沒有符合條件的醫護
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
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
      </section>
    </>
  );
}
