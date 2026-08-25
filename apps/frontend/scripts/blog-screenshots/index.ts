/**
 * Regenerates named blog screenshots from the real stub UI.
 *
 *   npm run blog:screenshots
 *   npm run blog:screenshots -- --list
 *   npm run blog:screenshots -- --only home,result
 *
 * See ./README.md
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BLOG_SHOT_CATALOG, formatCatalog, type BlogShot } from "./catalog";
import { parseArgs, USAGE } from "./cli";
import { assertPersonasAvailable, createRuntime, launchBlogBrowser, makeFakeCameraVideo } from "./runtime";
import { capturePatientCaptureFlow, capturePatientGalleryFlow, INDEPENDENT_SHOT_RUNNERS } from "./shots";

const root = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(root, "../..");
const defaultOutDir = join(frontendRoot, "public/blog");
const stockExitPhoto = join(defaultOutDir, "stock-exit-site.jpg");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

async function runShots(shots: readonly BlogShot[], outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const fakeVideo = makeFakeCameraVideo(stockExitPhoto);
  const { browser, page } = await launchBlogBrowser({ baseURL, fakeVideo });
  const runtime = createRuntime(page, baseURL, outDir, stockExitPhoto);

  try {
    await assertPersonasAvailable(page, baseURL);
    const selectedIds = new Set(shots.map((shot) => shot.id));

    for (const shot of shots) {
      if (shot.flow) {
        continue;
      }
      const runner = INDEPENDENT_SHOT_RUNNERS[shot.id as keyof typeof INDEPENDENT_SHOT_RUNNERS];
      if (!runner) {
        throw new Error(`No independent runner registered for shot "${shot.id}". Add it in shots.ts.`);
      }
      await runner(runtime);
    }

    if (selectedIds.has("gallery") || selectedIds.has("gallery-calendar")) {
      await capturePatientGalleryFlow(runtime, selectedIds);
    }

    if (selectedIds.has("capture") || selectedIds.has("result")) {
      await capturePatientCaptureFlow(runtime, selectedIds);
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.list) {
    console.log(formatCatalog());
    return;
  }

  const shots = args.only ?? [...BLOG_SHOT_CATALOG];
  const outDir = args.outDir ? resolve(args.outDir) : defaultOutDir;
  await runShots(shots, outDir);
}

void main();
