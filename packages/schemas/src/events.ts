import { z } from "zod";
import { isoTimestamp } from "./common.js";

/** Event catalog (docs/EVENTS.md). Names follow `domain.noun.verb`. */
export const eventType = z.enum([
  "observation.created",
  "observation.selected",
  "research.started",
  "agent.task.dispatched",
  "agent.task.completed",
  "agent.task.failed",
  "evidence.retrieved",
  "finding.generated",
  "finding.validation.completed",
  "finding.review.required",
  "finding.approved",
  "finding.rejected",
  "finding.inconclusive",
  "spatial.annotation.created",
  "voice.capture.started",
  "voice.transcript.partial",
  "voice.transcript.final",
  "voice.intent.resolved",
  "voice.reference.resolved",
  "voice.reference.clarification_required",
  "fieldnote.created",
  "speech.script.generated",
  "speech.script.validated",
  "speech.script.rewritten",
  "speech.playback.started",
  "speech.playback.interrupted",
  "speech.playback.completed",
  "debate.started",
  "debate.turn.completed",
  "debate.ended",
  "review.rationale.recorded",
  "briefing.generated",
]);
export type EventType = z.infer<typeof eventType>;

export function nexusEvent<T extends z.ZodTypeAny>(payload: T) {
  return z.object({
    id: z.string().uuid(),
    type: eventType,
    sessionId: z.string().min(1),
    occurredAt: isoTimestamp,
    /** observationId for research chains. */
    correlationId: z.string().min(1),
    payload,
  });
}

export const anyNexusEvent = nexusEvent(z.unknown());
export type NexusEvent<T = unknown> = Omit<z.infer<typeof anyNexusEvent>, "payload"> & { payload: T };
