// Mic samples → 16-bit mono PCM at the gateway's rate (VOICE.md §2). Pure so it is unit-tested.

export const GATEWAY_SAMPLE_RATE_HZ = 16000;

/** Linear-interpolating resample of mono float samples. */
export function resample(input: Float32Array, fromHz: number, toHz: number): Float32Array {
  if (fromHz === toHz) return input;
  const outLength = Math.floor((input.length * toHz) / fromHz);
  const out = new Float32Array(outLength);
  const ratio = fromHz / toHz;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * (pos - i0);
  }
  return out;
}

/** Float [-1, 1] to little-endian int16, clipping out-of-range samples. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
