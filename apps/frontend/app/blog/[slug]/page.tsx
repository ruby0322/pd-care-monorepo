import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";

import { blogMdxComponents } from "@/components/blog/mdx-components";
import { ARTICLE_DISCLAIMER } from "@/lib/blog/home-discovery";
import { getPostBySlug, listPublishedPosts } from "@/lib/blog/posts";
import { getSiteUrl } from "@/lib/blog/seo";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return listPublishedPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return { title: "最新消息｜PD Care" };
  }
  const canonical = `${getSiteUrl()}/blog/${encodeURIComponent(post.slug)}`;
  return {
    title: `${post.title}｜PD Care`,
    description: post.description,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description: post.description,
      locale: "zh_TW",
      type: "article",
      url: canonical,
    },
  };
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  const canonical = `${getSiteUrl()}/blog/${encodeURIComponent(post.slug)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    inLanguage: "zh-TW",
    url: canonical,
    author: {
      "@type": "Organization",
      name: post.author,
    },
  };

  return (
    <article className="mx-auto w-full max-w-2xl px-5 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="text-xs text-zinc-500">{formatDate(post.publishedAt)}</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{post.title}</h1>
      <p className="mt-2 text-sm text-zinc-500">{post.author}</p>
      <div className="mt-6">
        <MDXRemote source={post.content} components={blogMdxComponents} options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }} />
      </div>
      <p className="mt-10 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-zinc-600">
        {ARTICLE_DISCLAIMER}
      </p>
    </article>
  );
}
