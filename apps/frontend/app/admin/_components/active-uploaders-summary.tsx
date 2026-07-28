import Link from "next/link";

type ActiveUploadersSummaryProps = {
  activeUsers: number | null;
  loading: boolean;
  error: string | null;
};

export function ActiveUploadersSummary({ activeUsers, loading, error }: ActiveUploadersSummaryProps) {
  return (
    <p className="text-xs text-zinc-400">
      {loading ? (
        "近 7 日活躍上傳者載入中…"
      ) : error ? (
        <span className="text-zinc-400">活躍摘要暫時無法載入</span>
      ) : (
        <>
          近 7 日活躍上傳者 {activeUsers ?? "—"} ·{" "}
          <Link href="/admin/history-overview" className="hover:text-zinc-700">
            查看區間分析 →
          </Link>
        </>
      )}
    </p>
  );
}
