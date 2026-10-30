// One headset's voice session: push-to-talk → STT → intent → action, and SIE-approved speech back out.
// PRD §6, VOICE.md §2–§5, §8, §11. Every voice action here has a hand equivalent in the XR client (AGENTS.md rule 1).
import { randomUUID } from "node:crypto";
import type { candidateFeature, pointerSample } from "@nexus/schemas";
import type { FieldNote, VoiceClientMessage, VoiceServerMessage, VoiceUtterance } from "@nexus/schemas";
import { extractDescriptors, resolveClarification, resolveReference, routeIntent, systemPhrases, voiceFor } from "@nexus/voice";
import type { ReferenceResolution, SiteName, SystemPhraseId } from "@nexus/voice";
import type { z } from "zod";
import type { ReasoningAdapter, SpokenAnswer } from "./adapters/reasoningAdapter.js";
import { fieldNoteInterpretation, spokenAnswer } from "./adapters/reasoningAdapter.js";
import type { SpeechToTextAdapter, SttResult, SttStream, TextToSpeechAdapter } from "./adapters/speechAdapter.js";
import type { Api } from "./apiClient.js";

type Candidate = z.infer<typeof candidateFeature>;
type Sample = z.infer<typeof pointerSample>;

/** VOICE.md §11: below this STT confidence, show the transcript and ask instead of acting. */
export const LOW_STT_CONFIDENCE = 0.6;
const SPECULATION_REQUEST = /\b(speculate|speculating|your best guess|guess)\b/i;

export interface SessionDeps {
  api: Api;
  stt: SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
  reasoning?: ReasoningAdapter;
  send: (m: VoiceServerMessage) => void;
}

interface PendingClarification {
  utterance: VoiceUtterance;
  candidates: Candidate[];
  method: FieldNote["reference"]["method"];
  point?: { x: number; y: number; z: number };
}

export class VoiceSession {
  private auth?: { token: string; sessionId: string };
  private siteId?: string;
  private sites: SiteName[] = [];
  private selectedFindingId?: string;
  private candidates: Candidate[] = [];
  private language = "en";
  private stream?: SttStream;
  private samples: Sample[] = [];
  private pending?: PendingClarification;

  constructor(private readonly deps: SessionDeps) {}

  get authenticated(): boolean {
    return this.auth !== undefined;
  }

  async handle(msg: VoiceClientMessage): Promise<void> {
    if (msg.type === "auth") {
      this.auth = { token: msg.token, sessionId: msg.sessionId };
      this.deps.send({ type: "ready" });
      return;
    }
    if (!this.auth) return this.deps.send({ type: "error", message: "unauthenticated" });
    switch (msg.type) {
      case "context":
        this.siteId = msg.siteId;
        this.sites = msg.sites;
        this.selectedFindingId = msg.selectedFindingId;
        this.candidates = msg.candidates;
        this.language = msg.language;
        return;
      case "ptt.start":
        // Push-to-talk only: the mic stream exists between start and end (AGENTS.md rule 9).
        this.samples = [];
        this.stream = this.deps.stt.open({
          language: this.language,
          sampleRateHz: msg.sampleRateHz,
          onPartial: (text) => this.deps.send({ type: "transcript", utteranceId: "partial", text, final: false }),
        });
        return;
      case "pointer":
        this.samples.push(...msg.samples);
        return;
      case "ptt.end":
        return this.finishUtterance();
      case "clarify.choose":
        return this.completeClarification(msg.featureId);
    }
  }

  /** Raw audio frames. Never stored or logged here; raw audio needs explicit opt-in (SECURITY_PRIVACY.md). */
  audio(chunk: Uint8Array): void {
    this.stream?.write(chunk);
  }

