"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { useAdminNotifications } from "@/app/admin/_components/admin-notification-context";

export function AdminNotificationBell() {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [openPathname, setOpenPathname] = useState<string | null>(null);
  const { notifications, unreadCount, markingIds, markNotificationRead, loading } = useAdminNotifications();
  const open = openPathname === pathname;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpenPathname(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPathname(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpenPathname((current) => (current === pathname ? null : pathname))}
        className="relative h-8 w-8 rounded-full hover:bg-zinc-100 transition-colors flex items-center justify-center"
        aria-label="通知"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4 text-zinc-500" strokeWidth={1.5} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-medium leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[20rem] max-w-[85vw] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h3 className="text-sm font-medium text-zinc-900">通知</h3>
            <span
              className={clsx(
                "max-w-16 whitespace-normal break-words rounded-full px-2 py-0.5 text-center text-xs leading-tight",
                unreadCount > 0 ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"
              )}
            >
              未讀 {unreadCount}
            </span>
          </div>
          <div className="max-h-[24rem] overflow-y-auto divide-y divide-zinc-50">
            {loading ? (
              <p className="px-4 py-6 text-sm text-zinc-400">載入中...</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-zinc-400">目前沒有通知。</p>
            ) : (
              notifications.map((item) => (
                <div key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-zinc-900">
                      {item.patient_full_name ?? "未命名"} ({item.patient_case_number})
                    </p>
                    <span
                      className={clsx(
                        "max-w-16 whitespace-normal break-words rounded-full px-2 py-0.5 text-center text-[11px] leading-tight",
                        item.status === "new" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"
                      )}
                    >
                      {item.status === "new" ? "新通知" : "已讀"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{new Date(item.created_at).toLocaleString("zh-TW")}</p>
                  {item.summary ? <p className="mt-1 text-xs text-zinc-500">{item.summary}</p> : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Link href={`/admin/patients/${item.patient_id}`} className="text-xs text-zinc-500 hover:text-zinc-800">
                      檢視病患
                    </Link>
                    {item.status === "new" ? (
                      <button
                        type="button"
                        onClick={() => void markNotificationRead(item.id)}
                        disabled={Boolean(markingIds[item.id])}
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                      >
                        標記已讀
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
