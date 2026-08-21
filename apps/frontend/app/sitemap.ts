import type { MetadataRoute } from "next";

import { listPublishedPosts } from "@/lib/blog/posts";
import { getSiteUrl } from "@/lib/blog/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const posts = listPublishedPosts();
  const staticRoutes = ["", "/blog", "/privacy-policy", "/privacy-policy/en", "/terms-of-use", "/terms-of-use/en"];

  return [
    ...staticRoutes.map((path) => ({
      url: `${siteUrl}${path || "/"}`,
      lastModified: new Date(),
    })),
    ...posts.map((post) => ({
      url: `${siteUrl}/blog/${encodeURIComponent(post.slug)}`,
      lastModified: new Date(post.publishedAt),
    })),
  ];
}
