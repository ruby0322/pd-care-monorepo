"use client";

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getReadableApiError } from "@/lib/api/client";
import {
  createStaffPatient,
  fetchAdminAgeHistogram,
  fetchAdminGenderDistribution,
  fetchStaffMe,
  fetchStaffPatients,
  StaffPatientSummary,
  updateStaffPatientStatus,
} from "@/lib/api/staff";

type ActiveFilter = "all" | "active" | "inactive";

const GENDER_LABELS: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "其他",
  unknown: "未填寫",
};

const GENDER_COLORS: Record<string, string> = {
  male: "#2563eb",
  female: "#db2777",
  other: "#7c3aed",
  unknown: "#71717a",
};

export default function AdminPatientsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [genderDistribution, setGenderDistribution] = useState<{ gender: string; count: number }[]>([]);
  const [ageHistogram, setAgeHistogram] = useState<{ label: string; count: number }[]>([]);
  const [patients, setPatients] = useState<StaffPatientSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [workingPatientId, setWorkingPatientId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCaseNumber, setNewCaseNumber] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [newFullName, setNewFullName] = useState("");

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchStaffPatients({
        months: 12,
        infectionStatus: "all",
        isActiveFilter: activeFilter,
        sortKey: "latest_upload",
        sortDir: "desc",
      });
      setPatients(response.items);
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPatients();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPatients]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsError(null);
    try {
      const me = await fetchStaffMe();
      if (me.role !== "admin") {
        setIsAdmin(false);
        setGenderDistribution([]);
        setAgeHistogram([]);
        return;
      }
      setIsAdmin(true);
      const [genderData, ageData] = await Promise.all([
        fetchAdminGenderDistribution(),
        fetchAdminAgeHistogram({ bucketSize: 10 }),
      ]);
      setGenderDistribution(genderData.items);
      setAgeHistogram(ageData.items.map((item) => ({ label: item.label, count: item.count })));
    } catch (requestError) {
      setIsAdmin(false);
      setAnalyticsError(getReadableApiError(requestError));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnalytics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAnalytics]);

  async function togglePatientStatus(patient: StaffPatientSummary) {
    setWorkingPatientId(patient.patient_id);
    try {
      await updateStaffPatientStatus(patient.patient_id, { is_active: !patient.is_active });
      await loadPatients();
      toast.success(patient.is_active ? "已停權病患" : "已恢復病患");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingPatientId(null);
    }
  }

  async function handleCreatePatient() {
    const caseNumber = newCaseNumber.trim();
    const birthDate = newBirthDate.trim();
    const fullName = newFullName.trim();
    if (!caseNumber || !birthDate || !fullName) {
      toast.error("請完整填寫病例號、生日與姓名。");
      return;
    }
    setCreating(true);
    try {
      await createStaffPatient({
        case_number: caseNumber,
        birth_date: birthDate,
        full_name: fullName,
      });
      setNewCaseNumber("");
      setNewBirthDate("");
      setNewFullName("");
      setIsCreateOpen(false);
      await loadPatients();
      toast.success("已建立病患資料");
    } catch (requestError) {
      const message = getReadableApiError(requestError);
      if (message.includes("same case number and birth date already exists")) {
        toast.error("病例號與生日已存在，請改用現有病患資料。");
      } else {
        toast.error(message);
      }
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    if (!keyword.trim()) {
      return patients;
    }
    const key = keyword.trim().toLowerCase();
    return patients.filter((item) => {
      return (
        (item.full_name ?? "").toLowerCase().includes(key) ||
        (item.line_display_name ?? "").toLowerCase().includes(key) ||
        item.case_number.toLowerCase().includes(key)
      );
    });
  }, [keyword, patients]);

  const genderChartData = useMemo(
    () =>
      genderDistribution.map((item) => ({
        gender: item.gender,
        label: GENDER_LABELS[item.gender] ?? item.gender,
        count: item.count,
        fill: GENDER_COLORS[item.gender] ?? "#52525b",
      })),
    [genderDistribution]
  );

  const genderChartConfig: ChartConfig = {
    male: { label: "男性", color: GENDER_COLORS.male },
    female: { label: "女性", color: GENDER_COLORS.female },
    other: { label: "其他", color: GENDER_COLORS.other },
    unknown: { label: "未填寫", color: GENDER_COLORS.unknown },
    count: { label: "人數" },
  };

  const columns: ColumnDef<StaffPatientSummary>[] = [
      {
        accessorKey: "case_number",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            病例號
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => <span className="font-mono text-zinc-700">{row.original.case_number}</span>,
      },
      {
        accessorKey: "full_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            姓名
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => <span className="text-zinc-900">{row.original.full_name ?? "未命名"}</span>,
      },
      {
        accessorKey: "line_display_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            LINE 名稱
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => row.original.line_display_name ?? "-",
      },
      {
        accessorKey: "age",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            年齡
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => row.original.age ?? "-",
      },
      {
        accessorKey: "upload_count",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            上傳次數
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
      },
      {
        accessorKey: "is_active",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            狀態
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              row.original.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {row.original.is_active ? "啟用中" : "停權"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="text-xs font-medium text-zinc-500">操作</span>,
        cell: ({ row }) => {
          const patient = row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void togglePatientStatus(patient)}
                disabled={workingPatientId === patient.patient_id}
              >
                {patient.is_active ? "停權" : "恢復"}
              </Button>
              <Link
                href={`/admin/patients/${patient.patient_id}`}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                詳情
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          );
        },
      },
  ];

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">病患管理</h1>
          <p className="text-xs text-zinc-500">列表、搜尋、預建檔、停權/恢復與病患詳情</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => setIsCreateOpen((current) => !current)} variant="outline">
            {isCreateOpen ? "取消新增" : "新增病患"}
          </Button>
          <Button type="button" onClick={() => void loadPatients()} variant="outline">
            <RefreshCw className="h-4 w-4" />
            重新整理
          </Button>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {analyticsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{analyticsError}</div>
      ) : null}

      {isAdmin ? (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-900">性別長條圖</h3>
              <ChartContainer className="h-64 w-full" config={genderChartConfig}>
                <BarChart data={genderChartData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={6}>
                    {genderChartData.map((item) => (
                      <Cell key={item.gender} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-zinc-900">年齡直方圖</h3>
              <ChartContainer className="h-64 w-full" config={{ count: { label: "人數", color: "#2563eb" } }}>
                <BarChart data={ageHistogram}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#2563eb" radius={4} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </section>
      ) : null}

      {isCreateOpen ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-medium text-zinc-900">預先建立病患資料</h2>
          <p className="mt-1 text-xs text-zinc-500">建立後，尚未綁定的用戶輸入相同病例號與生日即可直接使用。</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <Input value={newCaseNumber} onChange={(event) => setNewCaseNumber(event.target.value)} placeholder="病例號" />
            <Input type="date" value={newBirthDate} onChange={(event) => setNewBirthDate(event.target.value)} />
            <Input value={newFullName} onChange={(event) => setNewFullName(event.target.value)} placeholder="姓名" />
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => void handleCreatePatient()} disabled={creating}>
              {creating ? "建立中..." : "建立病患"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="w-56"
          placeholder="搜尋姓名 / LINE 名稱 / 病例號"
        />
        <select
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="all">全部狀態</option>
          <option value="active">僅啟用</option>
          <option value="inactive">僅停權</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                  載入中...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                  找不到符合條件的病患
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
        <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
          顯示 {table.getRowModel().rows.length} / {patients.length} 位病患
        </div>
      </div>
    </div>
  );
}