  private async finishUtterance(): Promise<void> {
    const stream = this.stream;
    this.stream = undefined;
    if (!stream || !this.auth) return;
    const res = await stream.end();
    if (!res.ok || res.value.transcript.trim() === "") return this.sayPhrase("didNotCatch");
    const stt = res.value;
    const utterance: VoiceUtterance = {
      id: `U-${randomUUID()}`,
      sessionId: this.auth.sessionId,
      speaker: "scientist",
      direction: "in",
      transcript: stt.transcript,
      words: stt.words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
      sttConfidence: stt.confidence,
      language: stt.language,
      createdAt: new Date().toISOString(),
    };
    this.deps.send({ type: "transcript", utteranceId: utterance.id, text: stt.transcript, final: true });
    if (stt.confidence < LOW_STT_CONFIDENCE) {
      return this.deps.send({ type: "low_confidence", utteranceId: utterance.id, text: stt.transcript });
    }

    const pointing = this.samples.some((s) => !s.onUi && (s.rayFeatureId !== undefined || s.rayPoint !== undefined));
    const routed = routeIntent(stt.transcript, { sites: this.sites, pendingClarification: this.pending !== undefined, pointing });
    const stored = await this.deps.api.createUtterance(this.auth.token, { ...utterance, intent: routed.intent === "unknown" ? undefined : routed.intent });
    if (!stored.ok) return this.sayPhrase("error");
    void this.emit("voice.transcript.final", { utteranceId: utterance.id, text: stt.transcript, words: utterance.words });
    void this.emit("voice.intent.resolved", { utteranceId: utterance.id, intent: routed.intent });

    switch (routed.intent) {
      case "command":
        // Same message the hand UI would trigger; the headset executes it.
        return this.deps.send({ type: "command", utteranceId: utterance.id, command: routed.command });
      case "debate":
        return this.deps.send({ type: "intent", utteranceId: utterance.id, intent: "debate" });
      case "field_note":
        return this.fieldNote(utterance, stt);
      case "clarification": {
        const featureId = this.pending ? resolveClarification(routed.answer, this.pending.candidates) : undefined;
        if (!featureId) return this.sayPhrase("whichFeature");
        return this.completeClarification(featureId);
      }
      case "question":
        return this.answer(routed.text, utterance);
      case "review":
        return this.review(routed.decision, routed.rationaleText, utterance);
      case "unknown":
        return this.sayPhrase("didNotCatch");
    }
  }

  // --- Field notes (PRD §6.2, VOICE.md §4) ------------------------------------------------------

  private async fieldNote(utterance: VoiceUtterance, stt: SttResult): Promise<void> {
    let res: ReferenceResolution = resolveReference(stt.words, this.samples, this.candidates);
    if (res.status === "none" && this.samples.length > 0) {
      // A descriptive note while pointing has no deictic word: the whole utterance is the pointing window.
      const endMs = stt.words.at(-1)?.endMs ?? 0;
      res = resolveReference([...stt.words, { text: "here", startMs: 0, endMs }], this.samples, this.candidates);
    }
    if (res.status === "none") return this.sayPhrase("whichFeature");
    if (res.status === "clarify") {
      // Never resolve silently below the threshold (SIE VR1): ask once, glow both candidates.
      const candidates = res.candidates
        .map((c) => ({ c, f: this.candidates.find((f) => f.id === c.featureId) }))
        .filter((x): x is { c: (typeof res.candidates)[number]; f: Candidate } => x.f !== undefined);
      this.pending = { utterance, candidates: candidates.map((x) => x.f), method: res.method };
      void this.emit("voice.reference.clarification_required", { utteranceId: utterance.id, candidates: res.candidates });
      this.deps.send({
        type: "clarify",
        utteranceId: utterance.id,
        candidates: candidates.map((x) => ({ featureId: x.f.id, label: x.f.spokenLabel, score: x.c.score })),
        prompt: systemPhrases.whichFeature,
      });
      return this.sayPhrase("whichFeature");
    }
    void this.emit("voice.reference.resolved", { utteranceId: utterance.id, featureId: res.featureId, confidence: res.confidence });
    return this.saveFieldNote(utterance, res.featureId, { method: res.method, confidence: res.confidence, clarificationAsked: false }, res.point);
  }

