import Link from "next/link";

import type { BlogPostSummary } from "@/lib/blog/home-discovery";

type LatestNewsStripProps = {
  post: BlogPostSummary;
};

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
  });
}

export function LatestNewsStrip({ post }: LatestNewsStripProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium tracking-wide text-zinc-500">最新消息</p>
        <Link href="/blog" className="text-[11px] font-medium text-zinc-500 underline underline-offset-4">
          更多
        </Link>
      </div>
      <Link href={`/blog/${encodeURIComponent(post.slug)}`} className="mt-1 block">
        <p className="text-sm font-medium text-zinc-900">{post.title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {formatDate(post.publishedAt)}
          <span className="ml-2 font-medium text-zinc-700">閱讀</span>
        </p>
      </Link>
    </div>
  );
}
