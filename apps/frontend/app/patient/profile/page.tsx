"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, CircleUserRound } from "lucide-react";

import { getReadableApiError } from "@/lib/api/client";
import { fetchPatientProfile, PatientProfileResponse } from "@/lib/api/identity";
import { buildLoginPath } from "@/lib/auth/liff";
import { getPatientSession } from "@/lib/auth/patient-session";

export default function PatientProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<PatientProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        if (!getPatientSession()) {
          router.replace(buildLoginPath(pathname || "/patient/profile"));
          return;
        }

        const data = await fetchPatientProfile();
        if (!cancelled) {
          setProfile(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(getReadableApiError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return (
    <div className="h-[100dvh] overflow-hidden bg-white px-6 pt-10 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/patient")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">個人資訊</h1>
          <p className="text-xs text-zinc-500">可查看目前綁定的基本資料</p>
        </div>
      </div>

      {loading ? <div className="mt-6 text-sm text-zinc-500">載入中...</div> : null}
      {error ? <div className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {profile ? (
        <div className="mt-6 rounded-3xl border border-zinc-100 bg-white p-5">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
              {profile.picture_url ? (
                <Image
                  src={profile.picture_url}
                  alt={`${profile.display_name ?? "line-user"}-avatar`}
                  width={64}
                  height={64}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-400">
                  <CircleUserRound className="h-7 w-7" />
                </div>
              )}
            </div>
            <div>
              <p className="text-base font-semibold text-zinc-900">{profile.display_name ?? "未提供名稱"}</p>
              <p className="text-xs text-zinc-500 font-mono">{profile.line_user_id}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 text-sm">
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <p className="text-xs text-zinc-500">姓名</p>
              <p className="text-zinc-900">{profile.full_name ?? "未設定"}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <p className="text-xs text-zinc-500">病歷號</p>
              <p className="text-zinc-900">{profile.case_number ?? "未綁定"}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <p className="text-xs text-zinc-500">生日</p>
              <p className="text-zinc-900">{profile.birth_date ?? "未綁定"}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 px-3 py-2">
              <p className="text-xs text-zinc-500">狀態</p>
              <p className="text-zinc-900">{profile.status}</p>
            </div>
          </div>
        </div>
      ) : null}

      <Link
        href="/patient"
        className="mt-6 inline-flex items-center text-sm text-zinc-600 underline underline-offset-4"
      >
        返回追蹤首頁
      </Link>
    </div>
  );
}
