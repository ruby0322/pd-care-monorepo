import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import matter from "gray-matter";

import type { BlogPostSummary } from "@/lib/blog/home-discovery";

export type BlogPost = BlogPostSummary & {
  draft: boolean;
  content: string;
};

const DEFAULT_CONTENT_DIR = join(process.cwd(), "content/blog");

type ListOptions = {
  contentDir?: string;
  nodeEnv?: string;
};

function resolveContentDir(options?: ListOptions): string {
  return options?.contentDir ?? DEFAULT_CONTENT_DIR;
}

function resolveNodeEnv(options?: ListOptions): string {
  return options?.nodeEnv ?? process.env.NODE_ENV ?? "production";
}

function asIsoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? "");
}

function parsePostFile(filePath: string, slug: string): BlogPost {
  const raw = readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  return {
    slug,
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    publishedAt: asIsoDate(data.publishedAt),
    author: String(data.author ?? ""),
    draft: Boolean(data.draft),
    content: parsed.content.trim(),
  };
}

function listAllPosts(options?: ListOptions): BlogPost[] {
  const contentDir = resolveContentDir(options);
  const files = readdirSync(contentDir).filter((name) => name.endsWith(".mdx"));
  return files
    .map((name) => parsePostFile(join(contentDir, name), name.replace(/\.mdx$/, "")))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function listPublishedPosts(options?: ListOptions): BlogPostSummary[] {
  const includeDrafts = resolveNodeEnv(options) !== "production";
  return listAllPosts(options)
    .filter((post) => includeDrafts || !post.draft)
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      description: post.description,
      publishedAt: post.publishedAt,
      author: post.author,
    }));
}

export function getPostBySlug(slug: string, options?: ListOptions): BlogPost | null {
  const decoded = decodeURIComponent(slug);
  const post = listAllPosts(options).find((item) => item.slug === decoded);
  if (!post) {
    return null;
  }
  const includeDrafts = resolveNodeEnv(options) !== "production";
  if (post.draft && !includeDrafts) {
    return null;
  }
  return post;
}

export function getLatestPublishedPost(options?: ListOptions): BlogPostSummary | null {
  return listPublishedPosts(options)[0] ?? null;
}
