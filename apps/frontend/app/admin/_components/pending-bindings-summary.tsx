import Link from "next/link";

import type { StaffPendingBindingItem } from "@/lib/api/staff";

type PendingBindingsSummaryProps = {
  items: StaffPendingBindingItem[];
  loading: boolean;
  error: string | null;
};

export function PendingBindingsSummary({ items, loading, error }: PendingBindingsSummaryProps) {
  const visible = items.slice(0, 3);
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">待審綁定</h2>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>
      {loading ? <p className="py-3 text-center text-sm text-zinc-400">載入中…</p> : null}
      {!loading && error ? <p className="py-3 text-center text-sm text-red-600">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="py-3 text-center text-sm text-zinc-400">目前沒有待審核綁定。</p>
      ) : null}
      {!loading && !error && visible.length > 0 ? (
        <div className="flex flex-col gap-2">
          {visible.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-900">
                  {item.case_number} / {item.birth_date}
                </p>
                <p className="truncate font-mono text-[10px] text-zinc-400">{item.line_user_id}</p>
              </div>
              <span className="shrink-0 text-[11px] text-zinc-500">
                {item.candidates.length > 0 ? `${item.candidates.length} 候選` : "無候選"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <Link
        href="/admin/registration-review"
        className="mt-2 inline-block text-xs text-zinc-500 hover:text-zinc-800"
      >
        前往註冊審核 →
      </Link>
    </section>
  );
}
