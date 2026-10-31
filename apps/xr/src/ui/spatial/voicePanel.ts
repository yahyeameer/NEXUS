// VoicePanel: the captions strip, now the voice window. A live orb on the left shows whose voice is active: idle it
// breathes, while your push-to-talk is held it ripples with your real microphone level, and while an agent speaks it
// turns violet and pulses. Captions stay the source of truth (AGENTS.md rule 2: nothing is spoken without them); the
// orb only shows state and never adds words. One shader quad, a shared clock and two uniforms per frame.
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { PanelLine } from "./glassPanel.js";
import { SpatialGlassPanel } from "./glassPanel.js";
import { holoClock } from "./holoFrame.js";
import { HOLO } from "./tokens.js";

export type VoiceMode = "idle" | "listening" | "speaking";

const ORB_M = 0.085;
const INSET_M = 0.075;

/** The strip's words for a state: a status line, then the newest caption and the one before it. Pure. */
export function voiceLines(mode: VoiceMode, speakerLabel: string | undefined, captions: readonly string[]): PanelLine[] {
  const status =
    mode === "listening"
      ? { text: "LISTENING · release to send", tone: "title" as const }
      : mode === "speaking"
        ? { text: `${(speakerLabel ?? "Agent").toUpperCase()} · SPEAKING`, tone: "title" as const }
        : { text: "VOICE · hold to talk on the wrist menu", tone: "muted" as const };
  const [latest, previous] = captions.slice(-2).reverse();
  const lines: PanelLine[] = [status];
  lines.push(latest ? { text: latest, tone: "body" } : { text: "Captions appear here.", tone: "muted" });
  if (previous) lines.push({ text: previous, tone: "muted" });
  return lines;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;
uniform float uMode;
uniform float uOpacity;
uniform vec3 uListen;
uniform vec3 uSpeak;
uniform vec3 uIdle;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);
  float listening = step(0.5, uMode) * step(uMode, 1.5);
  float speaking = step(1.5, uMode);
  float idle = 1.0 - listening - speaking;

  // Speaking has no audio level to read (speech synthesis exposes none), so it pulses on a fixed rhythm.
  float speakPulse = 0.45 + 0.35 * sin(uTime * 9.0) * sin(uTime * 3.7 + 1.0);
  float level = idle * (0.06 + 0.04 * sin(uTime * 1.6)) + listening * (0.18 + uLevel) + speaking * speakPulse;

  float wave = 0.5 + 0.5 * sin(a * 7.0 + uTime * 4.0) * sin(a * 3.0 - uTime * 2.3);
  float ringR = 0.25 + level * 0.09 * wave;
  float ring = exp(-abs(r - ringR) / 0.014);
  float inner = exp(-abs(r - 0.16 - level * 0.03) / 0.006) * 0.55;

  // Radial bars while speaking.
  float bars = speaking * step(0.5, fract(a / 6.2831853 * 28.0)) * smoothstep(0.30, 0.31, r) * (1.0 - smoothstep(0.31 + 0.12 * speakPulse * (0.6 + 0.4 * sin(a * 5.0 + uTime * 7.0)), 0.32 + 0.12 * speakPulse, r));

  // Ripples rising out of the orb while listening.
  float ripples = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = fract(uTime * 0.9 + float(i) / 3.0);
    ripples += exp(-abs(r - (0.22 + k * 0.26)) / 0.008) * (1.0 - k);
  }
  ripples *= listening * (0.5 + uLevel);

  float core = exp(-r / 0.07) * (0.35 + level);
  vec3 tint = uIdle * idle + uListen * listening + uSpeak * speaking;
  vec3 col = (tint * (ring + inner + core + ripples * 0.9 + bars * 0.9) + vec3(1.0) * core * 0.4) * 1.7;
  col *= 1.0 - smoothstep(0.42, 0.5, r);
  float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * uOpacity, alpha);
}`;

export class VoicePanel extends SpatialGlassPanel {
  readonly orb: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly u = { uLevel: { value: 0 }, uMode: { value: 0 }, uOpacity: { value: 1 } };
  private smoothed = 0;
  private mode: VoiceMode = "idle";

  constructor() {
    super("captions", 0.4, 0.095, false, INSET_M);
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: holoClock,
        ...this.u,
        uListen: { value: new Color(HOLO.listen) },
        uSpeak: { value: new Color(HOLO.speak) },
        uIdle: { value: new Color(HOLO.rimA).multiplyScalar(0.7) },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.orb = new Mesh(new PlaneGeometry(ORB_M, ORB_M), material);
    this.orb.name = "voice-orb";
    this.orb.renderOrder = 7;
    this.orb.position.set(-this.widthM / 2 + 0.014 + INSET_M / 2 - 0.004, 0, 0.001);
    this.orb.raycast = () => undefined;
    this.mesh.add(this.orb);
  }

  get voiceMode(): VoiceMode {
    return this.mode;
  }

  /** New state and captions; redraws the text only (the orb animates on its own). */
  show(mode: VoiceMode, speakerLabel: string | undefined, captions: readonly string[]): void {
    this.mode = mode;
    this.u.uMode.value = mode === "idle" ? 0 : mode === "listening" ? 1 : 2;
    this.frame.setEnergy(mode === "idle" ? 0 : 1);
    this.set({ lines: voiceLines(mode, speakerLabel, captions), rows: [] });
  }

  /** Per frame: the microphone's level (0..1), eased so the orb swells and settles smoothly. Allocation-free. */
  level(raw: number): void {
    const target = this.mode === "listening" ? Math.min(1, raw) : 0;
    this.smoothed += (target - this.smoothed) * (target > this.smoothed ? 0.5 : 0.12);
    this.u.uLevel.value = this.smoothed;
  }

  override update(now: number): void {
    super.update(now);
    this.u.uOpacity.value = this.mesh.material.opacity;
  }
}
