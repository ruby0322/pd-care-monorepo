import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPostBySlug, listPublishedPosts } from "@/lib/blog/posts";

function writePost(dir: string, slug: string, body: string): void {
  writeFileSync(join(dir, `${slug}.mdx`), body, "utf8");
}

const POST_FRONTMATTER = `author: 臺大醫院 PD Care 團隊
draft: false
---

body
`;

describe("blog MDX collection", () => {
  const dir = mkdtempSync(join(tmpdir(), "pd-care-blog-"));

  beforeAll(() => {
    writePost(
      dir,
      "三分鐘學會拍照上傳",
      `---
title: 三分鐘學會拍照上傳
description: LINE 登入到第一張出口照。
publishedAt: "2026-08-20"
author: 臺大醫院 PD Care 團隊
draft: false
---

步驟一
`
    );
    writePost(
      dir,
      "每天拍一張",
      `---
title: 每天拍一張，護理師比較看得到你
description: 平台能為你做什麼。
publishedAt: "2026-08-21"
author: 臺大醫院 PD Care 團隊
draft: false
---

說明
`
    );
    writePost(
      dir,
      "草稿",
      `---
title: 草稿
description: hidden
publishedAt: "2026-08-22"
author: 臺大醫院 PD Care 團隊
draft: true
---

secret
`
    );
  });

  test("lists published posts newest first and round-trips Chinese slugs", () => {
    const posts = listPublishedPosts({ contentDir: dir, nodeEnv: "production" });
    expect(posts.map((post) => post.slug)).toEqual(["每天拍一張", "三分鐘學會拍照上傳"]);
    expect(getPostBySlug("每天拍一張", { contentDir: dir, nodeEnv: "production" })?.title).toBe(
      "每天拍一張，護理師比較看得到你"
    );
  });

  test("omits draft posts in production and includes them in development", () => {
    const prod = listPublishedPosts({ contentDir: dir, nodeEnv: "production" });
    const dev = listPublishedPosts({ contentDir: dir, nodeEnv: "development" });
    expect(prod.some((post) => post.slug === "草稿")).toBe(false);
    expect(dev.some((post) => post.slug === "草稿")).toBe(true);
  });

  test("caches production reads so later files in the same directory are ignored", () => {
    const isolated = mkdtempSync(join(tmpdir(), "pd-care-blog-cache-"));
    writePost(
      isolated,
      "first",
      `---
title: first
description: cached
publishedAt: "2026-08-21"
${POST_FRONTMATTER}`
    );
    expect(listPublishedPosts({ contentDir: isolated, nodeEnv: "production" }).map((post) => post.slug)).toEqual([
      "first",
    ]);
    writePost(
      isolated,
      "second",
      `---
title: second
description: should stay invisible
publishedAt: "2026-08-22"
${POST_FRONTMATTER}`
    );
    expect(listPublishedPosts({ contentDir: isolated, nodeEnv: "production" }).map((post) => post.slug)).toEqual([
      "first",
    ]);
  });

  test("re-reads in development so new files appear without restart", () => {
    const isolated = mkdtempSync(join(tmpdir(), "pd-care-blog-dev-"));
    writePost(
      isolated,
      "first",
      `---
title: first
description: live
publishedAt: "2026-08-21"
${POST_FRONTMATTER}`
    );
    expect(listPublishedPosts({ contentDir: isolated, nodeEnv: "development" }).map((post) => post.slug)).toEqual([
      "first",
    ]);
    writePost(
      isolated,
      "second",
      `---
title: second
description: appears in dev
publishedAt: "2026-08-22"
${POST_FRONTMATTER}`
    );
    expect(listPublishedPosts({ contentDir: isolated, nodeEnv: "development" }).map((post) => post.slug)).toEqual([
      "second",
      "first",
    ]);
  });
});
