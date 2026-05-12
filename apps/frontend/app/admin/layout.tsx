"use client";

import { useEffect, useState } from "react";
import { Activity, ChartNoAxesCombined, ClipboardCheck, Hospital, LayoutDashboard, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AdminNotificationBell } from "@/app/admin/_components/admin-notification-bell";
import { AdminNotificationProvider } from "@/app/admin/_components/admin-notification-context";
import { AdminSessionActions } from "@/app/admin/_components/admin-session-actions";
import { apiClient } from "@/lib/api/client";
import { clearStaffSession, getStaffSession } from "@/lib/auth/staff-session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === "/admin/login";
  const hasSession = isLoginRoute ? true : Boolean(getStaffSession());
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (isLoginRoute) {
      return;
    }
    if (!hasSession) {
      router.replace("/admin/login");
      return;
    }

    let cancelled = false;
    async function verifySession() {
      try {
        await apiClient.get("/v1/staff/me");
        if (!cancelled) {
          setIsVerified(true);
        }
      } catch {
        clearStaffSession();
        if (!cancelled) {
          setIsVerified(false);
          router.replace("/admin/login");
        }
      }
    }

    void verifySession();
    return () => {
      cancelled = true;
    };
  }, [hasSession, isLoginRoute, router]);

  if (isLoginRoute) {
    return <>{children}</>;
  }

  if (!hasSession || !isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
        <p className="text-sm text-zinc-500">正在驗證登入狀態...</p>
      </div>
    );
  }

  return (
    <AdminNotificationProvider>
      <div className="min-h-screen bg-zinc-50 flex">
        <aside className="hidden md:flex w-56 bg-white border-r border-zinc-100 flex-col py-6 px-4 fixed top-0 left-0 bottom-0">
          <div className="flex items-center gap-2.5 px-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">PD Care</div>
              <div className="text-xs text-zinc-400">護理師後台</div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            <Link
              href="/admin"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" strokeWidth={1.5} />
              儀表板
            </Link>
            <Link
              href="/admin/review"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/review"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <ClipboardCheck className="w-4 h-4" strokeWidth={1.5} />
              快速審核
            </Link>
            <Link
              href="/admin/monitoring"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/monitoring"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <ChartNoAxesCombined className="w-4 h-4" strokeWidth={1.5} />
              監控中心
            </Link>
            <Link
              href="/admin/patients"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/patients" || pathname.startsWith("/admin/patients/")
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <Hospital className="w-4 h-4" strokeWidth={1.5} />
              病患管理
            </Link>
            <Link
              href="/admin/users"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/users"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <Users className="w-4 h-4" strokeWidth={1.5} />
              用戶管理
            </Link>
          </nav>

          <div className="mt-auto px-2">
            <div className="text-xs text-zinc-300">臺大醫院腹膜透析出口照護系統</div>
          </div>
        </aside>

        <div className="flex-1 md:ml-56 flex flex-col min-h-screen bg-white">
          <header className="bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2 md:hidden">
              <div className="w-6 h-6 rounded-lg bg-zinc-900 flex items-center justify-center">
                <Activity className="w-3.5 h-3.5 text-white" strokeWidth={1.5} />
              </div>
              <span className="text-sm font-semibold text-zinc-900">PD Care</span>
            </div>
            <div className="hidden md:block" />
            <div className="flex items-center gap-3">
              <AdminNotificationBell />
              <AdminSessionActions />
            </div>
          </header>

          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </AdminNotificationProvider>
  );
}
