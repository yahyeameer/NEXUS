// Jev structured decision questions (SCIENTIFIC_INTEGRITY.md §4). The vendor client lives in a backend
// `jevAdapter.ts` that implements this interface; this package never imports a provider SDK (AGENTS.md §4).
import type { Result, Uncertainty } from "@nexus/schemas";
import type { ValidationIssue } from "./types.js";

export interface SpecialistQuestion {
  observationSource: "hand_select" | "field_note" | "video_mark";
  featureKind?: "crater" | "rille" | "slope" | "point";
  descriptors: readonly string[];
  /** Agents the answer must be drawn from. */
  allowed: readonly string[];
}

export interface SufficiencyQuestion {
  validatorIssues: readonly ValidationIssue[];
  survivingClaims: number;
  groundedObservationOrMeasurement: boolean;
}

export interface EscalationQuestion {
  contradiction: boolean;
  contradictionPresented: boolean;
  uncertainty: Uncertainty["level"];
  impact: "normal" | "high";
}

export interface ReferenceQuestion {
  /** Candidate scores, any order. */
  scores: readonly number[];
}

export interface DecisionAnswer<T> {
  value: T;
  /** Jev request id, kept in the audit log. */
  requestId: string;
}

/** Jev only ever receives inputs that already passed the deterministic validators. */
export interface DecisionAdapter {
  selectSpecialists(q: SpecialistQuestion): Promise<Result<DecisionAnswer<string[]>>>;
  evidenceSufficient(q: SufficiencyQuestion): Promise<Result<DecisionAnswer<boolean>>>;
  needsEscalation(q: EscalationQuestion): Promise<Result<DecisionAnswer<boolean>>>;
  referenceNeedsClarification(q: ReferenceQuestion): Promise<Result<DecisionAnswer<boolean>>>;
}

export interface Decided<T> {
  value: T;
  source: "jev" | "fallback";
  requestId?: string;
  /** Why the fallback was used, if it was. */
  fallbackReason?: string;
}

/** Default Jev timeout. Past this the demo uses the fallback rather than stall (AGENTS.md §6 demo safety). */
export const DECISION_TIMEOUT_MS = 2500;

/**
 * Ask the adapter; on error, timeout, missing adapter or an invalid answer use the deterministic fallback.
 * `accept` lets the caller reject answers that break policy (e.g. specialists outside the allowed list).
 */
export async function decide<T>(
  ask: (() => Promise<Result<DecisionAnswer<T>>>) | undefined,
  fallback: () => T,
  accept: (v: T) => boolean = () => true,
  timeoutMs = DECISION_TIMEOUT_MS,
): Promise<Decided<T>> {
  if (!ask) return { value: fallback(), source: "fallback", fallbackReason: "no decision adapter configured" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<Result<DecisionAnswer<T>>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `timed out after ${timeoutMs} ms` }), timeoutMs);
    });
    const res = await Promise.race([ask(), timeout]);
    if (!res.ok) return { value: fallback(), source: "fallback", fallbackReason: res.error };
    if (!accept(res.value.value)) return { value: fallback(), source: "fallback", fallbackReason: "answer outside policy" };
    return { value: res.value.value, source: "jev", requestId: res.value.requestId };
  } catch (e) {
    // Never surface raw provider errors (AGENTS.md §7); keep only the message for the audit row.
    return { value: fallback(), source: "fallback", fallbackReason: e instanceof Error ? e.message : "adapter error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
