import { BLOG_ROBOTS_DISALLOW } from "@/lib/blog/seo";

describe("blog robots policy", () => {
  test("disallows authenticated and operational routes", () => {
    expect(BLOG_ROBOTS_DISALLOW).toEqual([
      "/patient",
      "/admin",
      "/login",
      "/onboarding",
      "/apps",
      "/dev",
      "/api",
      "/role-select",
    ]);
  });
});
