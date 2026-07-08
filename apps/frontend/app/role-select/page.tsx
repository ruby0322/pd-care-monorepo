"use client";

import { Activity, LayoutDashboard } from "lucide-react";
import { useRouter } from "next/navigation";

import { buildLoginPath } from "@/lib/auth/liff";

export default function RoleSelectPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-zinc-900">請選擇使用身份</h1>
          <p className="mt-2 text-sm text-zinc-500">先選擇您要進入的服務，再進行後續登入或綁定流程。</p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push(buildLoginPath("/patient"))}
            className="group flex w-full items-center justify-between rounded-2xl bg-zinc-900 px-5 py-4 text-white transition-colors hover:bg-zinc-800"
          >
            <div className="text-left">
              <div className="text-sm font-medium">我是病患</div>
              <div className="mt-0.5 text-xs text-zinc-400">症狀回報與出口拍攝</div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20">
              <Activity className="h-4 w-4" strokeWidth={1.5} />
            </div>
          </button>

          <button
            type="button"
            onClick={() => router.push(buildLoginPath("/admin"))}
            className="group flex w-full items-center justify-between rounded-2xl border border-zinc-200 px-5 py-4 text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            <div className="text-left">
              <div className="text-sm font-medium">我是護理師</div>
              <div className="mt-0.5 text-xs text-zinc-400">儀表板與病患管理</div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 transition-colors group-hover:bg-zinc-200">
              <LayoutDashboard className="h-4 w-4 text-zinc-600" strokeWidth={1.5} />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
