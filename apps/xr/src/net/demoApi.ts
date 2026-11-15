// Offline demo (ARCHITECTURE.md "Precomputed mode" and "Deployment": a precomputed bundle ships with the client so
// the core demo runs even if the backend is unreachable). Answers come from data/demo/bundle.json, which
// `pnpm demo:bundle` builds by replaying the precomputed research through the real API and SIE. So every finding shown
// here carries the SIE decision it was given; nothing in this file writes a claim, a number or an evidence ID.
// Reviews stay in this browser tab: they are still the scientist's own decisions (AGENTS.md rule 8), only not stored.
import { demoBundle } from "@nexus/schemas";
import type { DemoBundle, DemoSite, EventType, EvidenceItem, MeasurementRecord, NexusEvent, Observation, Result, ReviewDecision, ScientificFinding, SpatialAnchor } from "@nexus/schemas";
import type { HumanSession, LogbookEntry, NexusApi } from "./api.js";

/** Pacing of the replayed research run, in ms; tests pass 0 so it is instant. */
export interface DemoPacing {
  dispatchMs: number;
  perAgentMs: number;
  validateMs: number;
}

export const DEMO_PACING: DemoPacing = { dispatchMs: 500, perAgentMs: 550, validateMs: 700 };

export const DEMO_BUNDLE_PATH = `${import.meta.env.BASE_URL}demo/bundle.json`;

/** Loads and checks the bundle; a missing or malformed bundle means there is no offline demo, never a guessed one. */
export async function loadDemoBundle(url = DEMO_BUNDLE_PATH): Promise<Result<DemoBundle>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `bundle ${res.status}` };
    const parsed = demoBundle.safeParse(await res.json());
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "bundle failed validation" };
  } catch {
    return { ok: false, error: "bundle unreachable" };
  }
}

export class DemoApi implements NexusApi {
  session?: HumanSession;
  readonly offline = true;
  private readonly observations = new Map<string, Observation>();
  private readonly findings = new Map<string, ScientificFinding>();
  private readonly reviews: LogbookEntry[] = [];
  private readonly listeners = new Set<(e: NexusEvent) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;

  constructor(
    private readonly bundle: DemoBundle,
    private readonly pacing: DemoPacing = DEMO_PACING,
  ) {}

  async pair(_pairingCode: string, userId: string): Promise<Result<HumanSession>> {
    // No pairing code offline: nothing leaves the browser, so there is no service to authorise against.
    this.session = { token: "offline", sessionId: "OFFLINE-SESSION", userId };
    return { ok: true, value: this.session };
  }

  async createObservation(siteId: string, featureId: string | undefined, spatialAnchor: SpatialAnchor, description?: string): Promise<Result<Observation>> {
    const obs: Observation = {
      id: `OBS-OFFLINE-${++this.seq}`,
      siteId,
      source: "hand_select",
      featureId,
      spatialAnchor,
      description,
      createdBy: this.session?.userId ?? "scientist",
      createdAt: new Date().toISOString(),
    };
    this.observations.set(obs.id, obs);
    return { ok: true, value: obs };
  }

  async evidence(siteId: string): Promise<Result<{ items: EvidenceItem[]; measurements: MeasurementRecord[] }>> {
    const site = this.bundle.sites.find((s) => s.siteId === siteId);
    return site ? { ok: true, value: site.evidence } : { ok: false, error: "no offline evidence for this site" };
  }

  async getObservation(id: string): Promise<Result<Observation>> {
    const o = this.observations.get(id);
    return o ? { ok: true, value: o } : { ok: false, error: "api 404" };
  }

  async getFinding(id: string): Promise<Result<ScientificFinding>> {
    const f = this.findings.get(id);
    return f ? { ok: true, value: f } : { ok: false, error: "api 404" };
  }

  async listFindings(): Promise<Result<ScientificFinding[]>> {
    return { ok: true, value: [...this.findings.values()] };
  }

  async review(findingId: string, decision: ReviewDecision, rationaleText?: string): Promise<Result<ScientificFinding>> {
    const f = this.findings.get(findingId);
    // Same rule as services/api: only a finding awaiting review can be reviewed, and only by this human action.
    if (!f || f.status !== "ready_for_review") return { ok: false, error: "api 409" };
    const reviewedAt = new Date().toISOString();
    const updated: ScientificFinding = {
      ...f,
      status: decision === "approved" ? "reviewed" : decision,
      review: { decision, rationaleText, reviewerId: this.session?.userId ?? "scientist", reviewedAt },
      updatedAt: reviewedAt,
    };
    this.findings.set(f.id, updated);
    this.reviews.push({ review: { findingId: f.id, decision, rationaleText, reviewedAt }, finding: updated });
    const type: EventType = decision === "approved" ? "finding.approved" : decision === "rejected" ? "finding.rejected" : "finding.inconclusive";
    this.later(0, type, updated.observationId, { findingId: f.id });
    return { ok: true, value: updated };
  }

  async logbook(): Promise<Result<LogbookEntry[]>> {
    return { ok: true, value: [...this.reviews] };
  }

  async emit(type: EventType, correlationId: string, payload: unknown): Promise<Result<unknown>> {
    const p = (payload ?? {}) as { action?: unknown; featureId?: unknown };
    if (type === "observation.selected" && p.action === "investigate" && typeof p.featureId === "string") this.replay(correlationId, p.featureId);
    return { ok: true, value: undefined };
  }

  events(onEvent: (e: NexusEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  /** Cancels pending replay events (tests, leaving offline mode). */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }

  /** The research run as the orchestrator would report it, paced so the agent orbs can be watched working. */
  private replay(observationId: string, featureId: string): void {
    const site = this.bundle.sites.find((s) => s.featureId === featureId);
    const { dispatchMs, perAgentMs, validateMs } = this.pacing;
    if (!site) {
      // No precomputed research for this feature: say so through the normal failure path, never invent a finding.
      this.later(0, "research.started", observationId, { observationId, agentIds: [] });
      this.later(dispatchMs, "agent.task.failed", observationId, { agentId: "narrator", reason: "offline demo has no research for this feature", retry: false });
      return;
    }
    const agents = site.agentIds;
    this.later(0, "research.started", observationId, { observationId, agentIds: agents });
    agents.forEach((agentId, i) => this.later(dispatchMs, "agent.task.dispatched", observationId, { agentId, taskId: `TASK-OFFLINE-${i}` }));
    agents.forEach((agentId, i) => this.later(dispatchMs + (i + 1) * perAgentMs, "agent.task.completed", observationId, { agentId, taskId: `TASK-OFFLINE-${i}` }));
    const done = dispatchMs + (agents.length + 1) * perAgentMs;
    this.later(done, "finding.validation.completed", observationId, { findingId: site.finding.id, decision: site.finding.decision }, () => this.findings.set(site.finding.id, fresh(site)));
    this.later(done + validateMs, "finding.review.required", observationId, { findingId: site.finding.id });
  }

  private later(ms: number, type: EventType, correlationId: string, payload: unknown, before?: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      before?.();
      const e: NexusEvent = { id: crypto.randomUUID(), type, sessionId: this.session?.sessionId ?? "OFFLINE-SESSION", occurredAt: new Date().toISOString(), correlationId, payload };
      for (const l of this.listeners) l(e);
    }, ms);
    this.timers.add(t);
  }
}

/** A copy of the bundled finding, so a review in this tab never mutates the loaded bundle. */
function fresh(site: DemoSite): ScientificFinding {
  return structuredClone(site.finding);
}
