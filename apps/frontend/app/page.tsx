import Link from "next/link";
import { Activity, LayoutDashboard } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 flex items-center justify-center">
            <Activity className="w-6 h-6 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">PD Care</h1>
            <p className="text-sm text-zinc-400 mt-1">腹膜透析出口照護系統</p>
          </div>
        </div>

        <div className="w-full flex flex-col gap-3">
          <Link
            href="/patient"
            className="flex items-center justify-between w-full px-5 py-4 rounded-2xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors group"
          >
            <div>
              <div className="text-sm font-medium">病患端</div>
              <div className="text-xs text-zinc-400 mt-0.5">症狀回報與出口拍攝</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <Activity className="w-4 h-4" strokeWidth={1.5} />
            </div>
          </Link>

          <Link
            href="/admin"
            className="flex items-center justify-between w-full px-5 py-4 rounded-2xl border border-zinc-200 text-zinc-900 hover:bg-zinc-50 transition-colors group"
          >
            <div>
              <div className="text-sm font-medium">護理師後台</div>
              <div className="text-xs text-zinc-400 mt-0.5">儀表板與病患管理</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-200 transition-colors">
              <LayoutDashboard className="w-4 h-4 text-zinc-600" strokeWidth={1.5} />
            </div>
          </Link>
        </div>

        <p className="text-xs text-zinc-300 text-center">
          臺大醫院 · 腹膜透析出口影像感染警示系統 PoC
        </p>
      </div>
    </div>
  );
}
