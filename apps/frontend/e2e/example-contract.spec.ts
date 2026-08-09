import { expect, test } from "@playwright/test";

import { assertDevPersonaVisible, openDevPersonasPage } from "./support/dev-persona";

test("development personas page is reachable and includes seeded patient persona", async ({ page }) => {
  await openDevPersonasPage(page);
  await assertDevPersonaVisible(page, "U_DEV_PAT_MATCH");
  await expect(page.getByRole("button", { name: "以此身分進入" }).first()).toBeVisible();
});
