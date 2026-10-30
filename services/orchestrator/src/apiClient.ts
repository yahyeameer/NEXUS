import type { EventType, FieldNote, Observation, Result, ScientificFinding, VoiceDecision } from "@nexus/schemas";
import type { RejectedOutput } from "@nexus/sie";

export interface ResearchResponse {
  finding: ScientificFinding;
  sieDecisionId: string;
  voiceDecisionId: string;
  rejectedOutputs: RejectedOutput[];
}

/** The orchestrator never writes to the database; services/api validates and runs the SIE (AGENTS.md §6). */
export interface Api {
  getObservation(id: string): Promise<Result<Observation>>;
  listFieldNotes(observationId: string): Promise<Result<FieldNote[]>>;
  submitResearch(observationId: string, body: { sessionId: string; agentOutputs: unknown[]; synthesis: unknown; briefingRewriteAttempted?: boolean }): Promise<Result<ResearchResponse, { status: number; issues?: unknown }>>;
  validateBriefing(body: {
    sessionId: string;
    scriptId: string;
    findingId: string;
    script: string;
    sentenceEvidence: string[][];
    speakerAgentId: string;
  }): Promise<Result<{ decision: VoiceDecision }>>;
  emit(type: EventType, sessionId: string, correlationId: string, payload: unknown): Promise<void>;
}

export class HttpApi implements Api {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async getObservation(id: string) {
    return this.simple<Observation>("GET", `/observations/${encodeURIComponent(id)}`);
  }
  async listFieldNotes(observationId: string) {
    return this.simple<FieldNote[]>("GET", `/observations/${encodeURIComponent(observationId)}/field-notes`);
  }
  async submitResearch(observationId: string, body: object): Promise<Result<ResearchResponse, { status: number; issues?: unknown }>> {
    const r = await this.call(`/observations/${encodeURIComponent(observationId)}/research`, "POST", body);
    if (!r) return { ok: false, error: { status: 0 } };
    return r.json.ok ? { ok: true, value: r.json.value as ResearchResponse } : { ok: false, error: { status: r.status, issues: r.json.issues } };
  }
  async validateBriefing(body: object) {
    return this.simple<{ decision: VoiceDecision }>("POST", "/scripts/validate", { ...body, isBriefing: true, rewriteAttempted: true });
  }
  async emit(type: EventType, sessionId: string, correlationId: string, payload: unknown) {
    await this.call("/events", "POST", { type, sessionId, correlationId, payload });
  }

  private async simple<T>(method: string, path: string, body?: object): Promise<Result<T>> {
    const r = await this.call(path, method, body);
    if (!r) return { ok: false, error: "api unreachable" };
    return r.json.ok ? { ok: true, value: r.json.value as T } : { ok: false, error: `api ${r.status}` };
  }

  private async call(path: string, method: string, body?: unknown): Promise<{ status: number; json: { ok: boolean; value?: unknown; issues?: unknown } } | undefined> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as { ok: boolean; value?: unknown; issues?: unknown } };
    } catch {
      return undefined;
    }
  }
}
