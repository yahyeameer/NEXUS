// `pnpm demo:answers`: asks Gemini each fixed question for each demo finding, keeps only answers the SIE approves,
// and writes data/demo/answers.json. The Cloudflare function serves these when the live call fails, after checking
// them with the SIE again (AGENTS.md §6 demo safety). Needs GEMINI_API_KEY in the environment; never writes it.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ASK_QUESTIONS, askQuestionId, demoBundle, savedAnswers } from "@nexus/schemas";
import type { SavedAnswers } from "@nexus/schemas";
import { liveAnswer } from "../../../apps/xr/src/edge/askHandler.js";
import { GeminiReasoning } from "./adapters/geminiReasoningAdapter.js";
import { GEMINI_DEFAULT_MODEL } from "./adapters/geminiReasoningAdapter.js";
import { loadVoicePrompts } from "./adapters/voicePrompts.js";

const root = resolve(import.meta.dirname, "../../..");
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
const reasoning = new GeminiReasoning({ prompts: loadVoicePrompts(root), apiKey, model, timeoutMs: 15000 });
const bundle = demoBundle.parse(JSON.parse(readFileSync(resolve(root, "data/demo/bundle.json"), "utf8")));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const answers: SavedAnswers["answers"] = [];
for (const site of bundle.sites) {
  for (const questionId of askQuestionId.options) {
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const r = await liveAnswer(site, questionId, reasoning);
      if (r.result === "approved" && r.answer.kind === "approved") {
        answers.push({ findingId: site.finding.id, questionId, script: r.answer.script, sentenceEvidence: r.answer.sentenceEvidence, model });
        saved = true;
      } else if (r.result === "model_unavailable") await pause(2000);
      else break;
    }
    console.log(`${site.siteId} ${questionId}: ${saved ? "saved" : "no approved answer"}`);
  }
}

const out = savedAnswers.parse({
  kind: "nexus-saved-answers",
  note: `Answers to the fixed questions (${Object.values(ASK_QUESTIONS).length}) written by ${model} from each demo finding's evidence and approved by the SIE voice validator. Served only when the live model is unavailable, and re-checked by the SIE then.`,
  answers,
});
writeFileSync(resolve(root, "data/demo/answers.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${answers.length} answers`);
