import { ABOUT_DESCRIPTION, ABOUT_FAQS, ABOUT_TITLE } from "@/lib/seo/about-copy";

type JsonLdNode = Record<string, unknown>;

function originFromSiteUrl(siteUrl: string): string {
  return siteUrl.replace(/\/$/, "");
}

export function buildAboutJsonLd(siteUrl: string): { "@context": string; "@graph": JsonLdNode[] } {
  const origin = originFromSiteUrl(siteUrl);
  const aboutUrl = `${origin}/about`;
  const websiteId = `${origin}/#website`;
  const organizationId = `${origin}/#organization`;
  const softwareId = `${origin}/#software`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: "PD Care",
        url: origin,
        inLanguage: "zh-TW",
      },
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "PD Care",
        url: aboutUrl,
        description:
          "臺大醫院腹膜透析中心與國立臺灣大學資訊管理學系合作研發的智慧醫療系統。",
        memberOf: [
          { "@type": "Organization", name: "臺大醫院腹膜透析中心" },
          { "@type": "Organization", name: "國立臺灣大學資訊管理學系" },
        ],
      },
      {
        "@type": "WebPage",
        "@id": aboutUrl,
        url: aboutUrl,
        name: ABOUT_TITLE,
        description: ABOUT_DESCRIPTION,
        isPartOf: { "@id": websiteId },
        about: { "@id": softwareId },
      },
      {
        "@type": "FAQPage",
        mainEntity: ABOUT_FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
      {
        "@type": "SoftwareApplication",
        "@id": softwareId,
        name: "PD Care",
        applicationCategory: "HealthApplication",
      },
    ],
  };
}
