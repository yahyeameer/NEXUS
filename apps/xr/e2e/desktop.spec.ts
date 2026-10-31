// The mouse-and-keyboard path of the emulator (no devui parameter): the mouse is the right hand, a click is a pinch.
// It drives real pointer and key events, so a pass means someone with no headset and no hand gestures can use the app.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { state } from "./emulator.js";

type ScreenWindow = Window & { __nexus?: { screenPoint: (name: string) => { x: number; y: number } | undefined; targets: () => string[] } };

async function screenPoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  await expect.poll(() => page.evaluate((n) => (window as unknown as ScreenWindow).__nexus?.screenPoint(n) !== undefined, name)).toBe(true);
  const p = await page.evaluate((n) => (window as unknown as ScreenWindow).__nexus?.screenPoint(n), name);
  if (!p) throw new Error(`no screen point for ${name}`);
  return p;
}

test("pair, pick a feature, turn and zoom the terrain with mouse and keyboard only", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as unknown as ScreenWindow).__nexus?.targets().length ?? 0)).toBeGreaterThan(0);

  for (const digit of ["1", "2", "3", "4"]) await page.keyboard.press(digit);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state(page)).screen).toBe("welcome");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state(page)).screen).toBe("idle");

  // Hover then click the glowing ring: the mouse ray picks it exactly as a pinch would.
  const ring = await screenPoint(page, "feature/HADLEY_RILLE");
  await page.mouse.move(ring.x, ring.y);
  await page.waitForTimeout(800);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).selectedFeatureId).toBe("HADLEY_RILLE");

  // Drag across the terrain to turn it, wheel to zoom.
  const before = await state(page);
  // Across the ring, which is terrain whatever the window size; the docked menus sit at the edges.
  await page.mouse.move(ring.x - 60, ring.y + 15);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(ring.x + 80, ring.y + 15, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await state(page)).view.yaw - before.view.yaw)).toBeGreaterThan(0.1);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await state(page)).view.scale).toBeGreaterThan(1.2);

  // Keys press the same buttons a hand would.
  await page.keyboard.press("r");
  await expect.poll(async () => (await state(page)).view.scale).toBe(1);

  // Investigate, then open evidence from the card's lowest row: the click must land on the panel drawn over the
  // terrain, not on the diorama corner behind it.
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await state(page)).findings.HADLEY_RILLE?.status, { timeout: 60_000 }).toBe("ready_for_review");
  await click(page, "main/card:evidence");
  await expect.poll(async () => (await state(page)).screen).toBe("evidence");
  const chip = await page.evaluate(() => (window as unknown as ScreenWindow).__nexus?.targets().find((t) => t.startsWith("main/ev:")));
  if (!chip) throw new Error("no evidence chip");
  await click(page, chip);
  await expect.poll(async () => (await state(page)).evidenceOpen).toBe(chip.slice("main/ev:".length));
});

async function click(page: Page, name: string): Promise<void> {
  const p = await screenPoint(page, name);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
}
