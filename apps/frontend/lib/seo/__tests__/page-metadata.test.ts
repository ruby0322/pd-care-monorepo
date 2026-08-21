import { publicPageMetadata } from "@/lib/seo/page-metadata";

describe("publicPageMetadata", () => {
  test("sets canonical and openGraph url for static public paths", () => {
    const about = publicPageMetadata({
      title: "關於",
      description: "desc",
      path: "/about",
    });
    expect(String(about.alternates?.canonical)).toMatch(/\/about$/);
    expect(String(about.openGraph?.url)).toMatch(/\/about$/);
    expect(about.openGraph?.locale).toBe("zh_TW");
  });
});
