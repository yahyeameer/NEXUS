import type { EvidenceItem, MeasurementRecord } from "@nexus/schemas";

/** What the SIE may trust: the curated evidence store and code-computed measurements for one site. */
export interface SieContext {
  siteId: string;
  evidence: ReadonlyMap<string, EvidenceItem>;
  measurements: ReadonlyMap<string, MeasurementRecord>;
}

export function createContext(siteId: string, evidence: readonly EvidenceItem[], measurements: readonly MeasurementRecord[]): SieContext {
  return {
    siteId,
    evidence: new Map(evidence.map((e) => [e.id, e])),
    measurements: new Map(measurements.map((m) => [m.id, m])),
  };
}

/**
 * True if `id` is citable for this site. Measurement IDs count as evidence (DATA_MODELS.md, MeasurementRecord),
 * but only when the DEM they were computed from is itself in the store.
 */
export function isKnownEvidence(ctx: SieContext, id: string): boolean {
  const ev = ctx.evidence.get(id);
  if (ev) return ev.siteId === ctx.siteId;
  const m = ctx.measurements.get(id);
  return m !== undefined && m.siteId === ctx.siteId && ctx.evidence.has(m.sourceEvidenceId);
}

/** Measurement records reachable from a set of cited IDs. */
export function recordsFor(ctx: SieContext, ids: readonly string[]): MeasurementRecord[] {
  const out: MeasurementRecord[] = [];
  for (const id of ids) {
    const m = ctx.measurements.get(id);
    if (m && m.siteId === ctx.siteId) out.push(m);
  }
  return out;
}
