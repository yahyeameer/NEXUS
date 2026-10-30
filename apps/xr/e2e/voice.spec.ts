// Voice is an optional shortcut (AGENTS.md rule 1, 9): push-to-talk from the wrist menu, mic open only while held.
// The desktop's fake mic streams real PCM; the words come from the emulator's simulated-speech box (docs/TESTING.md).
import { expect, test } from "@playwright/test";
import { enterXr, pair, palmUp, poke, pokeAndHold, state } from "./emulator.js";

test("hold to talk: the mic opens only while held and a spoken command runs", async ({ page }) => {
  await enterXr(page);
  await pair(page);
  await poke(page, "main/onboard:skip");
  await expect.poll(async () => (await state(page)).voiceConnected).toBe(true);
  expect((await state(page)).micOpen).toBe(false);

  await palmUp(page);
  await pokeAndHold(page, "wrist/wrist:ptt", 2.5, async () => {
    await expect.poll(async () => (await state(page)).micOpen).toBe(true);
    await page.getByLabel(/Simulated speech/).fill("next site");
  });

  await expect.poll(async () => (await state(page)).siteId).toBe("ELBOW_CRATER");
  const s = await state(page);
  expect(s).toMatchObject({ pttActive: false, micOpen: false, lastCommand: "next_site" });
  expect(s.captions).toContain("You: next site");
});
