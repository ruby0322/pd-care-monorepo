import type { Metadata } from "next";

import { NOINDEX_METADATA } from "@/lib/seo/page-metadata";

export const metadata: Metadata = NOINDEX_METADATA;

export default function RoleSelectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
