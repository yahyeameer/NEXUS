// Grounded Q&A for the standalone build, run by the Cloudflare Pages Function in apps/xr/functions/api/ask.ts.
// Never imported by the headset client: it is server code (AGENTS.md rule 6).
//
// The finding, its evidence and its measurements come from the same precomputed bundle the headset shows, loaded on
// the server, so the client cannot hand the model a different finding. The model drafts an answer, the SIE voice
// validator checks it with one automatic rewrite (VOICE.md §5), and only an approved script goes back. If the model
// is down or rate-limited, a stored answer for the same question is used, and it must pass the same SIE check now
// (AGENTS.md §6 demo safety). Anything else becomes the fixed "no evidence" phrase on the headset.
import { ASK_QUESTIONS, askRequest } from "@nexus/schemas";
import type { AskAnswer, AskQuestionId, DemoBundle, DemoSite, Result, SavedAnswers } from "@nexus/schemas";
import { createContext, evaluateScript } from "@nexus/sie";
import type { ReasoningAdapter, SpokenAnswer } from "../../../../services/voice-gateway/src/adapters/reasoningAdapter.js";

export interface AskOutcome {
  status: number;
  body: { ok: true; value: AskAnswer } | { ok: false; error: string };
  /** For the structured log: ids and decisions only, never question text or keys (AGENTS.md §7). */
  log: { findingId?: string; questionId?: string; result: string; sieDecisionId?: string };
}

export interface AskDeps {
  bundle: DemoBundle;
  /** Undefined when the deployment has no model key: only saved answers are served. */
  reasoning?: ReasoningAdapter;
  saved?: SavedAnswers;
  now?: string;
}

const NO_EVIDENCE: AskAnswer = { kind: "no_evidence" };

export async function answerAsk(body: unknown, deps: AskDeps): Promise<AskOutcome> {
  const req = askRequest.safeParse(body);
  if (!req.success) return { status: 400, body: { ok: false, error: "invalid request" }, log: { result: "invalid" } };
  const { findingId, questionId } = req.data;
  const site = deps.bundle.sites.find((s) => s.finding.id === findingId);
  if (!site) return { status: 404, body: { ok: false, error: "finding not found" }, log: { findingId, questionId, result: "not_found" } };
  const done = (result: string, value: AskAnswer = NO_EVIDENCE): AskOutcome => ({
    status: 200,
    body: { ok: true, value },
    log: { findingId, questionId, result, sieDecisionId: value.kind === "approved" ? value.sieDecisionId : undefined },
  });

  const live = deps.reasoning ? await liveAnswer(site, questionId, deps.reasoning, deps.now) : { result: "no_model" as const };
  if (live.result === "approved" || live.result === "no_evidence" || live.result === "sie_silenced") return done(live.result, live.answer);

  // The model could not be reached: fall back to the stored answer, which must still pass the SIE today.
  const stored = deps.saved?.answers.find((a) => a.findingId === findingId && a.questionId === questionId);
  if (!stored) return done(`${live.result}_no_saved`);
  const v = check(site, questionId, stored, false, deps.now);
  if (v.decision !== "SPEAK_AS_APPROVED") return done("saved_rejected");
  return done("saved", { kind: "approved", script: stored.script, sentenceEvidence: stored.sentenceEvidence, sieDecisionId: v.audit.id, speechRate: v.speechRate, source: "saved" });
}

type Live =
  | { result: "approved"; answer: AskAnswer }
  | { result: "no_evidence" | "sie_silenced"; answer?: undefined }
  | { result: "model_unavailable" | "no_model"; answer?: undefined };

/** One live attempt plus the one automatic rewrite (VOICE.md §5). Exported for the saved-answer generator. */
export async function liveAnswer(site: DemoSite, questionId: AskQuestionId, reasoning: ReasoningAdapter, now?: string): Promise<Live> {
  const context = { finding: site.finding, evidence: site.evidence.items, measurements: site.evidence.measurements, fieldNotes: [] };
  const question = ASK_QUESTIONS[questionId];
  let draft = unwrap(await reasoning.answerQuestion({ question, context }));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!draft) return { result: "model_unavailable" };
    if (draft.noEvidence) return { result: "no_evidence" };
    const v = check(site, questionId, draft, attempt > 0, now);
    if (v.decision === "SPEAK_AS_APPROVED") {
      return {
        result: "approved",
        answer: { kind: "approved", script: draft.script, sentenceEvidence: draft.sentenceEvidence, sieDecisionId: v.audit.id, speechRate: v.speechRate, source: "live" },
      };
    }
    if (v.decision === "SILENT_CARD_ONLY") return { result: "sie_silenced" };
    draft = unwrap(await reasoning.answerQuestion({ question, context, issues: v.issues }));
  }
  return { result: "sie_silenced" };
}

function check(site: DemoSite, questionId: AskQuestionId, a: Pick<SpokenAnswer, "script" | "sentenceEvidence">, rewriteAttempted: boolean, now?: string) {
  return evaluateScript(
    {
      scriptId: `ASK-${site.finding.id}-${questionId}`,
      script: a.script,
      sentenceEvidence: a.sentenceEvidence,
      claims: site.finding.claims,
      uncertainty: site.finding.uncertainty.level,
      userRequestedSpeculation: false,
      rewriteAttempted,
    },
    createContext(site.siteId, site.evidence.items, site.evidence.measurements),
    now,
  );
}

function unwrap<T>(r: Result<T>): T | undefined {
  return r.ok ? r.value : undefined;
}
