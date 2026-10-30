// Runs only when TEST_DATABASE_URL points at a disposable Postgres (CI without a database skips it).
import { describe, expect, it } from "vitest";
import type { ScientificFinding } from "@nexus/schemas";
import { PgStore } from "./pgStore.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore", () => {
  it("round-trips, reviews once, and keeps audit rows append-only", async () => {
    const store = await PgStore.connect(url ?? "");
    const suffix = Date.now().toString(36);
    const obs = {
      id: `OBS-${suffix}`,
      siteId: "TEST_SITE",
      source: "hand_select" as const,
      spatialAnchor: { terrainFeatureId: "TEST_RILLE" },
      createdBy: "u",
      createdAt: "2026-10-30T12:00:00.000Z",
    };
    await store.createObservation(obs);
    expect(await store.getObservation(obs.id)).toEqual(obs);

    const finding: ScientificFinding = {
      id: `FND-${suffix}`,
      observationId: obs.id,
      title: "t",
      summary: "",
      claimType: "observation",
      claims: [],
      removedClaims: [],
      possibleInterpretations: [],
      sources: [],
      spatialAnchor: { terrainFeatureId: "TEST_RILLE" },
      uncertainty: { level: "low", explanation: "x" },
      contested: false,
      decision: { outcome: "ACCEPT_FOR_REVIEW", reason: "r", source: "fallback" },
      status: "ready_for_review",
      createdAt: "2026-10-30T12:00:00.000Z",
      updatedAt: "2026-10-30T12:00:00.000Z",
    };
    await store.saveFinding(finding);
    const review = { findingId: finding.id, decision: "approved" as const, reviewerId: "u", sessionId: `S-${suffix}`, reviewedAt: "2026-10-30T12:01:00.000Z" };
    // Two concurrent reviews: exactly one wins.
    const [a, b] = await Promise.all([store.applyReview(review), store.applyReview({ ...review, decision: "rejected" })]);
    expect([a, b].filter((x) => x !== undefined)).toHaveLength(1);
    expect(await store.listReviews(review.sessionId)).toHaveLength(1);

    const decision = {
      id: `SIE-${suffix}`,
      kind: "finding" as const,
      inputHash: "0".repeat(64),
      subjectId: obs.id,
      validatorResults: [],
      outcome: "ACCEPT_FOR_REVIEW" as const,
      reason: "r",
      source: "fallback" as const,
      jevRequestIds: [],
      decidedAt: "2026-10-30T12:00:00.000Z",
    };
    await store.appendSieDecision(decision);
    await expect(store.appendSieDecision(decision)).rejects.toThrow();
    // The trigger refuses edits to audit rows.
    const pool = (store as unknown as { pool: { query: (s: string) => Promise<unknown> } }).pool;
    await expect(pool.query(`UPDATE sie_decisions SET subject_id = 'x' WHERE id = 'SIE-${suffix}'`)).rejects.toThrow(/append-only/);
    await store.close();
  });
});
