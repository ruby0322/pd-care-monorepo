"use client";

import { notFound } from "next/navigation";

import { DEV_PERSONAS, prepareDevPersonaSwitch, type DevPersona } from "@/lib/auth/dev-personas";
import { isLiffDevBypassActive } from "@/lib/auth/liff";

export default function DevPersonasPage() {
  if (!isLiffDevBypassActive()) {
    notFound();
  }

  const onSelect = (persona: DevPersona) => {
    const path = prepareDevPersonaSwitch(persona);
    window.location.assign(path);
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-900">本機測試身分</h1>
          <p className="text-sm text-zinc-600">
            僅在 LIFF bypass（未設定 <code className="text-xs">NEXT_PUBLIC_LIFF_ID</code>）時可用。請先執行{" "}
            <code className="text-xs">npm run seed:dev-personas</code>。
          </p>
        </header>

        <ul className="flex flex-col gap-3">
          {DEV_PERSONAS.map((persona) => (
            <li
              key={persona.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900">{persona.label}</p>
                <p className="text-xs text-zinc-500">{persona.description}</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-400">{persona.id}</p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(persona)}
                className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                以此身分進入
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
