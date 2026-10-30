// The gateway never writes to the database; it calls services/api, which validates (AGENTS.md §6).
import type { EventType, EvidenceItem, MeasurementRecord, FieldNote, Observation, Result, ScientificFinding, VoiceDecision, VoiceUtterance } from "@nexus/schemas";
import type { ValidationIssue } from "@nexus/sie";

export interface ScriptVerdict {
  decision: VoiceDecision;
  sieDecisionId: string;
  speechRate: number;
  issues: ValidationIssue[];
}

/** Calls made as the headset's human session use its token; the rest use the gateway's service token. */
export interface Api {
  createUtterance(humanToken: string, u: VoiceUtterance): Promise<Result<VoiceUtterance>>;
  recordOutgoing(u: VoiceUtterance): Promise<Result<VoiceUtterance>>;
  createObservation(humanToken: string, o: Omit<Observation, "id" | "createdBy" | "createdAt">): Promise<Result<Observation>>;
  createFieldNote(humanToken: string, n: Omit<FieldNote, "id" | "createdAt">): Promise<Result<FieldNote>>;
  review(
    humanToken: string,
    findingId: string,
    body: { decision: "approved" | "rejected" | "inconclusive"; rationaleText?: string; rationaleUtteranceId?: string },
  ): Promise<Result<ScientificFinding>>;
  getFinding(findingId: string): Promise<Result<ScientificFinding>>;
  getEvidence(siteId: string): Promise<Result<{ items: EvidenceItem[]; measurements: MeasurementRecord[] }>>;
  listFieldNotes(observationId: string): Promise<Result<FieldNote[]>>;
  validateScript(body: {
    sessionId: string;
    scriptId: string;
    findingId: string;
    script: string;
    sentenceEvidence: string[][];
    userRequestedSpeculation?: boolean;
    rewriteAttempted?: boolean;
  }): Promise<Result<ScriptVerdict>>;
  emit(type: EventType, sessionId: string, correlationId: string, payload: unknown): Promise<void>;
}

export class HttpApi implements Api {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  createUtterance(token: string, u: VoiceUtterance) {
    return this.call<VoiceUtterance>("POST", "/utterances", token, u);
  }
  recordOutgoing(u: VoiceUtterance) {
    return this.call<VoiceUtterance>("POST", "/utterances", this.serviceToken, u);
  }
  createObservation(token: string, o: Omit<Observation, "id" | "createdBy" | "createdAt">) {
    return this.call<Observation>("POST", "/observations", token, o);
  }
  createFieldNote(token: string, n: Omit<FieldNote, "id" | "createdAt">) {
    return this.call<FieldNote>("POST", "/field-notes", token, n);
  }
  review(token: string, findingId: string, body: object) {
    return this.call<ScientificFinding>("POST", `/findings/${encodeURIComponent(findingId)}/review`, token, body);
  }
  getFinding(findingId: string) {
    return this.call<ScientificFinding>("GET", `/findings/${encodeURIComponent(findingId)}`, this.serviceToken);
  }
  getEvidence(siteId: string) {
    return this.call<{ items: EvidenceItem[]; measurements: MeasurementRecord[] }>("GET", `/evidence/${encodeURIComponent(siteId)}`, this.serviceToken);
  }
  listFieldNotes(observationId: string) {
    return this.call<FieldNote[]>("GET", `/observations/${encodeURIComponent(observationId)}/field-notes`, this.serviceToken);
  }
  validateScript(body: object) {
    return this.call<ScriptVerdict>("POST", "/scripts/validate", this.serviceToken, body);
  }
  async emit(type: EventType, sessionId: string, correlationId: string, payload: unknown) {
    await this.call("POST", "/events", this.serviceToken, { type, sessionId, correlationId, payload });
  }

  private async call<T>(method: string, path: string, token: string, body?: unknown): Promise<Result<T>> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; value?: T; error?: unknown };
      // Typed results only; never pass raw upstream errors through to the headset (AGENTS.md §7).
      return json.ok ? { ok: true, value: json.value as T } : { ok: false, error: `api ${res.status}` };
    } catch {
      return { ok: false, error: "api unreachable" };
    }
  }
}
