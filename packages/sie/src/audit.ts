import { createHash, randomUUID } from "node:crypto";
import type { SieDecisionRecord } from "@nexus/schemas";
import type { ValidationIssue } from "./types.js";

/** JSON with sorted keys so equal inputs always hash the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function hashInput(v: unknown): string {
  return createHash("sha256").update(canonicalJson(v)).digest("hex");
}

/** One append-only `sie_decisions` row (SCIENTIFIC_INTEGRITY.md §6). */
export function auditRecord(args: {
  kind: SieDecisionRecord["kind"];
  subjectId: string;
  input: unknown;
  issues: readonly ValidationIssue[];
  outcome: SieDecisionRecord["outcome"];
  reason: string;
  source: SieDecisionRecord["source"];
  jevRequestIds?: readonly string[];
  now: string;
}): SieDecisionRecord {
  return {
    id: `SIE-${randomUUID()}`,
    kind: args.kind,
    inputHash: hashInput(args.input),
    subjectId: args.subjectId,
    validatorResults: args.issues.map((i) => ({ validator: i.validator, message: i.message, index: i.index })),
    outcome: args.outcome,
    reason: args.reason,
    source: args.source,
    jevRequestIds: [...(args.jevRequestIds ?? [])],
    decidedAt: args.now,
  };
}
