// Plays only speech that has an SIE approval or is a fixed system phrase (AGENTS.md rule 2), always with captions.
// Uses the gateway's audio when a TTS provider is configured, else the browser's speechSynthesis, else captions only
// (VOICE.md §11 "TTS error").
import type { VoiceServerMessage } from "@nexus/schemas";
import type { SystemPhraseId } from "@nexus/voice/browser";
import { isSystemPhrase, systemPhrases } from "@nexus/voice/browser";

type Speak = Extract<VoiceServerMessage, { type: "speak" }>;

export interface Utterance {
  /** Exactly one of these. */
  scriptId?: string;
  systemPhraseId?: SystemPhraseId;
  text: string;
  speaker: string;
  rate: number;
  audioBase64?: string;
  mimeType?: string;
}

export interface SpeakerHooks {
  caption: (speaker: string, text: string) => void;
  /** Reports playback to the API, which refuses a start for a script it never approved. */
  playback: (kind: "started" | "completed" | "interrupted", u: Utterance) => void;
}

export class Speaker {
  private queue: Utterance[] = [];
  private current?: { u: Utterance; audio?: HTMLAudioElement };
  muted = false;

  constructor(private readonly hooks: SpeakerHooks) {}

  get speaking(): boolean {
    return this.current !== undefined;
  }

  /** Who is speaking now, for the voice window. */
  get currentSpeaker(): string | undefined {
    return this.current?.u.speaker;
  }

  fromGateway(m: Speak): void {
    this.enqueue({
      scriptId: m.sieDecisionId ? m.scriptId : undefined,
      systemPhraseId: m.systemPhraseId as SystemPhraseId | undefined,
      text: m.text,
      speaker: m.speaker,
      rate: m.rate,
      audioBase64: m.audioBase64,
      mimeType: m.mimeType,
    });
  }

  phrase(id: SystemPhraseId): void {
    this.enqueue({ systemPhraseId: id, text: systemPhrases[id], speaker: "narrator", rate: 1 });
  }

  enqueue(u: Utterance): void {
    // Defence in depth: a system phrase must match the fixed list word for word.
    if (!u.scriptId && !(u.systemPhraseId && isSystemPhrase(u.text))) return;
    this.queue.push(u);
    if (!this.current) this.next();
  }

  /** "Stop" by hand or voice: interrupts the current line and drops the queue. */
  stop(): void {
    this.queue = [];
    const c = this.current;
    if (!c) return;
    this.current = undefined;
    c.audio?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.hooks.playback("interrupted", c.u);
  }

  private next(): void {
    const u = this.queue.shift();
    if (!u) return;
    const current: { u: Utterance; audio?: HTMLAudioElement } = { u };
    this.current = current;
    this.hooks.caption(u.speaker, u.text);
    this.hooks.playback("started", u);
    const done = () => {
      if (this.current !== current) return;
      this.current = undefined;
      this.hooks.playback("completed", u);
      this.next();
    };
    if (this.muted) {
      setTimeout(done, captionMs(u.text));
    } else if (u.audioBase64 && u.mimeType) {
      const audio = new Audio(`data:${u.mimeType};base64,${u.audioBase64}`);
      current.audio = audio;
      audio.onended = done;
      audio.onerror = () => setTimeout(done, captionMs(u.text));
      void audio.play().catch(() => setTimeout(done, captionMs(u.text)));
    } else if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
      const s = new SpeechSynthesisUtterance(u.text);
      s.rate = u.rate;
      s.onend = done;
      s.onerror = done;
      window.speechSynthesis.speak(s);
      // Some browsers never fire onend without a voice installed; captions keep the pace either way.
      setTimeout(done, captionMs(u.text) * 2);
    } else {
      setTimeout(done, captionMs(u.text));
    }
  }
}

/** Reading time for captions-only playback. */
function captionMs(text: string): number {
  return Math.max(1500, text.split(/\s+/).length * 350);
}
