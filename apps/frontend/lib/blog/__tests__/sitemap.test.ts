import { buildSitemapEntries } from "@/lib/blog/sitemap";

describe("sitemap entries", () => {
  const posts = [
    {
      slug: "每天拍一張",
      title: "每天拍一張，護理師比較看得到你",
      description: "why",
      publishedAt: "2026-08-21",
      author: "臺大醫院 PD Care 團隊",
    },
  ];

  test("omits lastModified on static routes and uses publishedAt for posts", () => {
    const entries = buildSitemapEntries("https://example.test", posts);
    const staticEntries = entries.filter((entry) => !entry.url.includes("/blog/"));
    const postEntries = entries.filter((entry) => entry.url.includes("/blog/"));

    expect(staticEntries.map((entry) => entry.url)).toEqual([
      "https://example.test/",
      "https://example.test/blog",
      "https://example.test/privacy-policy",
      "https://example.test/privacy-policy/en",
      "https://example.test/terms-of-use",
      "https://example.test/terms-of-use/en",
    ]);
    expect(staticEntries.every((entry) => entry.lastModified === undefined)).toBe(true);
    expect(postEntries).toEqual([
      {
        url: `https://example.test/blog/${encodeURIComponent("每天拍一張")}`,
        lastModified: new Date("2026-08-21"),
      },
    ]);
  });
});
