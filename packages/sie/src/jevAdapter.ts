// Jev (TypeSafe System One) behind the DecisionAdapter (SCIENTIFIC_INTEGRITY.md §4). Backend only: this file is not
// exported from the package index, so the XR client never bundles it and never holds the key (AGENTS.md rule 6).
// Services import it as `@nexus/sie/jevAdapter`.
//
// Jev answers typed yes/no questions with a probability; it writes no text and no numbers. A probability inside the
// undecided band is returned as an error, so `decide()` uses the deterministic fallback instead of a coin flip.
import { z } from "zod";
import type { Result } from "@nexus/schemas";
import type {
  DecisionAdapter,
  DecisionAnswer,
  EscalationQuestion,
  SpecialistQuestion,
  SufficiencyQuestion,
} from "./decisionAdapter.js";
import { DECISION_TIMEOUT_MS } from "./decisionAdapter.js";

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** Pinned, not an alias: answers can shift between Jev releases, and the thresholds below were set on this one. */
export const JEV_DEFAULT_MODEL = "jev-1.14.0";
/** At or above: yes. At or below `JEV_NO`: no. In between: undecided, the fallback decides. */
export const JEV_YES = 0.65;
export const JEV_NO = 0.35;

/** Always part of a run (AGENT_CATALOG.md MVP order): measurement, imagery, uncertainty, synthesis. Jev picks the rest. */
const CORE_SPECIALISTS: readonly string[] = [
  "26_lola_elevation_researcher",
  "25_lroc_imagery_researcher",
  "37_uncertainty_analyst",
  "22_research_synthesis_specialist",
];

export interface JevDecisionLog {
  question: "selectSpecialists" | "evidenceSufficient" | "needsEscalation";
  requestId: string;
  model: string;
  probabilities: Record<string, number>;
}

export interface JevOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  yes?: number;
  no?: number;
  fetch?: typeof fetch;
  /** Structured log hook (AGENTS.md §7). Receives probabilities and ids only, never the key. */
  log?: (entry: JevDecisionLog) => void;
}

type NoulQuestion = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

const jevResponse = z.object({
  model: z.string(),
  answers: z.record(z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) })),
});

