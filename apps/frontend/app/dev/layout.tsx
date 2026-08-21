import type { Metadata } from "next";

import { NOINDEX_METADATA } from "@/lib/seo/page-metadata";

export const metadata: Metadata = NOINDEX_METADATA;

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
