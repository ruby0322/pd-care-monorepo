"use client";

import Link from "next/link";
import { useMemo } from "react";

import { getPatientSession } from "@/lib/auth/patient-session";
import { getStaffSession } from "@/lib/auth/staff-session";
import { useClientSnapshot } from "@/lib/utils/use-client-snapshot";

function resolveBackHref(): string | null {
  if (getPatientSession()) {
    return "/patient";
  }
  if (getStaffSession()) {
    return "/apps";
  }
  return null;
}

export function BlogHeader() {
  const backHref = useClientSnapshot(resolveBackHref, null);
  const links = useMemo(
    () => [
      { href: "/blog", label: "最新消息" },
      { href: "/role-select", label: "開始使用" },
      ...(backHref ? [{ href: backHref, label: "返回 App" }] : []),
    ],
    [backHref]
  );

  return (
    <header className="border-b border-zinc-100 bg-white">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-4">
        <Link href="/" className="text-sm font-semibold text-zinc-900">
          PD Care
        </Link>
        <nav className="flex items-center gap-3 text-xs font-medium text-zinc-600">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="underline-offset-4 hover:text-zinc-900 hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
