"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { clearStaffSession, getStaffRole } from "@/lib/auth/staff-session";

export function AdminSessionActions() {
  const router = useRouter();
  const role = useMemo(() => getStaffRole(), []);

  function handleSignOut() {
    clearStaffSession();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden md:inline text-xs text-zinc-500">{role === "admin" ? "管理員" : "護理師"}</span>
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors"
      >
        登出
      </button>
    </div>
  );
}
