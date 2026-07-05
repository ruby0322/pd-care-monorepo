"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { buildLoginPath } from "@/lib/auth/liff";

export default function AdminLoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(buildLoginPath("/admin"));
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <p className="text-sm text-zinc-500">正在導向統一登入頁...</p>
    </div>
  );
}
