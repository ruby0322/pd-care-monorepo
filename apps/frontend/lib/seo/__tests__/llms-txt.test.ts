import { buildLlmsTxt } from "@/lib/seo/llms-txt";

describe("llms.txt", () => {
  const body = buildLlmsTxt("https://example.test/");

  test("points crawlers at /about and affiliation, not patient app routes", () => {
    expect(body).toContain("https://example.test/about");
    expect(body).toContain("腹膜透析中心");
    expect(body).toContain("資訊管理學系");
    expect(body).not.toContain("/patient");
    expect(body).not.toContain("/admin");
  });
});
