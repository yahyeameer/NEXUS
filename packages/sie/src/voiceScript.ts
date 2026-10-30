// Voice validators VV1–VV3: the Epistemic Voice Policy (VOICE.md §5, PRD §6.5) enforced before TTS.
// Nothing is spoken without passing here, except fixed system phrases (AGENTS.md rule 2).
import type { Claim, ClaimType, SieDecisionRecord, Uncertainty, VoiceDecision } from "@nexus/schemas";
import { auditRecord } from "./audit.js";
import type { SieContext } from "./context.js";
import { isKnownEvidence, recordsFor } from "./context.js";
import { topicsOf } from "./scopes.js";
import { CAUSAL, FORBIDDEN_ALWAYS, extractNumbers, hasSpelledMeasurement, splitSentences, unmatchedNumbers, wordingIssue } from "./text.js";
import type { ValidationIssue } from "./types.js";

/** Required framings per claim type (VOICE.md §5). Checked strongest-hedge first. */
const FRAMINGS: readonly [ClaimType, RegExp][] = [
  ["hypothesis", /\bone possibility,? with (?:low|medium|high) uncertainty,? is\b/i],
  ["interpretation", /\b(?:is consistent with|one interpretation is)\b/i],
  ["measurement", /\bgives? (?:about|roughly|approximately)\b/i],
  ["observation", /\b(?:the (?:image|images|imagery|frame|mosaic)s? shows?|i can see|you noted|you said)\b/i],
];