export class JevAdapter implements DecisionAdapter {
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly yes: number;
  private readonly no: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: JevOptions) {
    this.url = `${(opts.baseUrl ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/systemone`;
    this.model = opts.model ?? JEV_DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DECISION_TIMEOUT_MS;
    this.yes = opts.yes ?? JEV_YES;
    this.no = opts.no ?? JEV_NO;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async selectSpecialists(q: SpecialistQuestion): Promise<Result<DecisionAnswer<string[]>>> {
    const optional = q.allowed.filter((a) => !CORE_SPECIALISTS.includes(a));
    if (optional.length === 0) return { ok: false, error: "no optional specialists to choose from" };
    const questions: Record<string, NoulQuestion> = {};
    for (const id of optional) {
      questions[id] = {
        type: "noul",
        instructions: `Should the ${roleOf(id)} investigate this observation?`,
        criteria: {
          true: "The observation's feature kind or the scientist's descriptors call for this specialist's subject.",
          false: "Nothing in the observation relates to this specialist's subject.",
        },
      };
    }
    const state = { observationSource: q.observationSource, featureKind: q.featureKind ?? "unknown", descriptors: q.descriptors };
    const res = await this.ask("selectSpecialists", state, questions);
    if (!res.ok) return res;
    // Only a confident yes sends an optional specialist: idle agents cost time and sandboxes (AGENTS.md §10).
    const picked = new Set([...CORE_SPECIALISTS, ...optional.filter((id) => this.verdict(res.value.p[id]) === true)]);
    return { ok: true, value: { value: q.allowed.filter((a) => picked.has(a)), requestId: res.value.requestId } };
  }

  async evidenceSufficient(q: SufficiencyQuestion): Promise<Result<DecisionAnswer<boolean>>> {
    const questions: Record<string, NoulQuestion> = {
      sufficient: {
        type: "noul",
        instructions: "Is this finding ready to be shown to a scientist for review?",
        criteria: {
          true: "At least two claims survived validation, one of them is an observation or a measurement, and no validator reported insufficient evidence.",
          false: "Fewer than two claims survived, none is an observation or measurement, or a validator reported insufficient evidence.",
        },
      },
    };
    if (q.claims && q.claims.length > 0) {
      questions.supported = {
        type: "noul",
        instructions: "Does the evidence cited by each claim support that claim at the confidence its claim type states?",
        criteria: {
          true: "Every claim is about what its cited evidence shows, and interpretations and hypotheses are worded as possibilities.",
          false: "A claim goes beyond its cited evidence, cites evidence about something else, or states an interpretation as fact.",
        },
      };
    }
    const state = {
      survivingClaims: q.survivingClaims,
      groundedObservationOrMeasurement: q.groundedObservationOrMeasurement,
      validatorIssues: q.validatorIssues.map((i) => ({ validator: i.validator, message: i.message })),
      claims: q.claims ?? [],
    };
    const res = await this.ask("evidenceSufficient", state, questions);
    if (!res.ok) return res;
    const verdicts = Object.keys(questions).map((k) => this.verdict(res.value.p[k]));
    // One confident "no" settles it; a "yes" needs every question to be a confident yes.
    if (verdicts.includes(false)) return { ok: true, value: { value: false, requestId: res.value.requestId } };
    if (verdicts.every((v) => v === true)) return { ok: true, value: { value: true, requestId: res.value.requestId } };
    return { ok: false, error: `Jev undecided (${summary(res.value.p)})` };
  }

  async needsEscalation(q: EscalationQuestion): Promise<Result<DecisionAnswer<boolean>>> {
    const res = await this.ask("needsEscalation", q, {
      escalate: {
        type: "noul",
        instructions: "Does this finding need to be escalated to the scientist's judgement rather than accepted for routine review?",
        criteria: {
          true: "The impact is high, or evidence contradicts the finding and the contradiction is either not presented to the scientist or the uncertainty is high.",
          false: "The impact is normal and there is no contradiction, or the contradiction is presented and the uncertainty is not high.",
        },
      },
    });
    if (!res.ok) return res;
    const v = this.verdict(res.value.p.escalate);
    if (v === undefined) return { ok: false, error: `Jev undecided (${summary(res.value.p)})` };
    return { ok: true, value: { value: v, requestId: res.value.requestId } };
  }

  /** A margin between two scores is arithmetic: it stays in code (AGENTS.md rule 4), so the fallback always answers. */
  async referenceNeedsClarification(): Promise<Result<DecisionAnswer<boolean>>> {
    return { ok: false, error: "score margins are decided deterministically" };
  }

  private verdict(p: number | undefined): boolean | undefined {
    if (p === undefined) return undefined;
    if (p >= this.yes) return true;
    if (p <= this.no) return false;
    return undefined;
  }

  private async ask(
    question: JevDecisionLog["question"],
    state: unknown,
    questions: Record<string, NoulQuestion>,
  ): Promise<Result<{ p: Record<string, number>; requestId: string }>> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? `Jev timed out after ${this.timeoutMs} ms` : "Jev unreachable" };
    }
    // Status only: provider error bodies are never passed on (AGENTS.md §7).
    if (!res.ok) return { ok: false, error: `Jev HTTP ${res.status}` };
    const parsed = jevResponse.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) return { ok: false, error: "Jev response did not match the expected shape" };
    const p: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const a = parsed.data.answers[key];
      if (!a) return { ok: false, error: `Jev did not answer "${key}"` };
      p[key] = a.noul;
    }
    const requestId = res.headers.get("x-typesafe-request-id") ?? "unknown";
    this.opts.log?.({ question, requestId, model: parsed.data.model, probabilities: p });
    return { ok: true, value: { p, requestId } };
  }
}

/** "12_impact_crater_researcher" → "impact crater researcher". */
function roleOf(agentId: string): string {
  return agentId.replace(/^\d+_/, "").replaceAll("_", " ");
}

function summary(p: Record<string, number>): string {
  return Object.entries(p)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(", ");
}

/** Jev is on only when the backend has a key; without one every decision uses the deterministic fallback. */
export function jevFromEnv(env: Record<string, string | undefined>, log?: JevOptions["log"]): JevAdapter | undefined {
  const apiKey = env.JEV_API_KEY;
  if (!apiKey) return undefined;
  return new JevAdapter({ apiKey, baseUrl: env.JEV_BASE_URL || undefined, model: env.JEV_MODEL || undefined, log });
}
