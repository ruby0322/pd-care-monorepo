import { expect, type Page } from "@playwright/test";

export async function openDevPersonasPage(page: Page): Promise<void> {
  await page.goto("/dev/personas");
  await page.waitForURL(/\/dev\/personas(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "本機測試身分" })).toBeVisible();
}

export async function assertDevPersonaVisible(page: Page, personaId: string): Promise<void> {
  await expect(page.getByText(personaId)).toBeVisible();
}
