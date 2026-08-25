import { expect } from "@playwright/test";

import { BINDABLE_PATIENT, type BlogShotId } from "./catalog";
import { stubRemoteImagesWithStockPhoto, type ShotRuntime } from "./runtime";

async function waitForLiveCamera(runtime: ShotRuntime): Promise<boolean> {
  try {
    await runtime.page.waitForFunction(
      () => {
        const video = document.querySelector("video");
        return Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
      },
      { timeout: 8_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function dismissSymptomModal(runtime: ShotRuntime): Promise<void> {
  const { page } = runtime;
  await page.goto(`${runtime.baseURL}/patient/capture`, { waitUntil: "networkidle" });
  const symptomHeading = page.getByRole("heading", { name: "請先填寫本次症狀" });
  const noSymptomButton = page.getByRole("button", { name: "皆無症狀" });
  await expect(symptomHeading).toBeVisible({ timeout: 15_000 });
  await expect(noSymptomButton).toBeVisible();
  await expect(async () => {
    await noSymptomButton.click();
    await expect(symptomHeading).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function openCapturePreview(runtime: ShotRuntime, writeCaptureShot: boolean): Promise<void> {
  const { page, stockExitPhoto } = runtime;
  await dismissSymptomModal(runtime);

  const fileInput = page.locator('input[type="file"]');
  const fallbackUpload = page.getByRole("button", { name: "改用拍照上傳" });
  const hasLiveCamera = await waitForLiveCamera(runtime);

  if (hasLiveCamera) {
    await page
      .getByText("畫面晃動中，請握穩後再對準出口")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => undefined);
    if (writeCaptureShot) {
      await runtime.screenshot("shot-capture.png");
    }
    await fileInput.setInputFiles(stockExitPhoto);
  } else {
    await expect(fallbackUpload).toBeVisible({ timeout: 8_000 });
    await fallbackUpload.click();
    await fileInput.setInputFiles(stockExitPhoto);
    await expect(page.getByRole("heading", { name: "確認上傳照片" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "先不要，返回預覽" }).click();
    await expect(page.getByRole("heading", { name: "確認上傳照片" })).toBeHidden();
    if (writeCaptureShot) {
      await runtime.screenshot("shot-capture.png");
    }
    await page.getByRole("button", { name: "送出分析" }).click();
  }

  await expect(page.getByRole("heading", { name: "確認上傳照片" })).toBeVisible({ timeout: 15_000 });
}

async function submitCaptureAndWaitForResult(runtime: ShotRuntime): Promise<void> {
  const { page } = runtime;
  await page.getByRole("button", { name: "送出分析" }).click();
  await page.waitForURL((url) => url.pathname === "/patient/result", { timeout: 180_000 });
  await expect(page.getByText("分析結果")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const img = document.querySelector('img[alt^="upload-preview"]');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 200 && img.naturalHeight > 200;
    },
    { timeout: 30_000 }
  );
  await expect(page.getByText("本次上傳預覽")).toHaveCount(0);
  const previewBox = page.locator('img[alt^="upload-preview"]').first();
  await expect(previewBox).toBeVisible();
  const previewShot = await previewBox.screenshot();
  if (previewShot.length < 8_000) {
    throw new Error(`Result preview looks empty (${previewShot.length} bytes).`);
  }
}

export async function captureRoleSelect(runtime: ShotRuntime): Promise<void> {
  await runtime.page.goto(`${runtime.baseURL}/role-select`, { waitUntil: "networkidle" });
  await expect(runtime.page.getByRole("heading", { name: "請選擇使用身份" })).toBeVisible();
  await runtime.screenshot("shot-role-select.png");
}

export async function captureBind(runtime: ShotRuntime): Promise<void> {
  await runtime.loginAs("U_DEV_NEW", /^\/role-select$/, "/role-select");
  await runtime.page.getByRole("button", { name: "我是病患" }).click();
  await runtime.page.waitForURL((url) => url.pathname === "/onboarding/patient", { timeout: 60_000 });
  await expect(runtime.page.getByRole("heading", { name: "病患身分註冊" })).toBeVisible({ timeout: 30_000 });
  await runtime.page.locator("#case-number").fill(BINDABLE_PATIENT.caseNumber);
  await runtime.page.locator("#birth-date").fill(BINDABLE_PATIENT.birthDate);
  await runtime.screenshot("shot-bind.png");
}

export async function capturePending(runtime: ShotRuntime): Promise<void> {
  await runtime.loginAs("U_DEV_PAT_PEND", /^\/onboarding\/patient$/, "/patient");
  await expect(runtime.page.getByRole("heading", { name: /審核/ })).toBeVisible({ timeout: 30_000 });
  await runtime.screenshot("shot-pending.png");
}

export async function captureHome(runtime: ShotRuntime): Promise<void> {
  await runtime.loginAs("U_DEV_PAT_MATCH", /^\/patient$/, "/patient");
  await expect(runtime.page.getByRole("link", { name: "拍攝" })).toBeVisible({ timeout: 30_000 });
  await runtime.screenshot("shot-home.png");
}

export async function captureHomePhotos(runtime: ShotRuntime): Promise<void> {
  await runtime.loginAs("U_DEV_PAT_MATCH", /^\/patient$/, "/patient");
  const photosTab = runtime.page.getByRole("tab", { name: "相片" });
  await expect(photosTab).toBeVisible({ timeout: 30_000 });
  await photosTab.click();
  await expect(photosTab).toHaveAttribute("aria-selected", "true");
  await expect(runtime.page.getByRole("link", { name: "查看相簿" })).toBeVisible({ timeout: 15_000 });
  await runtime.screenshot("shot-home-photos.png");
}

async function waitForLoadedImages(runtime: ShotRuntime, selector: string): Promise<void> {
  await runtime.page.waitForFunction(
    (target) => {
      const images = Array.from(document.querySelectorAll(target));
      return (
        images.length > 0 &&
        images.every((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 20)
      );
    },
    selector,
    { timeout: 20_000 }
  );
}

async function openGallery(runtime: ShotRuntime): Promise<void> {
  await runtime.page.goto(`${runtime.baseURL}/patient/gallery`, { waitUntil: "networkidle" });
  await expect(runtime.page.getByRole("heading", { name: "相簿" })).toBeVisible({ timeout: 30_000 });
}

export async function capturePatientGalleryFlow(
  runtime: ShotRuntime,
  selected: ReadonlySet<BlogShotId>
): Promise<void> {
  await runtime.loginAs("U_DEV_PAT_MATCH", /^\/patient$/, "/patient");
  await stubRemoteImagesWithStockPhoto(runtime.page, runtime.stockExitPhoto);
  await openGallery(runtime);
  await expect(runtime.page.getByTestId("gallery-grid-skeleton")).toHaveCount(0, { timeout: 30_000 });

  if (await runtime.page.getByText("尚無相片").isVisible()) {
    await openCapturePreview(runtime, false);
    await submitCaptureAndWaitForResult(runtime);
    await openGallery(runtime);
    await expect(runtime.page.getByTestId("gallery-grid-skeleton")).toHaveCount(0, { timeout: 30_000 });
  }

  if (selected.has("gallery")) {
    await expect(runtime.page.getByRole("tab", { name: "九宮格" })).toHaveAttribute("aria-selected", "true");
    await expect(runtime.page.getByTestId("gallery-grid-cell").first()).toBeVisible({ timeout: 20_000 });
    await waitForLoadedImages(runtime, '[data-testid="gallery-grid-cell"] img');
    await runtime.screenshot("shot-gallery.png");
  }

  if (selected.has("gallery-calendar")) {
    const calendarTab = runtime.page.getByRole("tab", { name: "日曆" });
    await calendarTab.click();
    await expect(calendarTab).toHaveAttribute("aria-selected", "true");
    await expect(runtime.page.getByTestId("gallery-calendar-skeleton")).toHaveCount(0, { timeout: 20_000 });
    await expect(runtime.page.getByTestId("gallery-calendar-day").first()).toBeVisible({ timeout: 20_000 });
    await waitForLoadedImages(runtime, '[data-testid="gallery-calendar-day"] img');
    await runtime.screenshot("shot-gallery-calendar.png");
  }
}

export async function capturePatientCaptureFlow(
  runtime: ShotRuntime,
  selected: ReadonlySet<BlogShotId>
): Promise<void> {
  const wantsCapture = selected.has("capture");
  const wantsResult = selected.has("result");
  await runtime.loginAs("U_DEV_PAT_MATCH", /^\/patient$/, "/patient");
  await openCapturePreview(runtime, wantsCapture);
  if (wantsResult) {
    await submitCaptureAndWaitForResult(runtime);
    await runtime.screenshot("shot-result.png");
  }
}

export const INDEPENDENT_SHOT_RUNNERS: Record<
  Exclude<BlogShotId, "capture" | "result" | "gallery" | "gallery-calendar">,
  (runtime: ShotRuntime) => Promise<void>
> = {
  "role-select": captureRoleSelect,
  bind: captureBind,
  pending: capturePending,
  home: captureHome,
  "home-photos": captureHomePhotos,
};
