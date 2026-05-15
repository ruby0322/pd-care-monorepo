"use client";

import {
  Activity,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Hospital,
  LayoutDashboard,
  Link2,
  Menu,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("admin-sidebar-collapsed") === "true";
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMobileSidebarOpen]);

  function setSidebarCollapsed(next: boolean) {
    setIsSidebarCollapsed(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("admin-sidebar-collapsed", String(next));
    }
  }

  function closeMobileSidebar() {
    setIsMobileSidebarOpen(false);
  }

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
        <div
          className={`fixed inset-0 z-40 bg-zinc-900/30 transition-opacity md:hidden ${
            isMobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
        <aside
          className={`fixed top-0 left-0 bottom-0 z-50 w-64 bg-white border-r border-zinc-100 flex flex-col py-6 px-4 transition-transform duration-200 md:hidden ${
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-2 mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" strokeWidth={1.5} />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-900">PD Care</div>
                <div className="text-xs text-zinc-400">護理師後台</div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeMobileSidebar}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
              aria-label="關閉側邊欄"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            <Link
              href="/admin"
              onClick={closeMobileSidebar}
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
              onClick={closeMobileSidebar}
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
              href="/admin/registration-review"
              onClick={closeMobileSidebar}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/registration-review"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <Link2 className="w-4 h-4" strokeWidth={1.5} />
              註冊審核
            </Link>

            <Link
              href="/admin/patients"
              onClick={closeMobileSidebar}
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
              href="/admin/patient-assignment"
              onClick={closeMobileSidebar}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/patient-assignment"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <UserCheck className="w-4 h-4" strokeWidth={1.5} />
              病患分配
            </Link>
            <Link
              href="/admin/users"
              onClick={closeMobileSidebar}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/users"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <Users className="w-4 h-4" strokeWidth={1.5} />
              用戶管理
            </Link>
            <Link
              href="/admin/monitoring"
              onClick={closeMobileSidebar}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                pathname === "/admin/monitoring"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <ChartNoAxesCombined className="w-4 h-4" strokeWidth={1.5} />
              監控中心
            </Link>
          </nav>

          <div className="mt-auto px-2">
            <div className="text-xs text-zinc-300">臺大醫院腹膜透析出口照護系統</div>
          </div>
        </aside>

        <aside
          className={`hidden md:flex bg-white border-r border-zinc-100 flex-col py-6 fixed top-0 left-0 bottom-0 transition-all duration-200 ${
            isSidebarCollapsed ? "w-20 px-3" : "w-56 px-4"
          }`}
        >
          <div className={`flex items-center px-2 mb-8 ${isSidebarCollapsed ? "justify-center" : "justify-between"}`}>
            <div className={`flex items-center ${isSidebarCollapsed ? "" : "gap-2.5"}`}>
              <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" strokeWidth={1.5} />
              </div>
              {!isSidebarCollapsed ? (
                <div>
                  <div className="text-sm font-semibold text-zinc-900">PD Care</div>
                  <div className="text-xs text-zinc-400">護理師後台</div>
                </div>
              ) : null}
            </div>
            {!isSidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
                aria-label="收合側邊欄"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
              </button>
            ) : null}
          </div>

          {isSidebarCollapsed ? (
            <div className="mb-8 flex justify-center">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
                aria-label="展開側邊欄"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          ) : null}

          <nav className="flex flex-col gap-1">
            <Link
              href="/admin"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="儀表板"
              title={isSidebarCollapsed ? "儀表板" : undefined}
            >
              <LayoutDashboard className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "儀表板" : null}
            </Link>
            <Link
              href="/admin/review"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/review"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="快速審核"
              title={isSidebarCollapsed ? "快速審核" : undefined}
            >
              <ClipboardCheck className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "快速審核" : null}
            </Link>
            <Link
              href="/admin/registration-review"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/registration-review"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="註冊審核"
              title={isSidebarCollapsed ? "註冊審核" : undefined}
            >
              <Link2 className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "註冊審核" : null}
            </Link>

            <Link
              href="/admin/patients"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/patients" || pathname.startsWith("/admin/patients/")
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="病患管理"
              title={isSidebarCollapsed ? "病患管理" : undefined}
            >
              <Hospital className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "病患管理" : null}
            </Link>
            <Link
              href="/admin/patient-assignment"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/patient-assignment"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="病患分配"
              title={isSidebarCollapsed ? "病患分配" : undefined}
            >
              <UserCheck className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "病患分配" : null}
            </Link>
            <Link
              href="/admin/users"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/users"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="用戶管理"
              title={isSidebarCollapsed ? "用戶管理" : undefined}
            >
              <Users className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "用戶管理" : null}
            </Link>
            <Link
              href="/admin/monitoring"
              className={`flex items-center rounded-xl transition-colors text-sm ${
                isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                pathname === "/admin/monitoring"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
              aria-label="監控中心"
              title={isSidebarCollapsed ? "監控中心" : undefined}
            >
              <ChartNoAxesCombined className="w-4 h-4" strokeWidth={1.5} />
              {!isSidebarCollapsed ? "監控中心" : null}
            </Link>
          </nav>

          <div className="mt-auto px-2">
            {!isSidebarCollapsed ? <div className="text-xs text-zinc-300">臺大醫院腹膜透析出口照護系統</div> : null}
          </div>
        </aside>

        <div
          className={`flex-1 flex flex-col min-h-screen bg-white transition-all duration-200 ${
            isSidebarCollapsed ? "md:ml-20" : "md:ml-56"
          }`}
        >
          <header className="bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
                aria-label="開啟側邊欄"
              >
                <Menu className="w-4 h-4" strokeWidth={1.5} />
              </button>
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
