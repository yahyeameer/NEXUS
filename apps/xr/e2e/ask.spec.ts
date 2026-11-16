// Asking about a finding in the standalone build (functions/api/ask.ts): hands only, poke Ask, poke a question,
// and the answer that comes back has been approved by the SIE and is captioned. Runs with playwright.edge.config.ts.
import { expect, test } from "@playwright/test";
import { pinchAt, poke, state } from "./emulator.js";

test("standalone: ask about a finding and hear an SIE-approved answer", async ({ page }) => {
  await page.goto("/?devui=0&site=ELBOW_CRATER&offline=1");
  await page.locator("#enter-3d").click();
  await expect.poll(async () => (await state(page)).screen).toBe("welcome");
  await poke(page, "main/onboard:skip");
  await pinchAt(page, "feature/ELBOW_CRATER");
  await poke(page, "main/sel:investigate");
  await expect.poll(async () => (await state(page)).screen, { timeout: 60_000 }).toBe("finding");

  await poke(page, "main/card:ask");
  await expect.poll(async () => (await state(page)).screen).toBe("ask");
  await poke(page, "main/ask:measurements");
  // The approved answer is captioned; only SIE-approved scripts or fixed phrases can be.
  await expect.poll(async () => (await state(page)).captions.join(" "), { timeout: 60_000 }).toMatch(/gives about .* Overall uncertainty is medium\.|I don't have evidence for that/);
  const captions = (await state(page)).captions.join(" ");
  expect(captions).toMatch(/gives about/);
});
