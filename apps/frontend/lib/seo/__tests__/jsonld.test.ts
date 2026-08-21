import { ABOUT_FAQS } from "@/lib/seo/about-copy";
import { buildAboutJsonLd } from "@/lib/seo/jsonld";

describe("about JSON-LD", () => {
  const jsonLd = buildAboutJsonLd("https://example.test/");
  const graph = jsonLd["@graph"] as Array<Record<string, unknown>>;

  function nodesOfType(type: string): Array<Record<string, unknown>> {
    return graph.filter((node) => node["@type"] === type);
  }

  test("includes FAQPage and Organization and not hospital medical types", () => {
    const types = graph.map((node) => node["@type"]);
    expect(types).toEqual(expect.arrayContaining(["FAQPage", "Organization", "WebSite", "WebPage", "SoftwareApplication"]));
    expect(types).not.toContain("MedicalOrganization");
    expect(types).not.toContain("MedicalWebPage");
    expect(nodesOfType("Organization")[0]?.name).toBe("PD Care");
  });

  test("FAQ answers match ABOUT_FAQS verbatim", () => {
    const faqPage = nodesOfType("FAQPage")[0];
    const entities = faqPage.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(entities.map((item) => ({ question: item.name, answer: item.acceptedAnswer.text }))).toEqual(ABOUT_FAQS);
  });
});
