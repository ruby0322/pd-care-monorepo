import type { MetadataRoute } from "next";

import { listPublishedPosts } from "@/lib/blog/posts";
import { getSiteUrl } from "@/lib/blog/seo";
import { buildSitemapEntries } from "@/lib/blog/sitemap";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries(getSiteUrl(), listPublishedPosts());
}
