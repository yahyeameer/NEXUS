// The judging fallback (AGENTS.md §6 "Demo safety"): with no pairing and no services, the offline demo still runs a
// whole investigation by hand, ending in the SIE-checked precomputed finding, labelled as precomputed, and a review.
import { expect, test } from "@playwright/test";
import { pinchAt, poke, state } from "./emulator.js";

test("offline demo: investigate and review a site with no pairing and no services", async ({ page }) => {
  await page.goto("/?devui=0&site=ELBOW_CRATER&offline=1");
  await page.locator("#enter-3d").click();
  // No pairing screen: the offline demo opens straight on the welcome card.
  await expect.poll(async () => (await state(page)).screen).toBe("welcome");
  expect((await state(page)).offline).toBe(true);
  await poke(page, "main/onboard:skip");
  await expect.poll(async () => (await state(page)).screen).toBe("idle");

  await pinchAt(page, "feature/ELBOW_CRATER");
  await expect.poll(async () => (await state(page)).selectedFeatureId).toBe("ELBOW_CRATER");
  await poke(page, "main/sel:investigate");
  await expect.poll(async () => (await state(page)).findings.ELBOW_CRATER?.status, { timeout: 60_000 }).toBe("ready_for_review");
  await expect.poll(async () => (await state(page)).screen).toBe("finding");

  await poke(page, "main/card:inconclusive");
  await expect.poll(async () => (await state(page)).screen).toBe("reason");
  await poke(page, "main/reason:3");
  await expect.poll(async () => (await state(page)).findings.ELBOW_CRATER?.status).toBe("inconclusive");
});
