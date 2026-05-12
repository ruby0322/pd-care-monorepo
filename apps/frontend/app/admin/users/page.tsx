"use client";

import { useEffect, useMemo, useState } from "react";

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
    void load();
  }, []);

  const pendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);

  async function handleApprove(requestId: number, role: "staff" | "admin") {
    setWorkingId(requestId);
    setError(null);
    try {
      await approveAdminAccessRequest(requestId, { role });
      await load();
    } catch (requestError) {
      setError(getReadableApiError(requestError));
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
    } catch (requestError) {
      setError(getReadableApiError(requestError));
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
    } catch (requestError) {
      setError(getReadableApiError(requestError));
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
    } catch (requestError) {
      setError(getReadableApiError(requestError));
    } finally {
      setWorkingId(null);
    }
  }

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
        <div className="divide-y divide-zinc-100">
          {users.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm text-zinc-900">
                  {user.display_name ?? user.line_user_id}
                  <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{user.role}</span>
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-xs ${
                      user.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {user.is_active ? "active" : "inactive"}
                  </span>
                </p>
                <p className="text-xs text-zinc-500">{user.line_user_id}</p>
              </div>
              <div className="flex items-center gap-2">
                {user.role === "patient" ? (
                  <button
                    type="button"
                    disabled={workingId === user.id}
                    onClick={() => void handlePromoteToStaff(user)}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    升級為 staff
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={workingId === user.id}
                  onClick={() => void handleToggleStatus(user)}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {user.is_active ? "停用" : "啟用"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
