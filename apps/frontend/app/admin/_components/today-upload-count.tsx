import Link from "next/link";

type TodayUploadCountProps = {
  totalUploads: number | null;
  loading?: boolean;
  dayScopeLabel: string;
  selectedDate: string;
};

export function TodayUploadCount({
  totalUploads,
  loading,
  dayScopeLabel,
  selectedDate,
}: TodayUploadCountProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-zinc-500">{dayScopeLabel}上傳</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900">
            {loading ? "…" : (totalUploads ?? "—")}
          </p>
        </div>
        <Link
          href={`/admin/history-overview?date=${encodeURIComponent(selectedDate)}&tab=clinical`}
          className="text-xs text-zinc-400 hover:text-zinc-700"
        >
          完整日檢視 →
        </Link>
      </div>
    </section>
  );
}
