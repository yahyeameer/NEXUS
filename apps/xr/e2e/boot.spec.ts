import { expect, test } from "@playwright/test";

test("XR client boots", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("NEXUS");
  await expect(page.getByRole("status")).toBeVisible();
});
