import type { Metadata } from "next";
import Link from "next/link";

import { AboutFaqAccordion } from "@/components/about/about-faq-accordion";
import { getSiteUrl } from "@/lib/blog/seo";
import {
  ABOUT_AFFILIATION_HEADING,
  ABOUT_DESCRIPTION,
  ABOUT_FAQ_HEADING,
  ABOUT_FUNCTION_HEADING,
  ABOUT_HISTORY_AFTER_CITATION,
  ABOUT_HISTORY_BEFORE_CITATION,
  ABOUT_HISTORY_CITATION,
  ABOUT_HISTORY_COLLAB,
  ABOUT_HISTORY_HEADING,
  ABOUT_HISTORY_TODAY,
  ABOUT_LEAD,
  ABOUT_LINKS_HEADING,
  ABOUT_TITLE,
  ABOUT_WHAT_IT_DOES,
  ABOUT_WHO_BUILT_IT,
} from "@/lib/seo/about-copy";
import { buildAboutJsonLd } from "@/lib/seo/jsonld";

const canonical = `${getSiteUrl()}/about`;

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  alternates: { canonical },
  openGraph: {
    title: ABOUT_TITLE,
    description: ABOUT_DESCRIPTION,
    locale: "zh_TW",
    type: "website",
    url: canonical,
  },
};

export default function AboutPage() {
  const jsonLd = buildAboutJsonLd(getSiteUrl());

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <h1 className="text-3xl font-semibold leading-snug text-zinc-900">{ABOUT_TITLE}</h1>
      <p className="mt-6 text-lg leading-8 text-zinc-700">{ABOUT_LEAD}</p>

      <section className="mt-12">
        <h2 className="text-xl font-semibold leading-snug text-zinc-900">{ABOUT_FUNCTION_HEADING}</h2>
        <p className="mt-4 text-lg leading-8 text-zinc-700">{ABOUT_WHAT_IT_DOES}</p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold leading-snug text-zinc-900">{ABOUT_AFFILIATION_HEADING}</h2>
        <p className="mt-4 text-lg leading-8 text-zinc-700">{ABOUT_WHO_BUILT_IT}</p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold leading-snug text-zinc-900">{ABOUT_HISTORY_HEADING}</h2>
        <p className="mt-4 text-lg leading-8 text-zinc-700">
          {ABOUT_HISTORY_BEFORE_CITATION}
          <a
            href={ABOUT_HISTORY_CITATION.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {ABOUT_HISTORY_CITATION.label}
          </a>
          {ABOUT_HISTORY_AFTER_CITATION}
        </p>
        <p className="mt-4 text-lg leading-8 text-zinc-700">{ABOUT_HISTORY_COLLAB}</p>
        <p className="mt-4 text-lg leading-8 text-zinc-700">{ABOUT_HISTORY_TODAY}</p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold leading-snug text-zinc-900">{ABOUT_FAQ_HEADING}</h2>
        <div className="mt-4">
          <AboutFaqAccordion />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold leading-snug text-zinc-900">{ABOUT_LINKS_HEADING}</h2>
        <div className="mt-4 flex flex-wrap gap-4 text-base font-medium">
          <Link href="/blog" className="underline underline-offset-4 text-zinc-700 hover:text-zinc-900">
            最新消息
          </Link>
          <Link href="/role-select" className="underline underline-offset-4 text-zinc-700 hover:text-zinc-900">
            開始使用
          </Link>
        </div>
      </section>
    </main>
  );
}
