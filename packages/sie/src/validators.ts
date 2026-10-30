// Finding validators V1–V9 (SCIENTIFIC_INTEGRITY.md §2). Each is a pure function `(input, context) => ValidationResult`.
import { agentOutput } from "@nexus/schemas";
import type { AgentOutput, Claim, FindingDraft, Observation, Result, SpatialAnchor } from "@nexus/schemas";
import type { SieContext } from "./context.js";
import { isKnownEvidence, recordsFor } from "./context.js";
import { scopeFor, topicsOf } from "./scopes.js";
import { COORDINATE, hasSpelledMeasurement, unmatchedNumbers, wordingIssue } from "./text.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

const ok: ValidationResult = { ok: true, value: true };
const fail = (issues: ValidationIssue[]): ValidationResult => (issues.length === 0 ? ok : { ok: false, error: issues });

/** V1: output parses as AgentOutput. */
export function validateSchema(raw: unknown): Result<AgentOutput, ValidationIssue[]> {
  const parsed = agentOutput.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues.map((i) => ({ validator: "V1", message: `${i.path.join(".") || "output"}: ${i.message}` })),
  };
}

const APPROVAL_KEYS = new Set(["status", "review", "reviewed", "decision", "approved"]);

/** V9: no agent output may set a review status, anywhere in its JSON. */
export function validateNoSelfApproval(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (APPROVAL_KEYS.has(k)) issues.push({ validator: "V9", message: `agent output sets "${path}${k}"` });
        walk(x, `${path}${k}.`);
      }
    }
  };
  walk(raw, "");
  return fail(issues);
}

export interface ClaimInput {
  claim: Claim;
  agentId: string;
  index: number;
}

/** V2: every cited ID exists in this site's evidence store. A claim with no evidence fails. */
export function validateEvidence({ claim, index }: ClaimInput, ctx: SieContext): ValidationResult {
  if (claim.evidenceIds.length === 0) return fail([{ validator: "V2", message: "claim cites no evidence", index }]);
  const cited = [...claim.evidenceIds, ...(claim.contradictingEvidenceIds ?? []), ...(claim.measurementIds ?? [])];
  return fail(
    cited
      .filter((id) => !isKnownEvidence(ctx, id))
      .map((id) => ({ validator: "V2" as const, message: `unknown evidence id ${id}`, index })),
  );
}

/** V3: every number in the claim matches a cited MeasurementRecord within ±5 % and a compatible unit. */
export function validateNumbers({ claim, index }: ClaimInput, ctx: SieContext): ValidationResult {
  const records = recordsFor(ctx, [...(claim.measurementIds ?? []), ...claim.evidenceIds]);
  const issues: ValidationIssue[] = unmatchedNumbers(claim.text, records).map((n) => ({
    validator: "V3",
    message: `"${n.raw}" matches no cited measurement`,
    index,
  }));
  if (hasSpelledMeasurement(claim.text)) {
    issues.push({ validator: "V3", message: "measurement written in words cannot be checked", index });
  }
  return fail(issues);
}

/** V4: claim type and topic are inside the agent's declared scope. */
export function validateScope({ claim, agentId, index }: ClaimInput): ValidationResult {
  const scope = scopeFor(agentId);
  if (!scope) return fail([{ validator: "V4", message: `agent ${agentId} has no declared scope`, index }]);
  const issues: ValidationIssue[] = [];
  if (!scope.claimTypes.includes(claim.claimType)) {
    issues.push({ validator: "V4", message: `${agentId} may not make ${claim.claimType} claims`, index });
  }
  for (const t of topicsOf(claim.text)) {
    if (!scope.topics.includes(t)) issues.push({ validator: "V4", message: `${agentId} is out of scope on ${t}`, index });
  }
  return fail(issues);
}

/** V5: wording matches the claim type (no definite phrasing for interpretations and hypotheses). */
export function validateClaimType({ claim, index }: ClaimInput): ValidationResult {
  const issue = wordingIssue(claim.text, claim.claimType);
  return fail(issue ? [{ validator: "V5", message: issue, index }] : []);
}