/** Sentences that may carry no evidence: what was investigated, and the uncertainty statement. */
const META = /^(?:(?:i|we) (?:investigated|looked at|examined|checked)\b|here is\b|here's\b|(?:overall,? )?uncertainty (?:is|for this finding is) (?:low|medium|high)\b|this briefing\b)/i;

const SPECULATION_MARKER = /\b(speculat\w*|i think|i believe|i guess|my guess|probably|presumably)\b/i;
const SPECULATION_FRAMING = /^speculating,? without evidence\b/i;

export interface ScriptInput {
  scriptId: string;
  script: string;
  /** Evidence IDs per sentence, from script metadata (not spoken). */
  sentenceEvidence: readonly (readonly string[])[];
  /** The finding's surviving claims: the only things a script may say. */
  claims: readonly Claim[];
  uncertainty: Uncertainty["level"];
  /** Only true when the scientist explicitly asked NEXUS to speculate. */
  userRequestedSpeculation?: boolean;
  /** True once the one automatic rewrite has been used. */
  rewriteAttempted?: boolean;
}

export interface VoiceEvaluation {
  decision: VoiceDecision;
  issues: ValidationIssue[];
  /** VOICE.md §5: high uncertainty is spoken at 0.9×. */
  speechRate: number;
  audit: SieDecisionRecord;
}

export function checkScript(input: ScriptInput, ctx: SieContext): ValidationIssue[] {
  const sentences = splitSentences(input.script);
  const issues: ValidationIssue[] = [];
  if (sentences.length !== input.sentenceEvidence.length) {
    issues.push({
      validator: "VV3",
      message: `script has ${sentences.length} sentence(s) but evidence map has ${input.sentenceEvidence.length}`,
    });
  }

  sentences.forEach((sentence, index) => {
    const evidence = input.sentenceEvidence[index] ?? [];
    for (const id of evidence) {
      if (!isKnownEvidence(ctx, id)) issues.push({ validator: "VV3", message: `unknown evidence id ${id}`, index });
    }

    const forbidden = FORBIDDEN_ALWAYS.exec(sentence);
    if (forbidden) issues.push({ validator: "VV1", message: `forbidden certainty word "${forbidden[0]}"`, index });

    if (SPECULATION_MARKER.test(sentence)) {
      if (!input.userRequestedSpeculation) {
        issues.push({ validator: "VV1", message: "speculation spoken without the user asking", index });
      } else if (!SPECULATION_FRAMING.test(sentence)) {
        issues.push({ validator: "VV1", message: 'speculation must open with "Speculating, without evidence"', index });
      }
      return;
    }

    if (evidence.length === 0) {
      if (!isMeta(sentence)) issues.push({ validator: "VV3", message: "claim sentence maps to no evidence id", index });
      return;
    }

    const framing = FRAMINGS.find(([, re]) => re.test(sentence))?.[0];
    const supporting = input.claims.filter((c) => [...c.evidenceIds, ...(c.measurementIds ?? [])].some((id) => evidence.includes(id)));
    const supported = new Set<ClaimType>(supporting.map((c) => c.claimType));
    if (recordsFor(ctx, evidence).length > 0) supported.add("measurement");

    if (!framing) {
      issues.push({ validator: "VV1", message: "claim sentence has no epistemic framing", index });
    } else {
      if (!supported.has(framing)) {
        issues.push({
          validator: "VV1",
          message: `spoken as ${framing} but the evidence supports ${[...supported].join(", ") || "no claim"}`,
          index,
        });
      }
      const wording = wordingIssue(sentence, framing);
      if (wording) issues.push({ validator: "VV1", message: wording, index });
    }

    const records = recordsFor(ctx, [...evidence, ...supporting.flatMap((c) => c.measurementIds ?? [])]);
    for (const n of unmatchedNumbers(sentence, records)) {
      issues.push({ validator: "VV2", message: `spoken "${n.raw}" matches no measurement`, index });
    }
    if (hasSpelledMeasurement(sentence)) {
      issues.push({ validator: "VV2", message: "spoken measurement written in words cannot be checked", index });
    }
  });

  // VOICE.md §5: the uncertainty level is stated, and first when it is high.
  const statement = new RegExp(`\\b${input.uncertainty} uncertainty\\b|\\buncertainty (?:is|for this finding is) ${input.uncertainty}\\b`, "i");
  const at = sentences.findIndex((s) => statement.test(s));
  if (at < 0) issues.push({ validator: "VV1", message: `uncertainty level "${input.uncertainty}" is not stated` });
  // The first sentence names what was investigated, so "first" means within the first two.
  else if (input.uncertainty === "high" && at > 1) {
    issues.push({ validator: "VV1", message: "high uncertainty must be stated first", index: at });
  }
  return issues;
}

/** VOICE.md §5 validator outcome: approve, one automatic rewrite, then card only. */
export function evaluateScript(input: ScriptInput, ctx: SieContext, now: string = new Date().toISOString()): VoiceEvaluation {
  const issues = checkScript(input, ctx);
  const decision: VoiceDecision =
    issues.length === 0 ? "SPEAK_AS_APPROVED" : input.rewriteAttempted ? "SILENT_CARD_ONLY" : "REWRITE_SCRIPT";
  return {
    decision,
    issues,
    speechRate: input.uncertainty === "high" ? 0.9 : 1,
    audit: auditRecord({
      kind: "voice",
      subjectId: input.scriptId,
      input,
      issues,
      outcome: decision,
      reason: issues.length === 0 ? "script matches evidence and framing" : (issues[0]?.message ?? ""),
      source: "deterministic",
      now,
    }),
  };
}

export interface DebateTurnInput {
  turnId: string;
  speakerAgentId: string;
  text: string;
  evidenceIds: readonly string[];
}

/** VOICE.md §7: every debate turn cites existing evidence and stays hedged; uncited turns are removed. */
export function evaluateDebateTurn(input: DebateTurnInput, ctx: SieContext, now: string = new Date().toISOString()) {
  const issues: ValidationIssue[] = [];
  if (input.evidenceIds.length === 0) issues.push({ validator: "VV3", message: "debate turn cites no evidence" });
  for (const id of input.evidenceIds) {
    if (!isKnownEvidence(ctx, id)) issues.push({ validator: "VV3", message: `unknown evidence id ${id}` });
  }
  const wording = wordingIssue(input.text, "interpretation");
  if (wording) issues.push({ validator: "VV1", message: wording });
  for (const n of unmatchedNumbers(input.text, recordsFor(ctx, input.evidenceIds))) {
    issues.push({ validator: "VV2", message: `"${n.raw}" matches no measurement` });
  }
  const outcome = issues.length === 0 ? "ACCEPT" : "REMOVE";
  return {
    outcome,
    issues,
    audit: auditRecord({
      kind: "debate_turn",
      subjectId: input.turnId,
      input,
      issues,
      outcome,
      reason: issues[0]?.message ?? "cited and hedged",
      source: "deterministic",
      now,
    }),
  } as const;
}

function isMeta(sentence: string): boolean {
  return (
    META.test(sentence) &&
    extractNumbers(sentence).length === 0 &&
    !CAUSAL.test(sentence) &&
    topicsOf(sentence).length === 0
  );
}
