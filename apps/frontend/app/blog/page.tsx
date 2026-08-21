import type { Metadata } from "next";
import Link from "next/link";

import { listPublishedPosts } from "@/lib/blog/posts";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

export const metadata: Metadata = publicPageMetadata({
  title: "最新消息｜PD Care",
  description: "腹膜透析出口照護使用教學與平台說明。",
  path: "/blog",
});

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogIndexPage() {
  const posts = listPublishedPosts();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900">最新消息</h1>
      <p className="mt-2 text-sm text-zinc-600">使用教學與照護資訊，協助你開始每日出口紀錄。</p>
      <ul className="mt-8 space-y-4">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${encodeURIComponent(post.slug)}`}
              className="block rounded-2xl border border-zinc-200 px-4 py-4 hover:bg-zinc-50"
            >
              <p className="text-[11px] font-medium text-zinc-500">{formatDate(post.publishedAt)}</p>
              <h2 className="mt-1 text-base font-semibold text-zinc-900">{post.title}</h2>
              <p className="mt-1 text-sm text-zinc-600">{post.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
