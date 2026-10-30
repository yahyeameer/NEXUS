import type { FieldNote, Observation, ReviewRecord, ScientificFinding, SieDecisionRecord, VoiceUtterance } from "@nexus/schemas";

export type { ReviewRecord };

/**
 * Persistence for services/api. Only this service writes; agents and the voice gateway go through
 * validated endpoints (AGENTS.md §6 "Events, not direct writes").
 */
export interface Store {
  createObservation(o: Observation): Promise<void>;
  getObservation(id: string): Promise<Observation | undefined>;
  createUtterance(u: VoiceUtterance): Promise<void>;
  getUtterance(id: string): Promise<VoiceUtterance | undefined>;
  createFieldNote(n: FieldNote): Promise<void>;
  listFieldNotes(observationId: string): Promise<FieldNote[]>;
  saveFinding(f: ScientificFinding): Promise<void>;
  getFinding(id: string): Promise<ScientificFinding | undefined>;
  listFindings(filter: { observationId?: string }): Promise<ScientificFinding[]>;
  /**
   * Apply a human review only if the finding is still awaiting one. Returns the updated finding,
   * or undefined if it was not awaiting review (so two reviews cannot race).
   */
  applyReview(review: ReviewRecord): Promise<ScientificFinding | undefined>;
  listReviews(sessionId: string): Promise<ReviewRecord[]>;
  /** Append-only (SCIENTIFIC_INTEGRITY.md §6). */
  appendSieDecision(r: SieDecisionRecord): Promise<void>;
  getSieDecision(id: string): Promise<SieDecisionRecord | undefined>;
  close(): Promise<void>;
}

/** Review decision → finding status. Only this mapping may produce "reviewed" (AGENTS.md rule 8). */
export function statusAfterReview(decision: ReviewRecord["decision"]): ScientificFinding["status"] {
  return decision === "approved" ? "reviewed" : decision;
}

export function withReview(f: ScientificFinding, r: ReviewRecord): ScientificFinding {
  return {
    ...f,
    status: statusAfterReview(r.decision),
    review: {
      decision: r.decision,
      rationaleText: r.rationaleText,
      rationaleUtteranceId: r.rationaleUtteranceId,
      reviewerId: r.reviewerId,
      reviewedAt: r.reviewedAt,
    },
    updatedAt: r.reviewedAt,
  };
}

/** In-memory store for tests, precomputed mode and running without Postgres. */
export class MemoryStore implements Store {
  private observations = new Map<string, Observation>();
  private utterances = new Map<string, VoiceUtterance>();
  private fieldNotes: FieldNote[] = [];
  private findings = new Map<string, ScientificFinding>();
  private reviews: ReviewRecord[] = [];
  private decisions = new Map<string, SieDecisionRecord>();

  async createObservation(o: Observation) {
    this.observations.set(o.id, o);
  }
  async getObservation(id: string) {
    return this.observations.get(id);
  }
  async createUtterance(u: VoiceUtterance) {
    this.utterances.set(u.id, u);
  }
  async getUtterance(id: string) {
    return this.utterances.get(id);
  }
  async createFieldNote(n: FieldNote) {
    this.fieldNotes.push(n);
  }
  async listFieldNotes(observationId: string) {
    return this.fieldNotes.filter((n) => n.observationId === observationId);
  }
  async saveFinding(f: ScientificFinding) {
    this.findings.set(f.id, f);
  }
  async getFinding(id: string) {
    return this.findings.get(id);
  }
  async listFindings(filter: { observationId?: string }) {
    return [...this.findings.values()].filter((f) => !filter.observationId || f.observationId === filter.observationId);
  }
  async applyReview(r: ReviewRecord) {
    const f = this.findings.get(r.findingId);
    if (!f || f.status !== "ready_for_review") return undefined;
    const updated = withReview(f, r);
    this.findings.set(f.id, updated);
    this.reviews.push(r);
    return updated;
  }
  async listReviews(sessionId: string) {
    return this.reviews.filter((r) => r.sessionId === sessionId);
  }
  async appendSieDecision(r: SieDecisionRecord) {
    if (this.decisions.has(r.id)) throw new Error(`sie decision ${r.id} already exists (append-only)`);
    this.decisions.set(r.id, r);
  }
  async getSieDecision(id: string) {
    return this.decisions.get(id);
  }
  async close() {}
}
