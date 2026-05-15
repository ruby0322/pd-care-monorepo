"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { getReadableApiError } from "@/lib/api/client";
import {
  createStaffPatient,
  fetchPendingBindings,
  linkPendingBinding,
  rejectAllPendingBindings,
  rejectPendingBinding,
  StaffPendingBindingItem,
} from "@/lib/api/staff";

const PAGE_SIZE = 10;

export default function AdminRegistrationReviewPage() {
  const [pending, setPending] = useState<StaffPendingBindingItem[]>([]);
  const [workingPendingId, setWorkingPendingId] = useState<number | null>(null);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [createTarget, setCreateTarget] = useState<StaffPendingBindingItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCaseNumber, setNewCaseNumber] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newGender, setNewGender] = useState<"male" | "female" | "other" | "unknown">("unknown");

  const pendingItems = useMemo(() => pending.filter((item) => item.status === "pending"), [pending]);
  const totalPages = Math.max(1, Math.ceil(pendingItems.length / PAGE_SIZE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return pendingItems.slice(start, start + PAGE_SIZE);
  }, [currentPage, pendingItems]);

  async function loadPending() {
    setErrorMessage(null);
    try {
      const items = await fetchPendingBindings();
      setPending(items);
    } catch (error) {
      setErrorMessage(getReadableApiError(error));
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal(item: StaffPendingBindingItem) {
    setCreateTarget(item);
    setNewCaseNumber(item.case_number);
    setNewBirthDate(item.birth_date);
    setNewFullName("");
    setNewGender("unknown");
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (creating) {
      return;
    }
    setIsCreateModalOpen(false);
    setCreateTarget(null);
  }

  useEffect(() => {
    void loadPending();
  }, []);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  async function handleReject(item: StaffPendingBindingItem) {
    setWorkingPendingId(item.id);
    try {
      await rejectPendingBinding(item.id);
      await loadPending();
      toast.success("已駁回綁定申請");
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setWorkingPendingId(null);
    }
  }

  async function handleCreateAndLink() {
    if (!createTarget) {
      return;
    }
    const caseNumber = newCaseNumber.trim();
    const birthDate = newBirthDate.trim();
    const fullName = newFullName.trim();
    if (!caseNumber || !birthDate || !fullName) {
      toast.error("請完整填寫病例號、生日與姓名。");
      return;
    }
    setCreating(true);
    setWorkingPendingId(createTarget.id);
    try {
      const created = await createStaffPatient({
        case_number: caseNumber,
        birth_date: birthDate,
        full_name: fullName,
        gender: newGender,
      });
      await linkPendingBinding(createTarget.id, created.patient_id);
      await loadPending();
      closeCreateModal();
      toast.success("建檔並綁定完成");
    } catch (error) {
      const message = getReadableApiError(error);
      if (message.includes("same case number and birth date already exists")) {
        toast.error("病例號與生日已存在，請確認資料後再試。");
      } else {
        toast.error(message);
      }
    } finally {
      setCreating(false);
      setWorkingPendingId(null);
    }
  }

  async function handleRejectAll() {
    if (pendingItems.length === 0 || bulkRejecting) {
      return;
    }
    const confirmed = window.confirm(`確定要駁回全部 ${pendingItems.length} 筆待審核綁定嗎？`);
    if (!confirmed) {
      return;
    }
    setBulkRejecting(true);
    try {
      const result = await rejectAllPendingBindings();
      await loadPending();
      toast.success(`已駁回 ${result.rejected_count} 筆綁定申請`);
    } catch (error) {
      toast.error(getReadableApiError(error));
    } finally {
      setBulkRejecting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">註冊審核</h1>
          <p className="text-xs text-zinc-500">管理 LINE 註冊綁定請求，支援指定綁定、建檔與駁回。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRejectAll()}
            disabled={pendingItems.length === 0 || bulkRejecting}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:text-red-300"
          >
            {bulkRejecting ? "駁回中..." : "駁回全部"}
          </button>
          <button
            type="button"
            onClick={() => void loadPending()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-zinc-100 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-900">待審核綁定</h2>
          </div>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">待處理 {pendingItems.length}</span>
        </div>
        <div className="divide-y divide-zinc-50">
          {!loading && pendingItems.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-400">目前沒有待審核綁定。</p>
          ) : (
            paginatedItems.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-900">
                    {item.case_number} / {item.birth_date}
                  </p>
                  <p className="text-xs text-zinc-500 font-mono">{item.line_user_id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openCreateModal(item)}
                    disabled={workingPendingId === item.id || bulkRejecting}
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                  >
                    建檔並綁定
                  </button>
                  <button
                    onClick={() => void handleReject(item)}
                    disabled={workingPendingId === item.id || bulkRejecting}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:text-red-300"
                  >
                    駁回
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        {!loading && pendingItems.length > 0 ? (
          <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
            <span>
              第 {currentPage} / {totalPages} 頁，共 {pendingItems.length} 筆
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="rounded-md border border-zinc-200 px-2 py-1 hover:bg-zinc-50 disabled:text-zinc-300"
              >
                上一頁
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="rounded-md border border-zinc-200 px-2 py-1 hover:bg-zinc-50 disabled:text-zinc-300"
              >
                下一頁
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {isCreateModalOpen && createTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5">
            <h2 className="text-sm font-medium text-zinc-900">新增病患並綁定</h2>
            <p className="mt-1 text-xs text-zinc-500">
              請填寫病患資料，建立成功後會自動綁定此申請（LINE: {createTarget.line_user_id}）。
            </p>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <input
                value={newCaseNumber}
                onChange={(event) => setNewCaseNumber(event.target.value)}
                placeholder="病例號"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={newBirthDate}
                onChange={(event) => setNewBirthDate(event.target.value)}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <input
                value={newFullName}
                onChange={(event) => setNewFullName(event.target.value)}
                placeholder="姓名"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <select
                value={newGender}
                onChange={(event) => setNewGender(event.target.value as "male" | "female" | "other" | "unknown")}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="unknown">未填寫</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={creating}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateAndLink()}
                disabled={creating}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800 disabled:bg-zinc-400"
              >
                {creating ? "建檔中..." : "建檔並綁定"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
