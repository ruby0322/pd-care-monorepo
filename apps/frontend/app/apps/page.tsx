"use client";

import { Activity, LayoutDashboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchAuthBootstrap } from "@/lib/api/identity";
import { buildLoginPath } from "@/lib/auth/liff";
import { clearPatientSession, getPatientSession } from "@/lib/auth/patient-session";
import { clearStaffSession } from "@/lib/auth/staff-session";
import { getLiffLoginProof } from "@/lib/auth/liff";
import { getStaffSession } from "@/lib/auth/staff-session";
import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

type AppAccessSnapshot = "loading" | "unauthenticated" | "patient-only" | "ready:admin-only" | "ready:with-patient";

function getAppAccessSnapshot(): AppAccessSnapshot {
  const staffSession = getStaffSession();
  if (!staffSession) {
    if (getPatientSession()) {
      return "patient-only";
    }
    return "unauthenticated";
  }

  if (getPatientSession()) {
    return "ready:with-patient";
  }
  return "ready:admin-only";
}

export default function AppSelectionPage() {
  const router = useRouter();
  const access = useClientSnapshot(getAppAccessSnapshot, "loading");
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    if (access === "unauthenticated") {
      let cancelled = false;
      async function resolveAccess() {
        try {
          setIsResolving(true);
          const { idToken } = await getLiffLoginProof();
          const bootstrap = await fetchAuthBootstrap(idToken);
          if (cancelled) {
            return;
          }
          if (bootstrap.next_step === "app_selection") {
            router.replace(buildLoginPath("/apps"));
            return;
          }
          if (bootstrap.next_step === "patient_app") {
            router.replace(buildLoginPath("/patient"));
            return;
          }
          clearStaffSession();
          clearPatientSession();
          if (bootstrap.next_step === "role_select") {
            router.replace("/role-select");
            return;
          }
          if (bootstrap.next_step === "onboarding_admin") {
            router.replace("/onboarding/admin");
            return;
          }
          if (bootstrap.next_step === "onboarding_patient") {
            router.replace("/onboarding/patient");
            return;
          }
          router.replace("/");
        } catch {
          router.replace(buildLoginPath("/apps"));
        } finally {
          if (!cancelled) {
            setIsResolving(false);
          }
        }
      }
      void resolveAccess();
      return () => {
        cancelled = true;
      };
    }
    if (access === "patient-only") {
      router.replace("/patient");
      return;
    }
  }, [access, router]);

  if (!access.startsWith("ready:") || isResolving) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
        <p className="text-sm text-zinc-500">正在載入可用應用程式...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">選擇要進入的 App</h1>
        <p className="mt-1 text-sm text-zinc-500">您可以依照目前需求進入護理師後台或病患端。</p>

        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="group flex w-full items-center justify-between rounded-2xl bg-zinc-900 px-5 py-4 text-white transition-colors hover:bg-zinc-800"
          >
            <div className="text-left">
              <div className="text-sm font-medium">護理師後台</div>
              <div className="mt-0.5 text-xs text-zinc-400">審核、追蹤與病患管理</div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20">
              <LayoutDashboard className="h-4 w-4" strokeWidth={1.5} />
            </div>
          </button>

          {access === "ready:with-patient" ? (
            <button
              type="button"
              onClick={() => router.push("/patient")}
              className="group flex w-full items-center justify-between rounded-2xl border border-zinc-200 px-5 py-4 text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              <div className="text-left">
                <div className="text-sm font-medium">病患 App</div>
                <div className="mt-0.5 text-xs text-zinc-400">症狀回報與出口拍攝</div>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 transition-colors group-hover:bg-zinc-200">
                <Activity className="h-4 w-4 text-zinc-600" strokeWidth={1.5} />
              </div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
