// Listens to services/api events and starts research runs, one at a time (AGENTS.md §10: never run all agents at once).
import WebSocket from "ws";
import { anyNexusEvent } from "@nexus/schemas";
import type { NexusEvent } from "@nexus/schemas";
import type { RunDeps } from "./researchRun.js";
import { runResearch } from "./researchRun.js";

export interface DispatchState {
  running?: string;
  queued: string[];
  completed: number;
  failed: number;
}

export class Dispatcher {
  readonly state: DispatchState = { queued: [], completed: 0, failed: 0 };
  private queue: { observationId: string; sessionId: string }[] = [];
  private seen = new Set<string>();
  private busy = false;

  constructor(private readonly deps: RunDeps) {}

  /** Decide whether an event should start research. */
  onEvent(e: NexusEvent): void {
    const p = e.payload;
    if (e.type === "observation.created" && isObject(p) && isObject(p.observation)) {
      // Spoken notes and video marks start research straight away (ARCHITECTURE.md step 5–6);
      // a hand selection waits for the scientist to poke Investigate.
      const o = p.observation;
      if ((o.source === "field_note" || o.source === "video_mark") && typeof o.id === "string") this.enqueue(o.id, e.sessionId);
    }
    if (e.type === "observation.selected" && isObject(p) && p.action === "investigate" && typeof p.observationId === "string") {
      this.enqueue(p.observationId, e.sessionId);
    }
  }

  enqueue(observationId: string, sessionId: string): void {
    if (this.seen.has(observationId)) return;
    this.seen.add(observationId);
    this.queue.push({ observationId, sessionId });
    this.state.queued = this.queue.map((q) => q.observationId);
    void this.drain();
  }

  /** Resolves when the queue is empty; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.busy || this.queue.length > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        this.state.queued = this.queue.map((q) => q.observationId);
        this.state.running = next.observationId;
        const res = await runResearch(next.observationId, next.sessionId, this.deps).catch(() => ({ ok: false as const, error: "run crashed" }));
        if (res.ok) this.state.completed++;
        else {
          this.state.failed++;
          // Let the scientist retry Investigate after a failure.
          this.seen.delete(next.observationId);
        }
        this.state.running = undefined;
      }
    } finally {
      this.busy = false;
    }
  }
}

/** Subscribe to the API's event stream with the orchestrator's service token; reconnects with backoff. */
export function listen(url: string, token: string, onEvent: (e: NexusEvent) => void, log: (msg: string) => void): () => void {
  let stopped = false;
  let delay = 1000;
  let ws: WebSocket | undefined;
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.on("open", () => {
      delay = 1000;
      ws?.send(JSON.stringify({ type: "auth", token }));
    });
    ws.on("message", (data: Buffer) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return;
      }
      const e = anyNexusEvent.safeParse(raw);
      if (e.success) onEvent(e.data as NexusEvent);
    });
    ws.on("close", () => {
      if (stopped) return;
      log(`event stream closed; reconnecting in ${delay} ms`);
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    ws.on("error", () => ws?.close());
  };
  connect();
  return () => {
    stopped = true;
    ws?.close();
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
