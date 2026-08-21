import type { Metadata } from "next";

import { getSiteUrl } from "@/lib/blog/seo";

export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: false },
};

export function publicPageMetadata(input: {
  title: string;
  description: string;
  path: string;
  locale?: "zh_TW" | "en_US";
}): Metadata {
  const origin = getSiteUrl();
  const canonical = input.path === "/" ? `${origin}/` : `${origin}${input.path}`;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    openGraph: {
      title: input.title,
      description: input.description,
      locale: input.locale ?? "zh_TW",
      type: "website",
      url: canonical,
    },
  };
}