  private async completeClarification(featureId: string): Promise<void> {
    const p = this.pending;
    if (!p || !p.candidates.some((c) => c.id === featureId)) return;
    this.pending = undefined;
    void this.emit("voice.reference.resolved", { utteranceId: p.utterance.id, featureId, confidence: 1 });
    // The scientist picked it explicitly, so the reference is manual and certain.
    return this.saveFieldNote(p.utterance, featureId, { method: "manual", confidence: 1, clarificationAsked: true }, p.point);
  }

  private async saveFieldNote(
    utterance: VoiceUtterance,
    featureId: string,
    reference: Omit<FieldNote["reference"], "targetFeatureId">,
    point?: { x: number; y: number; z: number },
  ): Promise<void> {
    if (!this.auth || !this.siteId) return this.sayPhrase("error");
    const spatialAnchor = { terrainFeatureId: featureId, ...(point ? { sceneLocal: point } : {}) };
    const obs = await this.deps.api.createObservation(this.auth.token, {
      siteId: this.siteId,
      source: "field_note",
      featureId,
      spatialAnchor,
      description: utterance.transcript,
    });
    if (!obs.ok) return this.sayPhrase("error");
    const note = await this.deps.api.createFieldNote(this.auth.token, {
      observationId: obs.value.id,
      utteranceId: utterance.id,
      transcript: utterance.transcript,
      language: utterance.language,
      descriptors: await this.descriptors(utterance),
      reference: { ...reference, targetFeatureId: featureId },
      spatialAnchor,
    });
    if (!note.ok) return this.sayPhrase("error");
    this.deps.send({ type: "fieldnote.created", fieldNote: note.value, observationId: obs.value.id });
    return this.sayPhrase("noted");
  }

  /** Field Note Interpreter #51 when available; deterministic extraction otherwise. Only words actually said survive. */
  private async descriptors(utterance: VoiceUtterance): Promise<string[]> {
    const said = utterance.transcript.toLowerCase();
    const fromModel = await this.deps.reasoning?.interpretFieldNote({ transcript: utterance.transcript, language: utterance.language });
    const parsed = fromModel?.ok ? fieldNoteInterpretation.safeParse(fromModel.value) : undefined;
    if (parsed?.success) {
      const kept = parsed.data.descriptors.map((d) => d.toLowerCase().trim()).filter((d) => d.length > 0 && said.includes(d));
      if (kept.length > 0) return [...new Set(kept)];
    }
    return extractDescriptors(utterance.transcript);
  }

  // --- Grounded Q&A (VOICE.md §8) -----------------------------------------------------------------

  private async answer(question: string, utterance: VoiceUtterance): Promise<void> {
    const reasoning = this.deps.reasoning;
    if (!this.auth || !this.selectedFindingId || !reasoning) return this.sayPhrase("noEvidence");
    const finding = await this.deps.api.getFinding(this.selectedFindingId);
    if (!finding.ok) return this.sayPhrase("noEvidence");
    const obs = finding.value.observationId;
    const evidence = this.siteId ? await this.deps.api.getEvidence(this.siteId) : undefined;
    const notes = await this.deps.api.listFieldNotes(obs);
    const context = {
      finding: finding.value,
      evidence: evidence?.ok ? evidence.value.items : [],
      measurements: evidence?.ok ? evidence.value.measurements : [],
      fieldNotes: notes.ok ? notes.value : [],
    };
    const scriptId = `QA-${utterance.id}`;
    const userRequestedSpeculation = SPECULATION_REQUEST.test(question);

    let draft = parseAnswer(await reasoning.answerQuestion({ question, context }));
    for (let attempt = 0; attempt < 2 && draft && !draft.noEvidence; attempt++) {
      const verdict = await this.deps.api.validateScript({
        sessionId: this.auth.sessionId,
        scriptId,
        findingId: finding.value.id,
        script: draft.script,
        sentenceEvidence: draft.sentenceEvidence,
        userRequestedSpeculation,
        rewriteAttempted: attempt > 0,
      });
      if (!verdict.ok) break;
      if (verdict.value.decision === "SPEAK_AS_APPROVED") {
        const speaker = draft.speakerAgentId ? `agent:${draft.speakerAgentId}` : "narrator";
        return this.speakApproved(scriptId, draft.script, speaker, verdict.value.sieDecisionId, verdict.value.speechRate, obs);
      }
      if (verdict.value.decision === "SILENT_CARD_ONLY") break;
      // One automatic rewrite with the validator's issues (VOICE.md §5).
      draft = parseAnswer(await reasoning.answerQuestion({ question, context, issues: verdict.value.issues }));
    }
    return this.sayPhrase("noEvidence");
  }

