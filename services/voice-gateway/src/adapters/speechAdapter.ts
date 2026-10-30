// Speech provider interfaces (ARCHITECTURE.md "Adapters"). Vendor SDKs are imported only in their own
// `*Adapter.ts` once the STT/TTS bake-off picks a provider (docs/TASKS.md Phase 1).
import type { Result } from "@nexus/schemas";

export interface SttWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface SttResult {
  transcript: string;
  words: SttWord[];
  confidence: number;
  language: string;
}

/** One push-to-talk utterance: audio chunks in, partials out, a final result at release. */
export interface SttStream {
  write(chunk: Uint8Array): void;
  /** Close the stream and return the final transcript. */
  end(): Promise<Result<SttResult>>;
}

export interface SpeechToTextAdapter {
  open(opts: { language: string; sampleRateHz: number; onPartial: (text: string) => void }): SttStream;
}

export interface TtsResult {
  /** Encoded audio (e.g. Opus/MP3) to stream to the headset, or a cached URL. */
  audio?: Uint8Array;
  audioUrl?: string;
  mimeType: string;
}

export interface TextToSpeechAdapter {
  synthesize(opts: { text: string; voice: string; rate: number; language: string }): Promise<Result<TtsResult>>;
}

/**
 * Test and precomputed-mode STT: returns a scripted transcript per utterance, spreading word timings
 * evenly over the audio duration so the deictic resolver still gets timestamps.
 */
export class FakeSpeechToText implements SpeechToTextAdapter {
  private queue: string[] = [];

  /** Next transcripts to return, in order. */
  say(...transcripts: string[]): void {
    this.queue.push(...transcripts);
  }

  open(opts: { language: string; sampleRateHz: number; onPartial: (text: string) => void }): SttStream {
    let bytes = 0;
    const next = () => this.queue.shift();
    return {
      write: (chunk) => {
        bytes += chunk.byteLength;
      },
      end: async () => {
        const transcript = next();
        if (transcript === undefined) return { ok: false, error: "no transcript" };
        opts.onPartial(transcript);
        // 16-bit mono PCM: 2 bytes per sample.
        const durationMs = Math.max(1000, (bytes / 2 / opts.sampleRateHz) * 1000);
        const tokens = transcript.split(/\s+/).filter(Boolean);
        const step = durationMs / Math.max(1, tokens.length);
        const words = tokens.map((text, i) => ({ text: text.replace(/[^\p{L}\p{N}'-]/gu, ""), startMs: i * step, endMs: (i + 1) * step }));
        return { ok: true, value: { transcript, words, confidence: 0.95, language: opts.language } };
      },
    };
  }
}

/** No audio: the headset falls back to captions only (VOICE.md §11 "TTS error"). */
export class SilentTextToSpeech implements TextToSpeechAdapter {
  async synthesize(): Promise<Result<TtsResult>> {
    return { ok: false, error: "no TTS provider configured" };
  }
}
