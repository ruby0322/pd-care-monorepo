import { Activity, Bell, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors text-sm"
          >
            <LayoutDashboard className="w-4 h-4" strokeWidth={1.5} />
            儀表板
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
            <button className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors">
              <Bell className="w-4 h-4 text-zinc-500" strokeWidth={1.5} />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
            </button>
            <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white text-xs font-medium">
              護
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
