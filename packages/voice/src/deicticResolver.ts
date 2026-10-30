// Deictic grounding (VOICE.md §4, PRD §6.3): resolve "this / that / here / there / it" from word timestamps,
// hand ray and head direction. Never resolves silently below the threshold (SIE VR1).
import { DEICTIC_CONFIDENCE_THRESHOLD } from "@nexus/schemas";
import type { FieldNote } from "@nexus/schemas";
import { referenceNeedsClarificationFallback } from "@nexus/sie";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

/** 30 Hz pointing samples on the same clock as the audio (VOICE.md §2). */
export interface PointerSample {
  tMs: number;
  /** Labelled feature under the ray, if any. */
  rayFeatureId?: string;
  rayPoint?: Vec3;
  /** Ray is on a UI panel, not terrain. */
  onUi: boolean;
  headPosition: Vec3;
  headDirection: Vec3;
}

export interface CandidateFeature {
  id: string;
  spokenLabel: string;
  aliases: readonly string[];
  /** Scene position of the feature's label point. */
  position: Vec3;
  /** Relative size and albedo, 0..1 within the site, for "bigger" / "darker" qualifiers. */
  size?: number;
  albedo?: number;
}

export interface ScoredCandidate {
  featureId: string;
  score: number;
}

export type ReferenceResolution =
  | {
      status: "resolved";
      featureId: string;
      confidence: number;
      method: FieldNote["reference"]["method"];
      candidates: ScoredCandidate[];
      /** Mean ray hit on terrain during the deictic word, for the FieldNote's sceneLocal anchor. */
      point?: Vec3;
    }
  | { status: "clarify"; candidates: ScoredCandidate[]; method: FieldNote["reference"]["method"] }
  | { status: "none" };

export const DEICTIC_WORDS = new Set(["this", "that", "here", "there", "it", "these", "those"]);
/** Ray samples within ±150 ms of the deictic word count (VOICE.md §4 step 1). */
export const RAY_WINDOW_MS = 150;
/** Head-direction cone used when the ray is empty or on UI (step 2). */
export const HEAD_CONE_DEG = 8;
/** Qualifiers apply to labelled features within this distance of the hit, scene units (step 3). */
export const QUALIFIER_RADIUS = 2;

const SPATIAL = /\b(left|right)\b/;
const SIZE = /\b(bigger|larger|biggest|largest|smaller|smallest)\b/;
const SHADE = /\b(darker|darkest|brighter|brightest|lighter|lightest)\b/;

