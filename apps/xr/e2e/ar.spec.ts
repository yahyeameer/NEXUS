// The AR flow in the emulator (brief, phase 1): launch screen → immersive-ar session → surface search → reticle →
// pinch to place NASA's Moon → open the surveyed region → back to the globe → reposition. IWER has no room to
// hit-test, so ?surface=emulated stands a flat test plane in for the table; everything else is the real path.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { pair, palmUp, pinchAt, poke, remote, state } from "./emulator.js";

type AimWindow = Window & { __nexus?: { aim: (name: string) => Promise<boolean>; targets: () => string[] } };

async function aimAtSurface(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as AimWindow).__nexus?.targets() ?? [])).toContain("surface/table");
  expect(await page.evaluate(() => (window as unknown as AimWindow).__nexus?.aim("surface/table"))).toBe(true);
}

test("place the Moon on a surface, open the region, return to the globe and reposition, with hands only", async ({ page }) => {
  await page.goto("/?devui=0&surface=emulated");
  await expect(page.getByText("SPATIAL INTELLIGENCE FOR SCIENTIFIC DISCOVERY", { exact: false })).toBeVisible();
  await expect(page.locator("#enter-ar")).toBeEnabled();
  await page.locator("#enter-ar").click();

  // Searching: nothing is placed and no panel is interactive until a surface is found and tapped.
  await expect.poll(async () => (await state(page)).ar).toMatchObject({ mode: "ar", phase: "placing", surface: "emulated-plane" });
  await aimAtSurface(page);
  await expect.poll(async () => (await state(page)).ar.surfaceFound).toBe(true);
  await remote(page, "select", { device: "hand-right" });
  await expect.poll(async () => (await state(page)).ar).toMatchObject({ phase: "placed", anchor: "fixed", environment: "globe", regionMarked: true });

  await pair(page);
  await poke(page, "main/onboard:start");
  await expect.poll(async () => (await state(page)).screen).toBe("globe");

  // The region marker on NASA's globe opens the terrain of the surveyed sites on the same anchor.
  await pinchAt(page, "globe/region");
  await expect.poll(async () => (await state(page)).ar.environment).toBe("region");
  await expect.poll(async () => (await state(page)).screen).toBe("idle");
  expect((await state(page)).siteId).toBe("HADLEY_RILLE");

  await palmUp(page);
  await poke(page, "wrist/env:globe");
  await expect.poll(async () => (await state(page)).ar.environment).toBe("globe");

  // Move: search again and place somewhere else; the session stays AR throughout.
  await palmUp(page);
  await poke(page, "wrist/ar:reposition");
  await expect.poll(async () => (await state(page)).ar.phase).toBe("placing");
  await aimAtSurface(page);
  await expect.poll(async () => (await state(page)).ar.surfaceFound).toBe(true);
  await remote(page, "select", { device: "hand-right" });
  await expect.poll(async () => (await state(page)).ar).toMatchObject({ phase: "placed", mode: "ar" });
});
