// SIE finding pipeline (SCIENTIFIC_INTEGRITY.md §1): schema → evidence → numbers → scope → claim type
// → coordinates → contradiction → sufficiency → decision. Nothing reaches the headset without this (AGENTS.md rule 2).
import type {
  Claim,
  FindingDecisionOutcome,
  FindingDraft,
  Observation,
  ScientificFinding,
  SieDecisionRecord,
  SpatialAnchor,
} from "@nexus/schemas";
import { auditRecord } from "./audit.js";
import type { SieContext } from "./context.js";
import { recordsFor } from "./context.js";
import type { DecisionAdapter } from "./decisionAdapter.js";
import { decide } from "./decisionAdapter.js";
import { evidenceSufficientFallback, needsEscalationFallback } from "./fallbackPolicy.js";
import { unmatchedNumbers, wordingIssue } from "./text.js";
import type { ValidationIssue, ValidationResult } from "./types.js";
import {
  contradictingIds,
  sanitizeAnchor,
  validateClaimCoordinates,
  validateClaimType,
  validateContradictions,
  validateEvidence,
  validateNoSelfApproval,
  validateNumbers,
  validateSchema,
  validateScope,
  validateSufficiency,
} from "./validators.js";

export interface FindingEvaluationInput {
  observation: Observation;
  /** Raw agent outputs, unparsed: V9 and V1 run on them first. */
  agentOutputs: readonly unknown[];
  draft: FindingDraft;
  impact?: "normal" | "high";
}

export interface RejectedOutput {
  index: number;
  agentId?: string;
  issues: ValidationIssue[];
  /** V1 failures may be retried once by the orchestrator; V9 failures may not. */
  retryable: boolean;
}

export interface FindingEvaluation {
  claims: Claim[];
  removedClaims: { text: string; reason: string }[];
  rejectedOutputs: RejectedOutput[];
  summary: string;
  possibleInterpretations: FindingDraft["possibleInterpretations"];
  spatialAnchor: SpatialAnchor;
  contested: boolean;
  decision: ScientificFinding["decision"];
  /** Never "reviewed": only a human review event sets that (AGENTS.md rule 8). */
  status: Extract<ScientificFinding["status"], "researching" | "ready_for_review">;
  issues: ValidationIssue[];
  audit: SieDecisionRecord;
}

const CLAIM_VALIDATORS = [validateScope, validateEvidence, validateNumbers, validateClaimType] as const;

