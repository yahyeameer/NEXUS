# Scientific Integrity Engine (SIE)

The SIE is the mandatory gate between autonomous research and the scientist. It validates every finding before it is rendered and every script before it is spoken. It combines **deterministic validators** (`packages/sie`) with **Jev** for structured decision questions. Neither alone guarantees truth; reliability comes from provenance, validation, methods and human review.

## 1. Pipeline

```
AgentOutput[] ──► schema check ──► evidence check ──► number check ──► scope check
     ──► claim-type check ──► contradiction check ──► Jev decision ──► FindingDecision
spoken script ──► framing check ──► number check ──► evidence-map check ──► VoiceDecision
```

Each validator is a pure function `(input, context) => ValidationResult` and is unit-tested with fixtures in `packages/sie/fixtures/`.

## 2. Validators

| # | Validator | Rule | On failure |
| --- | --- | --- | --- |
| V1 | Schema | Output parses as `AgentOutput` | Retry agent once, then task failed |
| V2 | Evidence exists | Every `evidenceId` exists in the evidence store and is accessible | Remove claim, list it as "Removed: no evidence" |
| V3 | Numbers match | Every number in claim text matches a `MeasurementRecord` within ±5 % and same unit | Remove claim |
| V4 | Scope | Claim's topic is within the agent's declared scope | Remove claim, log scope violation |
| V5 | Claim type | Each claim has a type; hypothesis/interpretation wording is not definite | Rewrite (once) or downgrade |
| V6 | Contradiction | If contradicting evidence exists, finding must present both sides | Mark finding `contested` |
| V7 | Sufficiency | ≥ 2 surviving claims with evidence, incl. ≥ 1 observation or measurement | `REQUEST_MORE_EVIDENCE` |
| V8 | Coordinates | Coordinates include CRS; no precise coordinate from a frame without localisation metadata | Strip coordinate, anchor to feature ID only |
| V9 | Self-approval | No agent output sets status `reviewed` | Reject output |
| VV1 | Voice framing | Framing matches claim type (VOICE.md §5) | `REWRITE_SCRIPT` → recheck → `SILENT_CARD_ONLY` |
| VV2 | Voice numbers | Spoken numbers match records | Same as VV1 |
| VV3 | Voice evidence map | Each claim sentence maps to ≥ 1 evidence ID | Same as VV1 |
| VR1 | Reference | Deictic confidence ≥ 0.75 before anchoring a FieldNote | Ask clarification |
| VA1 | Attribution | Scientist's words stored verbatim, never turned into AI claims | Reject write |

## 3. Decision outcomes

**Finding:** `ACCEPT_FOR_REVIEW` · `REQUEST_MORE_EVIDENCE` · `REJECT` · `ESCALATE_TO_SCIENTIST`
**Voice:** `SPEAK_AS_APPROVED` · `REWRITE_SCRIPT` · `SILENT_CARD_ONLY`

These are workflow decisions, not statements of scientific truth.

## 4. Jev decision questions (MVP)

| Question | Inputs | Output |
| --- | --- | --- |
| Which specialists should investigate this observation? | observation type, descriptors | agent IDs (from allowed list) |
| Is evidence sufficient for review? | validator results | sufficient / insufficient |
| Does this need escalation? | contradiction flag, uncertainty, impact tag | escalate yes/no |
| Does this reference need clarification? | candidate scores | ask / accept |

Jev receives only validated inputs. If Jev is unavailable, use the deterministic fallback policy in `packages/sie/fallbackPolicy.ts` and log `decision.source = "fallback"`.

## 5. Decision input

```ts
interface ScientificDecisionInput {
  observationId: string;
  agentId: string;
  agentScopeValid: boolean;
  evidenceIds: string[];
  sourcesVerified: boolean;
  contradictoryEvidence: boolean;
  claimType: "observation" | "measurement" | "interpretation" | "hypothesis";
  uncertaintyDeclared: boolean;
  output: "card" | "speech";
  spokenScript?: string;
  spokenNumbersMatchRecords?: boolean;
  framingMatchesClaimType?: boolean;
  deicticConfidence?: number;
}
```

## 6. Audit log

Every decision is appended to `sie_decisions` with: input hash, validator results, Jev request/response IDs, outcome, reason, timestamp. Rows are append-only.

## 7. Red-team suite (`pnpm sie:redteam`)

Fixtures that **must** be caught, run in CI:

- Fake evidence ID (`EV-9999`)
- Number off by 20 % from measurement
- Hypothesis stated as fact ("This rille is a collapsed lava tube.")
- Spoken script saying "proves"
- Agent outside scope (imagery agent claiming mineral composition)
- Agent setting `status: reviewed`
- Precise lat/lon from a video frame with no localisation metadata
- Contradicting evidence omitted from summary
- Speculation spoken without user request
- Uncited debate turn
