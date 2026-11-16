import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { ScientificFinding } from "@nexus/schemas";
import { evidence, measurements } from "../../../../packages/sie/fixtures/testSite.js";
import { ClaudeReasoning, claudeFromEnv, loadVoicePrompts } from "./claudeReasoningAdapter.js";
import type { GroundingContext } from "./reasoningAdapter.js";

const prompts = { teamRules: "TEAM", fieldNoteInterpreter: "FN", dialogueGrounding: "QA", briefingComposer: "BRIEF" };

interface Sent {
  model: string;
  system: string;
  messages: { role: string; content: string }[];
  output_config: { effort: string; format: unknown };
}

/** Stand-in for client.messages.parse: records each request and returns the next scripted response. */
function fakeClient(responses: (object | Error)[]) {
  const sent: Sent[] = [];
  const client = {
    messages: {
      parse: async (params: Sent) => {
        sent.push(params);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, ...next };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

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

describe("ClaudeReasoning", () => {
  it("answers from the finding's evidence with the agent prompt, team rules and low effort", async () => {
    const answer = { script: "The image shows a sinuous channel.", sentenceEvidence: [[realId]], speakerAgentId: null, noEvidence: false };
    const { client, sent } = fakeClient([{ parsed_output: answer }]);
    const r = await new ClaudeReasoning({ prompts, client }).answerQuestion({ question: "What does it look like?", context });
    expect(r).toEqual({ ok: true, value: { ...answer, speakerAgentId: undefined } });
    expect(sent[0]?.model).toBe("claude-opus-5-5");
    expect(sent[0]?.system).toContain("TEAM");
    expect(sent[0]?.system).toContain("QA");
    expect(sent[0]?.output_config.effort).toBe("low");
    const user = sent[0]?.messages[0]?.content ?? "";
    expect(user).toContain(`"id":"${realId}"`);
    expect(user).toContain("<question>What does it look like?</question>");
  });

  it("refuses an answer that cites an evidence id outside the finding's evidence", async () => {
    const invented = { script: "The image shows it.", sentenceEvidence: [["EV-FAKE-999"]], speakerAgentId: null, noEvidence: false };
    const { client } = fakeClient([{ parsed_output: invented }]);
    const r = await new ClaudeReasoning({ prompts, client }).answerQuestion({ question: "q", context });
    expect(r).toEqual({ ok: false, error: "cited unknown evidence id EV-FAKE-999" });
  });

  it("passes the validator's issues on the rewrite", async () => {
    const { client, sent } = fakeClient([{ parsed_output: { script: "x", sentenceEvidence: [], speakerAgentId: null, noEvidence: true } }]);
    await new ClaudeReasoning({ prompts, client }).answerQuestion({ question: "q", context, issues: [{ validator: "V5", message: "too certain" }] });
    expect(sent[0]?.messages[0]?.content).toContain("V5: too certain");
  });

  it("uses the fast model for field notes", async () => {
    const { client, sent } = fakeClient([{ parsed_output: { descriptors: ["angular"], intentHint: null } }]);
    const r = await new ClaudeReasoning({ prompts, client, fastModel: "claude-haiku-5-5" }).interpretFieldNote({ transcript: "Angular blocks", language: "en" });
    expect(r).toEqual({ ok: true, value: { descriptors: ["angular"], intentHint: null } });
    expect(sent[0]?.model).toBe("claude-haiku-5-5");
    expect(sent[0]?.system).toContain("FN");
  });

  it("returns typed errors for refusals, unparsed output and API failures, without provider text", async () => {
    const reasoning = (r: object | Error) => new ClaudeReasoning({ prompts, client: fakeClient([r]).client });
    expect(await reasoning({ stop_reason: "refusal", parsed_output: null }).interpretFieldNote({ transcript: "t", language: "en" })).toEqual({
      ok: false,
      error: "model declined",
    });
    expect(await reasoning({ parsed_output: null }).interpretFieldNote({ transcript: "t", language: "en" })).toEqual({
      ok: false,
      error: "model output did not match the schema",
    });
    const offline = new Anthropic.APIConnectionError({ message: "secret detail" });
    const r = await reasoning(offline).answerQuestion({ question: "q", context });
    expect(r).toEqual({ ok: false, error: "reasoning unavailable (unreachable)" });
  });

  it("logs timing and tokens, never the transcript", async () => {
    const entries: object[] = [];
    const { client } = fakeClient([{ parsed_output: { descriptors: [], intentHint: null } }]);
    await new ClaudeReasoning({ prompts, client, log: (e) => entries.push(e) }).interpretFieldNote({ transcript: "private words", language: "en" });
    expect(entries).toMatchObject([{ agent: "51_field_note_interpreter", ok: true, inputTokens: 10, outputTokens: 5 }]);
    expect(JSON.stringify(entries)).not.toContain("private words");
  });

  it("loads the canonical prompts and is off without a key", () => {
    const root = new URL("../../../../", import.meta.url).pathname;
    expect(loadVoicePrompts(root).dialogueGrounding).toContain("Dialogue Grounding Agent");
    expect(claudeFromEnv({}, root)).toBeUndefined();
    expect(claudeFromEnv({ MUSE_API_KEY: "k" }, root)).toBeInstanceOf(ClaudeReasoning);
  });
});
