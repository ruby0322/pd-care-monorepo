"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getReadableApiError } from "@/lib/api/client";
import {
  AdminAccessRequestItem,
  AdminIdentityItem,
  approveAdminAccessRequest,
  fetchAdminAccessRequests,
  fetchAdminUsers,
  fetchStaffMe,
  rejectAdminAccessRequest,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "@/lib/api/staff";

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminIdentityItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [requests, setRequests] = useState<AdminAccessRequestItem[]>([]);
  const [workingId, setWorkingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const profile = await fetchStaffMe();
      if (profile.role !== "admin") {
        setIsAdmin(false);
        setUsers([]);
        setRequests([]);
        return;
      }
      setIsAdmin(true);
      const [userItems, requestItems] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminAccessRequests({ status: "pending" }),
      ]);
      setUsers(userItems);
      setRequests(requestItems);
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const pendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
  const searchedUsers = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return users;
    }
    return users.filter((user) => {
      return (
        (user.display_name ?? "").toLowerCase().includes(keyword) ||
        user.line_user_id.toLowerCase().includes(keyword) ||
        user.role.toLowerCase().includes(keyword)
      );
    });
  }, [searchKeyword, users]);

  async function handleApprove(requestId: number, role: "staff" | "admin") {
    setWorkingId(requestId);
    setError(null);
    try {
      await approveAdminAccessRequest(requestId, { role });
      await load();
      toast.success(`已核准為 ${role}`);
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleReject(requestId: number) {
    setWorkingId(requestId);
    setError(null);
    try {
      await rejectAdminAccessRequest(requestId, { reason: "不符合開通條件" });
      await load();
      toast.success("已拒絕申請");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleToggleStatus(user: AdminIdentityItem) {
    setWorkingId(user.id);
    setError(null);
    try {
      await updateAdminUserStatus(user.id, { is_active: !user.is_active });
      await load();
      toast.success(user.is_active ? "已停用用戶" : "已啟用用戶");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

  async function handlePromoteToStaff(user: AdminIdentityItem) {
    setWorkingId(user.id);
    setError(null);
    try {
      await updateAdminUserRole(user.id, { role: "staff" });
      await load();
      toast.success("已升級為 staff");
    } catch (requestError) {
      toast.error(getReadableApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

  const userColumns: ColumnDef<AdminIdentityItem>[] = [
      {
        accessorKey: "display_name",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            用戶
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div>
              <p className="text-sm text-zinc-900">{user.display_name ?? user.line_user_id}</p>
              <p className="text-xs text-zinc-500">{user.line_user_id}</p>
            </div>
          );
        },
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.display_name ?? rowA.original.line_user_id;
          const b = rowB.original.display_name ?? rowB.original.line_user_id;
          return a.localeCompare(b);
        },
      },
      {
        accessorKey: "role",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            角色
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">{row.original.role}</span>,
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
            className={`rounded px-2 py-0.5 text-xs ${
              row.original.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {row.original.is_active ? "active" : "inactive"}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            建立時間
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="text-xs text-zinc-500">{new Date(row.original.created_at).toLocaleString("zh-TW", { hour12: false })}</span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="text-xs font-medium text-zinc-500">操作</span>,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              {user.role === "patient" ? (
                <Button size="sm" variant="outline" disabled={workingId === user.id} onClick={() => void handlePromoteToStaff(user)}>
                  升級為 staff
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={workingId === user.id} onClick={() => void handleToggleStatus(user)}>
                {user.is_active ? "停用" : "啟用"}
              </Button>
            </div>
          );
        },
      },
  ];

  // eslint-disable-next-line react-hooks/incompatible-library
  const usersTable = useReactTable({
    data: searchedUsers,
    columns: userColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (loading) {
    return <div className="mx-auto max-w-5xl py-12 text-sm text-zinc-500">載入中...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          不可踰越階級：僅 admin 可使用用戶管理。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold text-zinc-900">用戶管理</h1>
        <p className="text-xs text-zinc-500">admin 專用：角色授權、停用/啟用、醫護權限申請審核</p>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900">待審核醫護權限申請</div>
        <div className="divide-y divide-zinc-100">
          {pendingRequests.length === 0 ? (
            <p className="px-4 py-4 text-sm text-zinc-500">目前沒有待審核申請。</p>
          ) : (
            pendingRequests.map((request) => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-zinc-900">{request.display_name ?? request.line_user_id}</p>
                  <p className="text-xs text-zinc-500">{request.line_user_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={workingId === request.id}
                    onClick={() => void handleApprove(request.id, "staff")}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    核准為 staff
                  </button>
                  <button
                    type="button"
                    disabled={workingId === request.id}
                    onClick={() => void handleApprove(request.id, "admin")}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    核准為 admin
                  </button>
                  <button
                    type="button"
                    disabled={workingId === request.id}
                    onClick={() => void handleReject(request.id)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    拒絕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900">用戶清單</div>
        <div className="border-b border-zinc-100 px-4 py-3">
          <Input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜尋姓名 / LINE ID / 角色"
            className="max-w-xs"
          />
        </div>
        <Table>
          <TableHeader className="bg-zinc-50">
            {usersTable.getHeaderGroups().map((headerGroup) => (
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
            {usersTable.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  沒有符合搜尋條件的用戶
                </TableCell>
              </TableRow>
            ) : (
              usersTable.getRowModel().rows.map((row) => (
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
          顯示 {usersTable.getRowModel().rows.length} / {users.length} 位用戶
        </div>
      </section>
    </div>
  );
}
