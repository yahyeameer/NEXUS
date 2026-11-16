import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import type { ScientificFinding } from "@nexus/schemas";
import { evidence, measurements } from "../../../../packages/sie/fixtures/testSite.js";
import { GeminiReasoning, geminiFromEnv, loadVoicePrompts } from "./geminiReasoningAdapter.js";
import type { GeminiModels } from "./geminiReasoningAdapter.js";
import type { GroundingContext } from "./reasoningAdapter.js";

const prompts = { teamRules: "TEAM", fieldNoteInterpreter: "FN", dialogueGrounding: "QA", briefingComposer: "BRIEF" };

interface Sent {
  model: string;
  contents: string;
  config: { systemInstruction: string; responseMimeType: string; responseJsonSchema: unknown; thinkingConfig: { thinkingLevel: string } };
}

/** Stand-in for client.models.generateContent: records each request and returns the next scripted response. */
function fakeModels(responses: (object | Error)[]) {
  const sent: Sent[] = [];
  const models = {
    generateContent: async (params: Sent) => {
      sent.push(params);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, ...next };
    },
  } as unknown as GeminiModels;
  return { models, sent };
}
const json = (v: unknown) => ({ text: JSON.stringify(v) });

const first = evidence[0];
if (!first) throw new Error("test site has no evidence");
const realId = first.id;
const finding = {
  id: "FND-1",
  observationId: "OBS-1",
  title: "Test rille",
  summary: "A sinuous channel.",
  claimType: "observation",
  claims: [{ text: "The image shows a sinuous channel.", claimType: "observation", evidenceIds: [realId] }],
  possibleInterpretations: [],
  uncertainty: { level: "medium", explanation: "One image." },
  contested: false,
} as unknown as ScientificFinding;
const context: GroundingContext = { finding, evidence, measurements, fieldNotes: [] };

describe("GeminiReasoning", () => {
  it("answers from the finding's evidence with the agent prompt, team rules and a JSON schema", async () => {
    const answer = { script: "The image shows a sinuous channel.", sentenceEvidence: [[realId]], noEvidence: false };
    const { models, sent } = fakeModels([json(answer)]);
    const r = await new GeminiReasoning({ prompts, models, model: "gemini-3.8-flash" }).answerQuestion({ question: "What does it look like?", context });
    expect(r).toEqual({ ok: true, value: answer });
    expect(sent[0]?.model).toBe("gemini-3.8-flash");
    expect(sent[0]?.config.systemInstruction).toContain("TEAM");
    expect(sent[0]?.config.systemInstruction).toContain("QA");
    expect(sent[0]?.config.responseMimeType).toBe("application/json");
    expect(sent[0]?.config.thinkingConfig.thinkingLevel).toBe("LOW");
    expect(sent[0]?.contents).toContain(`"id":"${realId}"`);
    expect(sent[0]?.contents).toContain("<question>What does it look like?</question>");
  });

  it("refuses an answer that cites an evidence id outside the finding's evidence", async () => {
    const { models } = fakeModels([json({ script: "The image shows it.", sentenceEvidence: [["EV-FAKE-999"]], noEvidence: false })]);
    const r = await new GeminiReasoning({ prompts, models }).answerQuestion({ question: "q", context });
    expect(r).toEqual({ ok: false, error: "cited unknown evidence id EV-FAKE-999" });
  });

  it("passes the validator's issues on the rewrite", async () => {
    const { models, sent } = fakeModels([json({ script: "x", sentenceEvidence: [], noEvidence: true })]);
    await new GeminiReasoning({ prompts, models }).answerQuestion({ question: "q", context, issues: [{ validator: "V5", message: "too certain" }] });
    expect(sent[0]?.contents).toContain("V5: too certain");
  });

  it("uses the fast model at minimal thinking for field notes", async () => {
    const { models, sent } = fakeModels([json({ descriptors: ["angular"] })]);
    const r = await new GeminiReasoning({ prompts, models, model: "gemini-3.8-flash" }).interpretFieldNote({ transcript: "Angular blocks", language: "en" });
    expect(r).toEqual({ ok: true, value: { descriptors: ["angular"], intentHint: null } });
    expect(sent[0]?.model).toBe("gemini-3.5-flash-lite");
    expect(sent[0]?.config.thinkingConfig.thinkingLevel).toBe("MINIMAL");
    expect(sent[0]?.config.systemInstruction).toContain("FN");
  });

  it("returns typed errors for blocks, cut-offs, bad JSON and API failures, without provider text", async () => {
    const reasoning = (r: object | Error) => new GeminiReasoning({ prompts, models: fakeModels([r]).models });
    const note = { transcript: "t", language: "en" };
    expect(await reasoning({ promptFeedback: { blockReason: "SAFETY" } }).interpretFieldNote(note)).toEqual({ ok: false, error: "model declined" });
    expect(await reasoning({ candidates: [{ finishReason: "MAX_TOKENS" }] }).interpretFieldNote(note)).toEqual({ ok: false, error: "model output was cut off" });
    expect(await reasoning({ text: "not json" }).interpretFieldNote(note)).toEqual({ ok: false, error: "model output did not match the schema" });
    const r = await reasoning(new ApiError({ message: "secret detail", status: 429 })).answerQuestion({ question: "q", context });
    expect(r).toEqual({ ok: false, error: "reasoning unavailable (http_429)" });
  });

  it("logs timing and tokens, never the transcript", async () => {
    const entries: object[] = [];
    const { models } = fakeModels([json({ descriptors: [] })]);
    await new GeminiReasoning({ prompts, models, log: (e) => entries.push(e) }).interpretFieldNote({ transcript: "private words", language: "en" });
    expect(entries).toMatchObject([{ agent: "51_field_note_interpreter", ok: true, inputTokens: 10, outputTokens: 5 }]);
    expect(JSON.stringify(entries)).not.toContain("private words");
  });

  it("loads the canonical prompts and is off without a key", () => {
    const root = new URL("../../../../", import.meta.url).pathname;
    expect(loadVoicePrompts(root).dialogueGrounding).toContain("Dialogue Grounding Agent");
    expect(geminiFromEnv({}, root)).toBeUndefined();
    expect(geminiFromEnv({ GEMINI_API_KEY: "k" }, root)).toBeInstanceOf(GeminiReasoning);
  });
});