export function resolveReference(
  words: readonly WordTiming[],
  samples: readonly PointerSample[],
  features: readonly CandidateFeature[],
): ReferenceResolution {
  const transcript = words.map((w) => w.text).join(" ").toLowerCase();
  const deictic = words.filter((w) => DEICTIC_WORDS.has(w.text.toLowerCase().replace(/[^a-z]/g, "")));
  const named = features.filter((f) => mentions(transcript, f));
  if (deictic.length === 0 && named.length === 0) return { status: "none" };

  const scores = new Map<string, number>();
  let method: FieldNote["reference"]["method"] = "ray";
  const window = samplesNear(samples, deictic.length > 0 ? deictic : words.slice(0, 1));
  const onTerrain = window.filter((s) => !s.onUi && (s.rayFeatureId !== undefined || s.rayPoint !== undefined));
  const hitPoint = average(onTerrain.map((s) => s.rayPoint).filter((p): p is Vec3 => p !== undefined));

  if (onTerrain.length > 0) {
    const hits = new Map<string, number>();
    for (const s of onTerrain) if (s.rayFeatureId) hits.set(s.rayFeatureId, (hits.get(s.rayFeatureId) ?? 0) + 1);
    for (const f of features) {
      const share = (hits.get(f.id) ?? 0) / onTerrain.length;
      const near = hitPoint ? Math.max(0, 1 - distance(hitPoint, f.position) / QUALIFIER_RADIUS) : 0;
      const score = 0.85 * share + 0.15 * near;
      if (score > 0) scores.set(f.id, score);
    }
  } else if (window.length > 0) {
    // Head cone alone tops out at 0.7, so without a qualifier it always asks.
    method = "ray+gaze";
    const head = window[Math.floor(window.length / 2)] as PointerSample;
    for (const f of features) {
      const angle = angleDeg(head.headDirection, sub(f.position, head.headPosition));
      if (angle <= HEAD_CONE_DEG) scores.set(f.id, 0.7 * (1 - angle / HEAD_CONE_DEG));
    }
  }

  // Qualifiers and names.
  const qualified = applyQualifiers(transcript, features, scores, window[0]);
  if (qualified || named.length > 0) method = "ray+gaze+qualifier";
  for (const f of named) scores.set(f.id, Math.min(1, (scores.get(f.id) ?? 0.55) + 0.25));

  const candidates = [...scores.entries()]
    .map(([featureId, score]) => ({ featureId, score: round(Math.min(1, Math.max(0, score))) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (!top) return { status: "none" };
  if (referenceNeedsClarificationFallback({ scores: candidates.map((c) => c.score) })) {
    return { status: "clarify", candidates: candidates.slice(0, 2), method };
  }
  return { status: "resolved", featureId: top.featureId, confidence: top.score, method, candidates, point: hitPoint };
}

/** A chip or spoken name answering a clarification. Manual choice is certain by definition. */
export function resolveClarification(answer: string, candidates: readonly CandidateFeature[]): string | undefined {
  const text = answer.toLowerCase();
  const hits = candidates.filter((f) => mentions(text, f));
  return hits.length === 1 ? hits[0]?.id : undefined;
}

export { DEICTIC_CONFIDENCE_THRESHOLD };

function applyQualifiers(
  transcript: string,
  features: readonly CandidateFeature[],
  scores: Map<string, number>,
  sample: PointerSample | undefined,
): boolean {
  const pool = features.filter((f) => scores.has(f.id));
  if (pool.length < 2) return false;
  let applied = false;
  const boost = (pick: CandidateFeature | undefined) => {
    if (!pick) return;
    applied = true;
    for (const f of pool) scores.set(f.id, (scores.get(f.id) ?? 0) + (f.id === pick.id ? 0.3 : -0.2));
  };

  const side = transcript.match(SPATIAL)?.[1];
  if (side && sample) {
    // Project onto the head's right vector (y up): positive = to the user's right.
    const d = sample.headDirection;
    const right = { x: -d.z, y: 0, z: d.x };
    const lateral = (f: CandidateFeature) => dot(sub(f.position, sample.headPosition), right);
    boost(extreme(pool, lateral, side === "right"));
  }
  const size = transcript.match(SIZE)?.[1];
  if (size && pool.every((f) => f.size !== undefined)) boost(extreme(pool, (f) => f.size ?? 0, /big|larg/.test(size)));
  const shade = transcript.match(SHADE)?.[1];
  if (shade && pool.every((f) => f.albedo !== undefined)) boost(extreme(pool, (f) => f.albedo ?? 0, !/dark/.test(shade)));
  return applied;
}

function extreme(pool: readonly CandidateFeature[], key: (f: CandidateFeature) => number, max: boolean): CandidateFeature | undefined {
  return [...pool].sort((a, b) => (max ? key(b) - key(a) : key(a) - key(b)))[0];
}

function mentions(text: string, f: CandidateFeature): boolean {
  return [f.spokenLabel, ...f.aliases].some((name) => {
    const n = name.toLowerCase().replace(/^the /, "").trim();
    return n.length > 0 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
  });
}

function samplesNear(samples: readonly PointerSample[], words: readonly WordTiming[]): PointerSample[] {
  return samples.filter((s) => words.some((w) => s.tMs >= w.startMs - RAY_WINDOW_MS && s.tMs <= w.endMs + RAY_WINDOW_MS));
}

function average(ps: readonly Vec3[]): Vec3 | undefined {
  if (ps.length === 0) return undefined;
  const s = ps.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  return { x: s.x / ps.length, y: s.y / ps.length, z: s.z / ps.length };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const distance = (a: Vec3, b: Vec3) => len(sub(a, b));

function angleDeg(a: Vec3, b: Vec3): number {
  const l = len(a) * len(b);
  if (l === 0) return 180;
  return (Math.acos(Math.min(1, Math.max(-1, dot(a, b) / l))) * 180) / Math.PI;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