  // --- Review by voice (INTERACTION.md parity: poke Approve / Reject / Inconclusive) ---------------

  private async review(decision: "approved" | "rejected" | "inconclusive", rationaleText: string | undefined, utterance: VoiceUtterance) {
    if (!this.auth || !this.selectedFindingId) return this.sayPhrase("whichFeature");
    const res = await this.deps.api.review(this.auth.token, this.selectedFindingId, {
      decision,
      rationaleText,
      rationaleUtteranceId: utterance.id,
    });
    if (!res.ok) return this.sayPhrase("error");
    this.deps.send({ type: "reviewed", findingId: res.value.id, status: res.value.status });
    return this.sayPhrase("noted");
  }

  // --- Speech out ---------------------------------------------------------------------------------

  private async sayPhrase(id: SystemPhraseId): Promise<void> {
    const text = systemPhrases[id];
    await this.speak({ scriptId: `SYS-${id}`, text, speaker: "narrator", rate: 1, systemPhraseId: id });
  }

  private async speakApproved(scriptId: string, text: string, speaker: string, sieDecisionId: string, rate: number, correlationId: string) {
    void this.emit("speech.script.generated", { scriptId, speakerAgentId: speaker }, correlationId);
    await this.speak({ scriptId, text, speaker, rate, sieDecisionId });
  }

  /** The only path to the headset's speaker. Requires an SIE approval or a system phrase (AGENTS.md rule 2). */
  private async speak(s: { scriptId: string; text: string; speaker: string; rate: number; sieDecisionId?: string; systemPhraseId?: string }) {
    if (!this.auth || (s.sieDecisionId === undefined) === (s.systemPhraseId === undefined)) return;
    const profile = voiceFor(s.speaker);
    const recorded = await this.deps.api.recordOutgoing({
      id: `U-${randomUUID()}`,
      sessionId: this.auth.sessionId,
      speaker: s.speaker === "narrator" ? "narrator" : s.speaker,
      direction: "out",
      transcript: s.text,
      language: this.language,
      sieDecisionId: s.sieDecisionId,
      systemPhraseId: s.systemPhraseId,
      createdAt: new Date().toISOString(),
    });
    // If the API will not record it, it is not spoken.
    if (!recorded.ok) return;
    const audio = await this.deps.tts.synthesize({ text: s.text, voice: profile.voice, rate: s.rate, language: this.language });
    this.deps.send({
      type: "speak",
      scriptId: s.scriptId,
      text: s.text,
      speaker: s.speaker,
      voice: profile.voice,
      placement: profile.placement,
      rate: s.rate,
      sieDecisionId: s.sieDecisionId,
      systemPhraseId: s.systemPhraseId,
      // TTS failure → captions only (VOICE.md §11).
      audioBase64: audio.ok && audio.value.audio ? Buffer.from(audio.value.audio).toString("base64") : undefined,
      mimeType: audio.ok ? audio.value.mimeType : undefined,
    });
  }

  private async emit(type: Parameters<Api["emit"]>[0], payload: unknown, correlationId?: string): Promise<void> {
    if (!this.auth) return;
    await this.deps.api.emit(type, this.auth.sessionId, correlationId ?? this.selectedFindingId ?? this.siteId ?? this.auth.sessionId, payload);
  }
}

function parseAnswer(r: Awaited<ReturnType<ReasoningAdapter["answerQuestion"]>>): SpokenAnswer | undefined {
  if (!r.ok) return undefined;
  const p = spokenAnswer.safeParse(r.value);
  return p.success ? p.data : undefined;
}
