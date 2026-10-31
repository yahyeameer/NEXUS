// Phase 3 tools with hands only: measure between two terrain points, mark and save a spot observation in the
// scientist's words, and focus on a selected feature.
import { expect, test } from "@playwright/test";
import { enterXr, pair, palmUp, pinchAt, poke, state } from "./emulator.js";

test("measure, mark a spot and focus on a feature with hands only", async ({ page }) => {
  await enterXr(page);
  await pair(page);
  await poke(page, "main/onboard:start");
  await expect.poll(async () => (await state(page)).screen).toBe("idle");

  // Ruler: two pinches on open ground; every number comes from the DEM.
  await poke(page, "main/tool:measure");
  await expect.poll(async () => (await state(page)).screen).toBe("measure");
  await pinchAt(page, "terrain/nw");
  await expect.poll(async () => (await state(page)).tools.measure).toBe("second");
  await pinchAt(page, "terrain/se");
  await expect.poll(async () => (await state(page)).tools.measure).toBe("done");
  const m = (await state(page)).tools.measurement;
  // 30 % → 70 % of a 2.8 km tile on both axes: about 1.58 km apart on the ground.
  expect(m?.horizontalM).toBeGreaterThan(1400);
  expect(m?.horizontalM).toBeLessThan(1800);
  await poke(page, "main/tool:done");

  // Mark a spot and save it with a chip; it is stored, not sent for research.
  await poke(page, "main/tool:mark");
  await pinchAt(page, "terrain/ne");
  await expect.poll(async () => (await state(page)).tools.markPending).toBe(true);
  await poke(page, "main/desc:Boulder");
  await poke(page, "main/tool:save_mark");
  await expect.poll(async () => (await state(page)).tools.savedObservations.length).toBe(1);
  expect((await state(page)).orbs).toBe(0);
  await poke(page, "main/tool:done");

  // Focus: the selected feature glides to the middle and is magnified; Reset returns to the whole site.
  await pinchAt(page, "feature/HADLEY_RILLE");
  await expect.poll(async () => (await state(page)).selectedFeatureId).toBe("HADLEY_RILLE");
  await palmUp(page);
  await poke(page, "wrist/view:focus");
  await expect.poll(async () => (await state(page)).tools.focus).toBe("HADLEY_RILLE");
  await expect.poll(async () => (await state(page)).view.scale).toBeGreaterThan(2);
  await poke(page, "wrist/view:reset");
  await expect.poll(async () => (await state(page)).view.scale).toBe(1);
});
