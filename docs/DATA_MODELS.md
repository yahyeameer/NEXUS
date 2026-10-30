# Data Models

Source of truth: zod schemas in `packages/schemas`. The TypeScript below mirrors them. All timestamps are ISO-8601 UTC. All coordinates carry a CRS.

## Observation

```ts
interface Observation {
  id: string;                         // OBS-xxxx
  siteId: string;                     // e.g. "HADLEY_RILLE"
  source: "hand_select" | "field_note" | "video_mark";
  featureId?: string;                 // labelled terrain feature
  spatialAnchor: SpatialAnchor;
  frameRef?: { videoId: string; timestampMs: number; imageUrl: string };
  telemetry?: { simulated: true; label: string };  // simulated data must say so
  description?: string;
  createdBy: string;                  // user id
  createdAt: string;
}

interface SpatialAnchor {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  coordinateReferenceSystem?: string; // required if lat/lon present
  terrainFeatureId?: string;
  sceneLocal?: { x: number; y: number; z: number }; // tile-local metres
}
```

## FieldNote

```ts
interface FieldNote {
  id: string;
  observationId: string;
  utteranceId: string;
  transcript: string;                 // verbatim
  language: string;                   // BCP-47
  descriptors: string[];              // only words the user said
  reference: {
    method: "ray" | "ray+gaze" | "ray+gaze+qualifier" | "manual";
    confidence: number;               // 0..1, must be >= 0.75 to anchor
    clarificationAsked: boolean;
    targetFeatureId?: string;
  };
  spatialAnchor: SpatialAnchor;
  createdAt: string;
}
```

## EvidenceItem (evidence packs)

```ts
interface EvidenceItem {
  id: string;                         // EV-<SITE>-NNN
  siteId: string;
  type: "image" | "measurement" | "text" | "dataset";
  title: string;
  spokenLabel: string;                // short pronounceable label
  dataset?: string;                   // e.g. "LRO LOLA"
  productId?: string;                 // exact product identifier
  sourceUrl: string;                  // must resolve; verified by #32
  acquiredAt?: string;
  excerpt?: string;                   // short excerpt for text sources (< 60 words)
  region?: { featureId?: string; bbox?: [number, number, number, number]; crs?: string };
  credit: string;
  license: string;
}
```

## MeasurementRecord (computed by `packages/terrain`, never by models)

```ts
interface MeasurementRecord {
  id: string;                         // MEAS-xxxx, also usable as evidence ID
  siteId: string;
  featureId: string;
  quantity: "depth" | "width" | "diameter" | "slope" | "elevation" | "length";
  value: number;
  unit: "m" | "km" | "deg";
  method: string;                     // e.g. "rim-to-floor max difference on DEM profile"
  sourceEvidenceId: string;           // DEM evidence item
  computedAt: string;
}
```

## AgentOutput (every Docker Agent team member)

```ts
interface AgentOutput {
  agentId: string;                    // catalog id, e.g. "26_lola_elevation_researcher"
  observationId: string;
  claims: {
    text: string;
    claimType: "observation" | "measurement" | "interpretation" | "hypothesis";
    evidenceIds: string[];            // must exist
    contradictingEvidenceIds?: string[];
    measurementIds?: string[];        // for any number in text
  }[];
  openQuestions?: string[];
  uncertainty?: { level: "low" | "medium" | "high"; explanation: string };
  notes?: string;                     // not shown to users
}
```

## ScientificFinding

```ts
interface ScientificFinding {
  id: string;
  observationId: string;
  title: string;
  summary: string;
  claimType: "observation" | "measurement" | "interpretation" | "hypothesis";
  claims: AgentOutput["claims"];
  removedClaims: { text: string; reason: string }[];   // shown as "Removed: no evidence"
  possibleInterpretations: {
    explanation: string;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }[];
  sources: { dataset: string; sourceUrl: string; evidenceId: string; observationId?: string }[];
  spatialAnchor: SpatialAnchor;
  uncertainty: { level: "low" | "medium" | "high"; explanation: string };
  contested: boolean;
  decision: {
    outcome: "ACCEPT_FOR_REVIEW" | "REQUEST_MORE_EVIDENCE" | "REJECT" | "ESCALATE_TO_SCIENTIST";
    reason: string;
    source: "jev" | "fallback";
  };
  status: "researching" | "ready_for_review" | "reviewed" | "rejected" | "inconclusive";
  spokenBriefing?: {
    script: string;
    sentenceEvidence: string[][];     // evidence IDs per sentence
    voiceDecision: "SPEAK_AS_APPROVED" | "REWRITE_SCRIPT" | "SILENT_CARD_ONLY";
    audioRef?: string;
    speakerAgentId: string;
  };
  debateTranscriptId?: string;
  review?: {
    decision: "approved" | "rejected" | "inconclusive";
    rationaleText?: string;           // verbatim
    rationaleUtteranceId?: string;
    reviewerId: string;
    reviewedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

## VoiceUtterance

```ts
interface VoiceUtterance {
  id: string;
  sessionId: string;
  speaker: "scientist" | "narrator" | `agent:${string}`;
  direction: "in" | "out";
  intent?: "command" | "field_note" | "question" | "review" | "debate" | "clarification";
  transcript: string;
  words?: { text: string; startMs: number; endMs: number }[];
  sttConfidence?: number;
  audioRef?: string;                  // opt-in only
  language: string;
  sieDecisionId?: string;             // required for direction "out" unless system phrase
  systemPhraseId?: string;
  createdAt: string;
}
```

## Database tables (Postgres + PostGIS)

`observations`, `field_notes`, `evidence_items`, `measurements`, `agent_runs`, `agent_outputs`, `findings`, `sie_decisions` (append-only), `utterances`, `reviews`, `debates`, `sessions`, `logbook_entries`.
Spatial columns use `geography(PointZ, <lunar SRID>)` where a lunar CRS is configured; otherwise store `sceneLocal` + `terrainFeatureId` only.
