# Events

All realtime communication is event-driven over WebSocket via `services/api`. Event names follow `domain.noun.verb`. Payloads are zod-validated (`packages/schemas/events.ts`).

## Envelope

```ts
interface NexusEvent<T> {
  id: string;            // uuid
  type: string;          // e.g. "finding.review.required"
  sessionId: string;
  occurredAt: string;
  correlationId: string; // observationId for research chains
  payload: T;
}
```

## Catalog

| Event | Emitted by | Key payload |
| --- | --- | --- |
| `observation.created` | api | observation |
| `observation.selected` | xr | observationId |
| `research.started` | orchestrator | observationId, agentIds |
| `agent.task.dispatched` | orchestrator | agentId, taskId |
| `agent.task.completed` | orchestrator | agentId, taskId, outputRef |
| `agent.task.failed` | orchestrator | agentId, taskId, reason, retry |
| `evidence.retrieved` | orchestrator | evidenceIds |
| `finding.generated` | orchestrator | findingId (draft) |
| `finding.validation.completed` | sie | findingId, decision |
| `finding.review.required` | api | findingId |
| `finding.approved` | api | findingId, reviewerId |
| `finding.rejected` | api | findingId, reviewerId |
| `finding.inconclusive` | api | findingId, reviewerId |
| `spatial.annotation.created` | api | findingId, anchor |
| `voice.capture.started` | voice-gateway | utteranceId |
| `voice.transcript.partial` | voice-gateway | utteranceId, text |
| `voice.transcript.final` | voice-gateway | utteranceId, text, words |
| `voice.intent.resolved` | voice-gateway | utteranceId, intent |
| `voice.reference.resolved` | voice-gateway | utteranceId, featureId, confidence |
| `voice.reference.clarification_required` | voice-gateway | utteranceId, candidates |
| `fieldnote.created` | api | fieldNote |
| `speech.script.generated` | voice-gateway / orchestrator | scriptId, speakerAgentId |
| `speech.script.validated` | sie | scriptId, voiceDecision |
| `speech.script.rewritten` | sie | scriptId, attempt |
| `speech.playback.started` | xr | scriptId |
| `speech.playback.interrupted` | xr | scriptId, by |
| `speech.playback.completed` | xr | scriptId |
| `debate.started` / `debate.turn.completed` / `debate.ended` | voice-gateway | debateId, turn |
| `review.rationale.recorded` | api | findingId, utteranceId |
| `briefing.generated` | voice-gateway | sessionId, scriptId |

## Ordering guarantees

- `speech.playback.started` must follow `speech.script.validated` with `SPEAK_AS_APPROVED` for the same `scriptId`. The XR client refuses to play any other script (except system phrases).
- `finding.review.required` only after `finding.validation.completed` with `ACCEPT_FOR_REVIEW` or `ESCALATE_TO_SCIENTIST`.
- `finding.approved` / `rejected` / `inconclusive` only from a human-originated request (authenticated user session, never an agent token).
