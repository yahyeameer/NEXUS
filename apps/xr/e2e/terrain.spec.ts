// INTERACTION.md parity table: rotate (pinch + drag), zoom, reset, all by hand.
import { expect, test } from "@playwright/test";
import { enterXr, pair, palmUp, pinchDrag, poke, state } from "./emulator.js";

test("turn and zoom the terrain by hand, and reset it", async ({ page }) => {
  await enterXr(page);
  await pair(page);
  await poke(page, "main/onboard:skip");

  await palmUp(page);
  await poke(page, "wrist/view:zoom_in");
  await expect.poll(async () => (await state(page)).view.scale).toBeCloseTo(1.25, 5);
  await poke(page, "wrist/view:rotate_left");
  await expect.poll(async () => (await state(page)).view.yaw).toBeCloseTo(Math.PI / 12, 5);
  await poke(page, "wrist/view:reset");
  await expect.poll(async () => (await state(page)).view).toEqual({ yaw: 0, scale: 1 });

  // A pinch that drags turns the diorama and does not select the feature under the ray.
  await pinchDrag(page, "feature/HADLEY_RILLE", 0.15);
  await expect.poll(async () => Math.abs((await state(page)).view.yaw)).toBeGreaterThan(0.05);
  expect((await state(page)).selectedFeatureId).toBeUndefined();
});