/** True when the observation came from a video frame, which carries no localisation metadata in the MVP. */
export function isFrameBased(observation: Observation): boolean {
  return observation.source === "video_mark" || observation.frameRef !== undefined;
}

/** V8 (claims): no precise coordinates derived from a frame without localisation metadata. */
export function validateClaimCoordinates({ claim, index }: ClaimInput, observation: Observation): ValidationResult {
  if (isFrameBased(observation) && COORDINATE.test(claim.text)) {
    return fail([{ validator: "V8", message: "precise coordinate from a video frame without localisation metadata", index }]);
  }
  return ok;
}

/** V8 (anchor): keep lat/lon only with a CRS and a localised source; otherwise anchor to the feature id. */
export function sanitizeAnchor(observation: Observation): { anchor: SpatialAnchor; issues: ValidationIssue[] } {
  const a = observation.spatialAnchor;
  const hasLatLon = a.latitude !== undefined || a.longitude !== undefined;
  if (!hasLatLon) return { anchor: a, issues: [] };
  const reason = !a.coordinateReferenceSystem
    ? "coordinates without a CRS"
    : isFrameBased(observation)
      ? "coordinates from a video frame without localisation metadata"
      : undefined;
  if (!reason) return { anchor: a, issues: [] };
  const anchor: SpatialAnchor = {
    terrainFeatureId: a.terrainFeatureId ?? observation.featureId,
    sceneLocal: a.sceneLocal,
  };
  return { anchor, issues: [{ validator: "V8", message: `stripped ${reason}` }] };
}

/** Words that tell the listener the summary presents more than one side. */
const BOTH_SIDES = /\b(however|but|although|whereas|alternative(?:ly)?|contradict\w*|conflict\w*|contested|disagree\w*|on the other hand|other interpretation|does not fit|inconsistent with)\b/i;

export interface ContradictionInput {
  draft: FindingDraft;
  claims: readonly Claim[];
}

/** IDs of existing evidence that contradicts any surviving claim or interpretation. */
export function contradictingIds({ draft, claims }: ContradictionInput, ctx: SieContext): string[] {
  const ids = new Set<string>();
  for (const c of claims) for (const id of c.contradictingEvidenceIds ?? []) ids.add(id);
  for (const p of draft.possibleInterpretations) for (const id of p.contradictingEvidenceIds) ids.add(id);
  return [...ids].filter((id) => isKnownEvidence(ctx, id));
}

/** V6: if contradicting evidence exists, the finding presents both sides (interpretations and summary). */
export function validateContradictions(input: ContradictionInput, ctx: SieContext): ValidationResult {
  const ids = contradictingIds(input, ctx);
  if (ids.length === 0) return ok;
  const issues: ValidationIssue[] = [];
  const presented = new Set(input.draft.possibleInterpretations.flatMap((p) => p.contradictingEvidenceIds));
  for (const id of ids) {
    if (!presented.has(id)) issues.push({ validator: "V6", message: `contradicting evidence ${id} missing from interpretations` });
  }
  if (input.draft.possibleInterpretations.length < 2) {
    issues.push({ validator: "V6", message: "contested finding presents fewer than two interpretations" });
  }
  if (!BOTH_SIDES.test(input.draft.summary)) {
    issues.push({ validator: "V6", message: "summary omits the contradicting evidence" });
  }
  return fail(issues);
}

/** V7: at least two surviving claims with evidence, including one observation or measurement. */
export function validateSufficiency(claims: readonly Claim[]): ValidationResult {
  const grounded = claims.filter((c) => c.evidenceIds.length > 0);
  if (grounded.length >= 2 && grounded.some((c) => c.claimType === "observation" || c.claimType === "measurement")) return ok;
  return fail([{ validator: "V7", message: `${grounded.length} grounded claim(s); need 2 incl. an observation or measurement` }]);
}
