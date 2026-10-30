// AGENTS.md rule 1: the whole loop is completable with hands alone. No voice, no keyboard, no mouse inside XR.
import { expect, test } from "@playwright/test";
import { enterXr, pair, palmUp, pinchAt, poke, state } from "./emulator.js";

test("pair, select, investigate, review and read the logbook with hands only", async ({ page }) => {
  await enterXr(page);
  await expect(page.getByRole("status")).toContainText("Emulator");
  await pair(page);
  await poke(page, "main/onboard:start");
  await expect.poll(async () => (await state(page)).screen).toBe("idle");

  // Ray + pinch on the rille's ring selects it; Investigate sends it to the (precomputed) research team.
  await pinchAt(page, "feature/HADLEY_RILLE");
  await expect.poll(async () => (await state(page)).selectedFeatureId).toBe("HADLEY_RILLE");
  await poke(page, "main/sel:investigate");

  // The finding arrives only after the SIE accepted it for review, and its approved briefing is captioned.
  await expect.poll(async () => (await state(page)).findings.HADLEY_RILLE?.status, { timeout: 60_000 }).toBe("ready_for_review");
  expect((await state(page)).screen).toBe("finding");
  await expect.poll(async () => (await state(page)).captions.join(" ")).toContain("The LROC terrain model gives about 308 metres");

  // Reject with a reason chip: the chip text is stored verbatim as the rationale.
  await poke(page, "main/card:reject");
  await poke(page, "main/reason:0");
  await expect.poll(async () => (await state(page)).findings.HADLEY_RILLE?.status).toBe("rejected");

  // Wrist menu: next site, investigate and approve there, then the logbook lists both reviews.
  await palmUp(page);
  await poke(page, "wrist/site:ELBOW_CRATER");
  await expect.poll(async () => (await state(page)).siteId).toBe("ELBOW_CRATER");
  await pinchAt(page, "feature/ELBOW_CRATER");
  await poke(page, "main/sel:investigate");
  await expect.poll(async () => (await state(page)).findings.ELBOW_CRATER?.status, { timeout: 60_000 }).toBe("ready_for_review");
  await poke(page, "main/card:approve");
  await expect.poll(async () => (await state(page)).findings.ELBOW_CRATER?.status).toBe("reviewed");

  await palmUp(page);
  await poke(page, "wrist/wrist:logbook");
  await expect.poll(async () => (await state(page)).screen).toBe("logbook");
});
