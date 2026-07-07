"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Camera, ShieldCheck, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

import { getPatientSession } from "@/lib/auth/patient-session";
import { getStaffSession } from "@/lib/auth/staff-session";

type EntryState = "checking" | "intro" | "redirect-apps" | "redirect-patient";

function resolveEntryState(): EntryState {
  if (typeof window === "undefined") {
    return "checking";
  }
  if (getStaffSession()) {
    return "redirect-apps";
  }
  if (getPatientSession()) {
    return "redirect-patient";
  }
  return "intro";
}

export default function Home() {
  const router = useRouter();
  const [entryState] = useState<EntryState>(() => resolveEntryState());

  useEffect(() => {
    if (entryState === "redirect-apps") {
      router.replace("/apps");
      return;
    }
    if (entryState === "redirect-patient") {
      router.replace("/patient");
    }
  }, [entryState, router]);

  if (entryState !== "intro") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <p className="text-sm text-zinc-500">正在整理您的入口...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900">
            <Activity className="h-6 w-6 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">PD Care</h1>
            <p className="mt-1 text-sm text-zinc-500">腹膜透析出口照護系統</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            協助病患每日紀錄出口狀態，讓護理團隊即時掌握風險並加速追蹤處置。
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Camera className="mt-0.5 h-4 w-4 text-zinc-700" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-zinc-900">出口影像拍攝與追蹤</p>
              <p className="text-xs text-zinc-500">快速上傳與回看每日出口影像，記錄照護進展。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-zinc-700" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-zinc-900">AI 感染風險偵測</p>
              <p className="text-xs text-zinc-500">透過模型標記疑似感染案例，提早啟動醫療判斷。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <Stethoscope className="mt-0.5 h-4 w-4 text-zinc-700" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-zinc-900">護理師即時審核</p>
              <p className="text-xs text-zinc-500">後台可查看病患動態、訊息與審核任務，縮短回應時間。</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push("/role-select")}
          className="w-full rounded-2xl bg-zinc-900 px-5 py-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          開始使用
        </button>

        <p className="text-center text-xs text-zinc-300">臺大醫院 · 腹膜透析出口影像感染警示系統</p>
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-500">
          <Link href="/privacy-policy" className="underline underline-offset-4 hover:text-zinc-800">
            隱私權政策
          </Link>
          <Link href="/terms-of-use" className="underline underline-offset-4 hover:text-zinc-800">
            使用條款
          </Link>
        </div>
      </div>
    </div>
  );
}
