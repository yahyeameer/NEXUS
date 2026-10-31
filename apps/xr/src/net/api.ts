// Headset ↔ services/api. Typed results, never raw errors (AGENTS.md §7). Responses are parsed with the shared zod
// schemas, so the client only renders what the API actually returned.
import { anyNexusEvent, evidenceItem, measurementRecord, observation, scientificFinding } from "@nexus/schemas";
import type { EvidenceItem, EventType, MeasurementRecord, NexusEvent, Observation, Result, ReviewDecision, ScientificFinding, SpatialAnchor } from "@nexus/schemas";
import { z } from "zod";
import { API_BASE, wsUrl } from "../config.js";

export interface HumanSession {
  token: string;
  sessionId: string;
  userId: string;
}

const sessionValue = z.object({ token: z.string(), sessionId: z.string() });
const envelope = z.object({ ok: z.boolean(), value: z.unknown().optional(), error: z.unknown().optional() });
const logbookEntry = z.object({
  review: z.object({ findingId: z.string(), decision: z.string(), rationaleText: z.string().optional(), reviewedAt: z.string() }),
  finding: scientificFinding.optional(),
});
export type LogbookEntry = z.infer<typeof logbookEntry>;

export class ApiClient {
  session?: HumanSession;

  async pair(pairingCode: string, userId: string): Promise<Result<HumanSession>> {
    const r = await this.call("POST", "/sessions", { pairingCode, userId }, sessionValue);
    if (r.ok) this.session = { ...r.value, userId };
    return r.ok ? { ok: true, value: { ...r.value, userId } } : r;
  }

  createObservation(siteId: string, featureId: string | undefined, spatialAnchor: SpatialAnchor, description?: string): Promise<Result<Observation>> {
    return this.call("POST", "/observations", { siteId, source: "hand_select", featureId, spatialAnchor, description }, observation);
  }

  /** The site's curated evidence and code-computed measurements, for evidence windows. */
  evidence(siteId: string): Promise<Result<{ items: EvidenceItem[]; measurements: MeasurementRecord[] }>> {
    return this.call("GET", `/evidence/${encodeURIComponent(siteId)}`, undefined, z.object({ items: z.array(evidenceItem), measurements: z.array(measurementRecord) }));
  }

  getObservation(id: string): Promise<Result<Observation>> {
    return this.call("GET", `/observations/${encodeURIComponent(id)}`, undefined, observation);
  }

  getFinding(id: string): Promise<Result<ScientificFinding>> {
    return this.call("GET", `/findings/${encodeURIComponent(id)}`, undefined, scientificFinding);
  }

  listFindings(): Promise<Result<ScientificFinding[]>> {
    return this.call("GET", "/findings", undefined, z.array(scientificFinding));
  }

  review(findingId: string, decision: ReviewDecision, rationaleText?: string): Promise<Result<ScientificFinding>> {
    return this.call("POST", `/findings/${encodeURIComponent(findingId)}/review`, { decision, rationaleText }, scientificFinding);
  }

  logbook(): Promise<Result<LogbookEntry[]>> {
    return this.call("GET", "/logbook", undefined, z.array(logbookEntry));
  }

  /** Only XR events (observation.selected, speech.playback.*): the API refuses anything else from a headset. */
  async emit(type: EventType, correlationId: string, payload: unknown): Promise<Result<unknown>> {
    return this.call("POST", "/events", { type, correlationId, payload }, z.unknown());
  }

  /** Session event stream; resumes after the last seen event on reconnect. Returns a stop function. */
  events(onEvent: (e: NexusEvent) => void): () => void {
    let stopped = false;
    let last: string | undefined;
    let socket: WebSocket | undefined;
    let delay = 500;
    const open = () => {
      const s = this.session;
      if (stopped || !s) return;
      socket = new WebSocket(wsUrl(`${API_BASE}/events`));
      socket.onopen = () => {
        delay = 500;
        socket?.send(JSON.stringify({ type: "auth", token: s.token, after: last }));
      };
      socket.onmessage = (m) => {
        const e = anyNexusEvent.safeParse(safeJson(String(m.data)));
        if (!e.success) return;
        last = e.data.id;
        onEvent({ ...e.data, payload: e.data.payload });
      };
      socket.onclose = () => {
        if (stopped) return;
        setTimeout(open, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    open();
    return () => {
      stopped = true;
      socket?.close();
    };
  }

  private async call<T>(method: "GET" | "POST", path: string, body: unknown, schema: z.ZodType<T>): Promise<Result<T>> {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.session ? { authorization: `Bearer ${this.session.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const env = envelope.safeParse(await res.json().catch(() => undefined));
      if (!env.success || !env.data.ok) return { ok: false, error: `api ${res.status}` };
      const value = schema.safeParse(env.data.value);
      return value.success ? { ok: true, value: value.data } : { ok: false, error: "unexpected response" };
    } catch {
      return { ok: false, error: "api unreachable" };
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
