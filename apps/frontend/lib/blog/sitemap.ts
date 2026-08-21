import type { BlogPostSummary } from "@/lib/blog/home-discovery";

export const SITEMAP_STATIC_PATHS = [
  "",
  "/about",
  "/blog",
  "/privacy-policy",
  "/privacy-policy/en",
  "/terms-of-use",
  "/terms-of-use/en",
] as const;

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
};

export function buildSitemapEntries(siteUrl: string, posts: BlogPostSummary[]): SitemapEntry[] {
  return [
    ...SITEMAP_STATIC_PATHS.map((path) => ({
      url: `${siteUrl}${path || "/"}`,
    })),
    ...posts.map((post) => ({
      url: `${siteUrl}/blog/${encodeURIComponent(post.slug)}`,
      lastModified: new Date(post.publishedAt),
    })),
  ];
}
