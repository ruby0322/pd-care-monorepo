import type { MetadataRoute } from "next";

import { BLOG_ROBOTS_DISALLOW, getSiteUrl } from "@/lib/blog/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...BLOG_ROBOTS_DISALLOW],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
