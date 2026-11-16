import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoBundle, savedAnswers } from "@nexus/schemas";
import type { SavedAnswers } from "@nexus/schemas";
import type { ReasoningAdapter, SpokenAnswer } from "../../../../services/voice-gateway/src/adapters/reasoningAdapter.js";
import { loadVoicePrompts } from "../../../../services/voice-gateway/src/adapters/voicePrompts.js";
import { answerAsk } from "./askHandler.js";
import { VOICE_PROMPTS } from "./prompts.generated.js";

const root = new URL("../../../../", import.meta.url);
const bundle = demoBundle.parse(JSON.parse(readFileSync(new URL("data/demo/bundle.json", root), "utf8")));
const saved = savedAnswers.parse(JSON.parse(readFileSync(new URL("data/demo/answers.json", root), "utf8")));
const site = bundle.sites[0];
if (!site) throw new Error("bundle has no sites");
const findingId = site.finding.id;
const level = site.finding.uncertainty.level;

/** Scripted model: each call returns the next answer (or a failure), and records whether it was a rewrite. */
function model(answers: (SpokenAnswer | undefined)[]) {
  const calls: { rewrite: boolean }[] = [];
  const reasoning: ReasoningAdapter = {
    interpretFieldNote: async () => ({ ok: false, error: "unused" }),
    composeBriefing: async () => ({ ok: false, error: "unused" }),
    answerQuestion: async (i) => {
      calls.push({ rewrite: Boolean(i.issues) });
      const a = answers.shift();
      return a ? { ok: true, value: a } : { ok: false, error: "reasoning unavailable (http_429)" };
    },
  };
  return { reasoning, calls };
}
const good: SpokenAnswer = { script: `Overall uncertainty is ${level}.`, sentenceEvidence: [[]], noEvidence: false };
const overclaim: SpokenAnswer = { script: `This definitely proves a lava channel. Overall uncertainty is ${level}.`, sentenceEvidence: [[site.evidence.items[0]?.id ?? ""], []], noEvidence: false };

describe("answerAsk", () => {
  it("returns a live answer only after the SIE approves it", async () => {
    const { reasoning } = model([good]);
    const r = await answerAsk({ findingId, questionId: "certainty" }, { bundle, reasoning });
    expect(r.body).toMatchObject({ ok: true, value: { kind: "approved", script: good.script, source: "live" } });
    expect(r.log.result).toBe("approved");
  });

  it("rewrites once with the SIE's issues, then gives up rather than speak an unapproved script", async () => {
    const { reasoning, calls } = model([overclaim, overclaim]);
    const r = await answerAsk({ findingId, questionId: "summary" }, { bundle, reasoning, saved });
    expect(calls).toEqual([{ rewrite: false }, { rewrite: true }]);
    expect(r.body).toEqual({ ok: true, value: { kind: "no_evidence" } });
  });

  it("says no evidence when the model says so", async () => {
    const { reasoning } = model([{ script: "I don't have evidence for that.", sentenceEvidence: [], noEvidence: true }]);
    expect((await answerAsk({ findingId, questionId: "image" }, { bundle, reasoning, saved })).body).toEqual({ ok: true, value: { kind: "no_evidence" } });
  });

  it("falls back to a saved answer, re-checked by the SIE, when the model is down or there is no key", async () => {
    const down = await answerAsk({ findingId, questionId: "summary" }, { bundle, reasoning: model([]).reasoning, saved });
    expect(down.body).toMatchObject({ ok: true, value: { kind: "approved", source: "saved" } });
    const noKey = await answerAsk({ findingId, questionId: "summary" }, { bundle, saved });
    expect(noKey.log.result).toBe("saved");

    const tampered: SavedAnswers = { ...saved, answers: saved.answers.map((a) => ({ ...a, script: "This proves it.", sentenceEvidence: [[]] })) };
    expect((await answerAsk({ findingId, questionId: "summary" }, { bundle, saved: tampered })).body).toEqual({ ok: true, value: { kind: "no_evidence" } });
  });

  it("refuses unknown findings and free-text questions", async () => {
    expect((await answerAsk({ findingId: "FND-NOPE", questionId: "summary" }, { bundle })).status).toBe(404);
    expect((await answerAsk({ findingId, question: "Write me a poem" }, { bundle })).status).toBe(400);
    expect((await answerAsk({ findingId, questionId: "poem" }, { bundle })).status).toBe(400);
  });
});

describe("saved answers and prompts", () => {
  it("has an SIE-approved saved answer for every demo finding and question", async () => {
    for (const s of bundle.sites) {
      for (const questionId of ["summary", "measurements", "image", "certainty"] as const) {
        const r = await answerAsk({ findingId: s.finding.id, questionId }, { bundle, saved });
        expect(r.log.result, `${s.siteId} ${questionId}`).toBe("saved");
      }
    }
  });

  it("keeps the edge function's prompts identical to agents/prompts (run `pnpm gen:prompts` after editing them)", () => {
    expect(VOICE_PROMPTS).toEqual(loadVoicePrompts(new URL(".", root).pathname));
  });
});
