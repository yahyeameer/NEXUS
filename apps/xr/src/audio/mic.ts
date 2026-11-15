// Push-to-talk capture (AGENTS.md rule 9): the microphone is opened on press and fully released on let-go,
// so nothing listens between utterances. Audio is streamed, never stored here.
import { GATEWAY_SAMPLE_RATE_HZ, resample, toPcm16 } from "./pcm.js";

// Runs on the audio thread; posts each 128-frame block of channel 0 to the main thread.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("nexus-tap", Tap);
`;

/** ~100 ms of 16 kHz PCM per frame keeps WebSocket messages small (gateway caps frames at 64 KB). */
const FRAME_SAMPLES = 1600;

export class PushToTalkMic {
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private pending: number[] = [];
  /** Loudness of the latest audio block, 0..1 (RMS, scaled), for the voice orb. Never stored or sent. */
  level = 0;

  /** Opens the mic. Resolves false when there is no mic or permission was refused; the caller shows captions instead. */
  async start(onFrame: (pcm: Uint8Array) => void): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      this.ctx = ctx;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "nexus-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        let sum = 0;
        for (const v of e.data) sum += v * v;
        this.level = Math.min(1, Math.sqrt(sum / Math.max(1, e.data.length)) * 8);
        for (const v of resample(e.data, ctx.sampleRate, GATEWAY_SAMPLE_RATE_HZ)) this.pending.push(v);
        while (this.pending.length >= FRAME_SAMPLES) onFrame(toPcm16(Float32Array.from(this.pending.splice(0, FRAME_SAMPLES))));
      };
      ctx.createMediaStreamSource(this.stream).connect(node);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.ctx?.close().catch(() => undefined);
    this.stream = undefined;
    this.ctx = undefined;
    this.pending = [];
    this.level = 0;
  }
}
