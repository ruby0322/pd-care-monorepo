import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { BLOG_PHONE_VIEWPORT } from "./catalog";

/** Keep in sync with DEV_LINE_USER_STORAGE_KEY in lib/auth/liff.ts */
const DEV_LINE_USER_STORAGE_KEY = "pdCare.devLineUserId";

const HIDE_DEV_OVERLAY = "nextjs-portal, [data-next-badge-root] { display: none !important; }";

export type ShotRuntime = {
  page: Page;
  baseURL: string;
  outDir: string;
  stockExitPhoto: string;
  screenshot: (file: string) => Promise<void>;
  loginAs: (personaId: string, waitForPath: RegExp, nextPath: string) => Promise<void>;
};

export function makeFakeCameraVideo(stockExitPhoto: string): string | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), "pd-care-blog-cam-"));
    const y4m = join(dir, "exit-site.y4m");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loop",
        "1",
        "-i",
        stockExitPhoto,
        "-t",
        "20",
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=15",
        "-pix_fmt",
        "yuv420p",
        y4m,
      ],
      { stdio: "pipe" }
    );
    return y4m;
  } catch (error) {
    console.warn("ffmpeg fake-camera video skipped:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function launchBlogBrowser(options: {
  baseURL: string;
  fakeVideo: string | null;
}): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(options.fakeVideo ? [`--use-file-for-fake-video-capture=${options.fakeVideo}`] : []),
    ],
  });
  const context = await browser.newContext({
    viewport: { width: BLOG_PHONE_VIEWPORT.width, height: BLOG_PHONE_VIEWPORT.height },
    deviceScaleFactor: BLOG_PHONE_VIEWPORT.deviceScaleFactor,
    permissions: ["camera"],
  });
  await context.grantPermissions(["camera"], { origin: options.baseURL });
  const page = await context.newPage();
  return { browser, context, page };
}

export function createRuntime(page: Page, baseURL: string, outDir: string, stockExitPhoto: string): ShotRuntime {
  return {
    page,
    baseURL,
    outDir,
    stockExitPhoto,
    screenshot: async (file) => {
      await page.addStyleTag({ content: HIDE_DEV_OVERLAY });
      await page.screenshot({ path: join(outDir, file), type: "png" });
      console.log(`wrote ${file}`);
    },
    loginAs: async (personaId, waitForPath, nextPath) => {
      await page.goto(`${baseURL}/dev/personas`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "本機測試身分" })).toBeVisible();
      await page.evaluate(
        ({ key, id }) => {
          localStorage.clear();
          sessionStorage.clear();
          localStorage.setItem(key, id);
        },
        { key: DEV_LINE_USER_STORAGE_KEY, id: personaId }
      );
      await page.goto(
        `${baseURL}/login?next=${encodeURIComponent(nextPath)}&dev_line_user_id=${encodeURIComponent(personaId)}`,
        { waitUntil: "domcontentloaded" }
      );
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
      await expect(page).toHaveURL((url) => waitForPath.test(url.pathname));
    },
  };
}

/** Replace remote clinical images with the licensed stock exit-site JPEG. */
export async function stubRemoteImagesWithStockPhoto(page: Page, stockExitPhoto: string): Promise<void> {
  const body = readFileSync(stockExitPhoto);
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "image") {
      await route.continue();
      return;
    }
    const url = route.request().url();
    if (url.includes("/_next/") || url.includes("/blog/")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      body,
    });
  });
}

export async function assertPersonasAvailable(page: Page, baseURL: string): Promise<void> {
  const personas = await page.goto(`${baseURL}/dev/personas`, { waitUntil: "domcontentloaded" });
  if (!personas || personas.status() >= 400) {
    throw new Error(
      `Cannot open /dev/personas (${personas?.status() ?? "no response"}). ` +
        "Start `npm run dev` with NEXT_PUBLIC_LIFF_ID unset and seed personas."
    );
  }
  await expect(page.getByRole("heading", { name: "本機測試身分" })).toBeVisible();
}