export async function evaluateFinding(
  input: FindingEvaluationInput,
  ctx: SieContext,
  adapter?: DecisionAdapter,
  now: string = new Date().toISOString(),
): Promise<FindingEvaluation> {
  const issues: ValidationIssue[] = [];
  const rejectedOutputs: RejectedOutput[] = [];
  const removedClaims: { text: string; reason: string }[] = [];
  const kept: Claim[] = [];
  const seen = new Set<string>();

  input.agentOutputs.forEach((raw, index) => {
    // V9 before V1: a self-approving output is rejected outright, not retried.
    const v9 = validateNoSelfApproval(raw);
    if (!v9.ok) {
      rejectedOutputs.push({ index, agentId: agentIdOf(raw), issues: v9.error, retryable: false });
      issues.push(...v9.error);
      return;
    }
    const parsed = validateSchema(raw);
    if (!parsed.ok) {
      rejectedOutputs.push({ index, agentId: agentIdOf(raw), issues: parsed.error, retryable: true });
      issues.push(...parsed.error);
      return;
    }
    const out = parsed.value;
    if (out.observationId !== input.observation.id) {
      const issue: ValidationIssue = { validator: "V1", message: `output is for ${out.observationId}, not ${input.observation.id}` };
      rejectedOutputs.push({ index, agentId: out.agentId, issues: [issue], retryable: false });
      issues.push(issue);
      return;
    }
    out.claims.forEach((claim, i) => {
      const ci = { claim, agentId: out.agentId, index: i };
      const failures = [
        ...CLAIM_VALIDATORS.map((v) => v(ci, ctx)),
        validateClaimCoordinates(ci, input.observation),
      ].flatMap(errorsOf);
      if (failures.length > 0) {
        issues.push(...failures);
        removedClaims.push({ text: claim.text, reason: removalReason(failures) });
        return;
      }
      const key = claim.text.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      kept.push(claim);
    });
  });

  // Interpretations must be hedged and cite existing evidence, like any other claim.
  const possibleInterpretations = input.draft.possibleInterpretations.filter((p) => {
    const asClaim: Claim = { text: p.explanation, claimType: "interpretation", evidenceIds: p.supportingEvidenceIds };
    const failures = [validateEvidence, validateNumbers, validateClaimType]
      .map((v) => v({ claim: asClaim, agentId: "22_research_synthesis_specialist", index: -1 }, ctx))
      .flatMap(errorsOf);
    if (failures.length === 0) return true;
    issues.push(...failures);
    removedClaims.push({ text: p.explanation, reason: removalReason(failures) });
    return false;
  });
  const draft: FindingDraft = { ...input.draft, possibleInterpretations };

  // The summary may only restate surviving claims; if it does more, rebuild it from them.
  let summary = draft.summary;
  const summaryNumbers = unmatchedNumbers(summary, recordsFor(ctx, kept.flatMap((c) => [...c.evidenceIds, ...(c.measurementIds ?? [])])));
  const summaryWording = wordingIssue(summary, draft.claimType);
  if (summaryNumbers.length > 0 || summaryWording) {
    issues.push({
      validator: summaryNumbers.length > 0 ? "V3" : "V5",
      message: `summary rebuilt from claims: ${summaryWording ?? `"${summaryNumbers[0]?.raw}" matches no measurement`}`,
    });
    summary = kept.slice(0, 2).map((c) => c.text).join(" ");
  }

  const { anchor, issues: anchorIssues } = sanitizeAnchor(input.observation);
  issues.push(...anchorIssues);

  const contradictions = contradictingIds({ draft, claims: kept }, ctx);
  const v6 = validateContradictions({ draft: { ...draft, summary }, claims: kept }, ctx);
  issues.push(...errorsOf(v6));
  const contested = contradictions.length > 0;

  const v7 = validateSufficiency(kept);
  issues.push(...errorsOf(v7));

  const sufficient = await decide(
    adapter && (() => adapter.evidenceSufficient(sufficiencyQ())),
    () => evidenceSufficientFallback(sufficiencyQ()),
  );
  function sufficiencyQ() {
    return {
      validatorIssues: issues,
      survivingClaims: kept.length,
      groundedObservationOrMeasurement: kept.some((c) => c.claimType === "observation" || c.claimType === "measurement"),
    };
  }
  const escalationQ = {
    contradiction: contested,
    contradictionPresented: v6.ok,
    uncertainty: draft.uncertainty.level,
    impact: input.impact ?? "normal",
  };
  const escalate = await decide(adapter && (() => adapter.needsEscalation(escalationQ)), () => needsEscalationFallback(escalationQ));

  // V7 is deterministic: Jev may not overrule a failed sufficiency check upward.
  let outcome: FindingDecisionOutcome;
  let reason: string;
  if (kept.length === 0) {
    outcome = "REJECT";
    reason = "no claim survived validation";
  } else if (!sufficient.value || !v7.ok) {
    outcome = "REQUEST_MORE_EVIDENCE";
    reason = "evidence is not sufficient for review";
  } else if (escalate.value) {
    outcome = "ESCALATE_TO_SCIENTIST";
    reason = contested ? "contradicting evidence needs the scientist's judgement" : "high-impact finding";
  } else {
    outcome = "ACCEPT_FOR_REVIEW";
    reason = "validated claims with sufficient evidence";
  }
  const source = sufficient.source === "jev" && escalate.source === "jev" ? "jev" : "fallback";

  return {
    claims: kept,
    removedClaims,
    rejectedOutputs,
    summary,
    possibleInterpretations,
    spatialAnchor: anchor,
    contested,
    decision: { outcome, reason, source },
    status: outcome === "ACCEPT_FOR_REVIEW" || outcome === "ESCALATE_TO_SCIENTIST" ? "ready_for_review" : "researching",
    issues,
    audit: auditRecord({
      kind: "finding",
      subjectId: input.observation.id,
      input,
      issues,
      outcome,
      reason,
      source,
      jevRequestIds: [sufficient.requestId, escalate.requestId].filter((x): x is string => x !== undefined),
      now,
    }),
  };
}

function errorsOf(r: ValidationResult): ValidationIssue[] {
  return r.ok ? [] : r.error;
}

/** Short, user-facing reason for the "Removed" list. */
function removalReason(failures: readonly ValidationIssue[]): string {
  const first = failures[0];
  if (!first) return "failed validation";
  switch (first.validator) {
    case "V2":
      return "no evidence";
    case "V3":
      return "number does not match a measurement";
    case "V4":
      return "outside the agent's scope";
    case "V5":
      return "worded more certainly than the evidence allows";
    case "V8":
      return "coordinate without localisation";
    default:
      return first.message;
  }
}

function agentIdOf(raw: unknown): string | undefined {
  if (raw !== null && typeof raw === "object" && "agentId" in raw && typeof raw.agentId === "string") return raw.agentId;
  return undefined;
}
