import { randomUUID } from "node:crypto";
import type { EventType, NexusEvent } from "@nexus/schemas";

type Listener = (e: NexusEvent) => void;

/** In-process pub/sub behind the WebSocket hub. Events are per session (docs/EVENTS.md). */
export class EventBus {
  private listeners = new Set<Listener>();
  /** Recent events, so a reconnecting headset can catch up. */
  private recent: NexusEvent[] = [];

  emit(type: EventType, sessionId: string, correlationId: string, payload: unknown): NexusEvent {
    const e: NexusEvent = { id: randomUUID(), type, sessionId, occurredAt: new Date().toISOString(), correlationId, payload };
    this.recent.push(e);
    if (this.recent.length > 500) this.recent.shift();
    for (const l of this.listeners) l(e);
    return e;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  since(sessionId: string, afterId?: string): NexusEvent[] {
    const mine = this.recent.filter((e) => e.sessionId === sessionId);
    if (!afterId) return mine;
    const i = mine.findIndex((e) => e.id === afterId);
    return i < 0 ? mine : mine.slice(i + 1);
  }
}

/** Events other services may relay through POST /events (docs/EVENTS.md "Emitted by"). */
export const RELAYABLE: Readonly<Record<"orchestrator" | "voice-gateway", readonly EventType[]>> = {
  orchestrator: [
    "research.started",
    "agent.task.dispatched",
    "agent.task.completed",
    "agent.task.failed",
    "evidence.retrieved",
    "finding.generated",
    "speech.script.generated",
  ],
  "voice-gateway": [
    "voice.capture.started",
    "voice.transcript.partial",
    "voice.transcript.final",
    "voice.intent.resolved",
    "voice.reference.resolved",
    "voice.reference.clarification_required",
    "speech.script.generated",
    "debate.started",
    "debate.turn.completed",
    "debate.ended",
    "briefing.generated",
  ],
};

/** Events the XR client reports about playback (docs/EVENTS.md). */
export const XR_EVENTS: readonly EventType[] = [
  "observation.selected",
  "speech.playback.started",
  "speech.playback.interrupted",
  "speech.playback.completed",
];
