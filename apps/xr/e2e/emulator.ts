// Drives IWER's emulated Quest 3 hands through the page's test hooks (src/main.ts). The hooks only expose the
// emulator's own remote control and the app's state: tests press buttons with a fingertip and select with a pinch,
// exactly as a scientist would, never by calling app handlers.
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export interface XrState {
  screen: string;
  siteId?: string;
  selectedFeatureId?: string;
  paired: boolean;
  pttActive: boolean;
  micOpen: boolean;
  voiceConnected: boolean;
  findings: Record<string, { id: string; status: string }>;
  captions: string[];
  lastCommand?: string;
}

interface Hooks {
  state: () => XrState;
  targets: () => string[];
  remote: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  aim: (name: string, hand?: "left" | "right") => Promise<boolean>;
}
type HookWindow = Window & { __nexus: Hooks };

export async function enterXr(page: Page): Promise<void> {
  await page.goto("/?devui=0");
  await expect(page.locator("#enter")).toBeEnabled();
  await page.locator("#enter").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HookWindow).__nexus.targets().length)).toBeGreaterThan(0);
}

export function state(page: Page): Promise<XrState> {
  return page.evaluate(() => (window as unknown as HookWindow).__nexus.state());
}

async function remote(page: Page, method: string, params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(([m, p]) => (window as unknown as HookWindow).__nexus.remote(m, p), [method, params] as const);
}

async function waitForTarget(page: Page, name: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as HookWindow).__nexus.targets()), { message: `target ${name}` }).toContain(name);
}

/** Right index fingertip presses a panel button and lifts off. */
export async function poke(page: Page, target: string): Promise<void> {
  await waitForTarget(page, target);
  const r = (await remote(page, "run_sequence", { device: "hand-right", idleHand: "keep", steps: [{ target, press: {} }] })) as { completed?: boolean };
  expect(r.completed, `poke ${target}`).toBe(true);
}

/** Press and hold (push-to-talk). `during` runs while the finger is down. */
export async function pokeAndHold(page: Page, target: string, seconds: number, during: () => Promise<void>): Promise<void> {
  await waitForTarget(page, target);
  const sequence = remote(page, "run_sequence", {
    device: "hand-right",
    idleHand: "keep",
    steps: [
      { target, anchor: "index-tip", approach: { distance: 0.04 }, offset: { normal: -0.004 } },
      { duration: seconds },
      { offset: { normal: 0.06 }, duration: 0.3 },
    ],
  });
  await during();
  const r = (await sequence) as { completed?: boolean };
  expect(r.completed, `hold ${target}`).toBe(true);
}

/** Point the right hand's ray at a target and pinch. */
export async function pinchAt(page: Page, target: string): Promise<void> {
  await waitForTarget(page, target);
  expect(await page.evaluate((n) => (window as unknown as HookWindow).__nexus.aim(n), target)).toBe(true);
  await remote(page, "select", { device: "hand-right" });
}

/** Left palm up in front of the body opens the wrist menu (INTERACTION.md §2). */
export async function palmUp(page: Page): Promise<void> {
  await remote(page, "set_transform", { device: "hand-left", position: { x: -0.16, y: 0.98, z: -0.32 }, orientation: { fingers: "forward", palm: "up" } });
  await waitForTarget(page, "wrist/wrist:ptt");
}

export async function pair(page: Page, code = "1234"): Promise<void> {
  for (const d of code) await poke(page, `main/pair:${d}`);
  await poke(page, "main/pair:go");
  await expect.poll(async () => (await state(page)).screen).toBe("welcome");
}
