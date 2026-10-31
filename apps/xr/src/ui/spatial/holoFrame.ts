// HoloFrame: the animated edge every NEXUS panel wears. A light sweeps around the rim, HUD brackets mark the corners,
// a soft glow bleeds past the edge and a faint scan band drifts down the glass. On open the rim draws itself on.
// All of it is one shader on one quad per panel; the only per-frame work is a shared clock uniform (no allocations,
// AGENTS.md §6). Additive blending suits AR passthrough: it brightens, never blacks out the room.
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import { HOLO } from "./tokens.js";

/** One clock for every frame and voice orb; advanced once per frame by `tickHolo`. */
export const holoClock = { value: 0 };

export function tickHolo(nowMs: number): void {
  holoClock.value = nowMs / 1000;
}

const VERT = /* glsl */ `
varying vec2 vLocal;
uniform vec2 uOuter;
void main() {
  vLocal = (uv - 0.5) * uOuter;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vLocal;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uTime;
uniform float uOpacity;
uniform float uReveal;
uniform float uEnergy;
uniform float uSeed;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uHot;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  float d = sdRoundRect(vLocal, uHalf, uRadius);
  // Position round the rim, 0..1 clockwise from the top centre.
  float t = fract(0.25 - atan(vLocal.y * uHalf.x / uHalf.y, vLocal.x) / 6.2831853);
  vec3 tint = mix(uColorA, uColorB, 0.5 + 0.5 * sin(t * 6.2831853 + uTime * 0.6 + uSeed));

  float rim = exp(-abs(d) / 0.0011) * 0.8;
  float glow = d > 0.0 ? exp(-d / 0.0065) * 0.34 : 0.0;

  // The sweep: a bright head with a fading tail travelling round the rim.
  float head = fract(uTime * 0.16 + uSeed);
  float behind = fract(head - t);
  float sweep = (exp(-behind / 0.14) * 0.8 + exp(-pow((1.0 - behind) / 0.012, 2.0)) * 1.6) * exp(-abs(d) / 0.0028);

  // HUD brackets just outside each corner.
  vec2 a = abs(vLocal);
  float arm = 0.026;
  float nearCorner = step(uHalf.x - arm, a.x) * step(uHalf.y - arm, a.y);
  float bracket = nearCorner * exp(-abs(d - 0.0042) / 0.0007) * (0.75 + 0.25 * sin(uTime * 2.4 + uSeed));

  // A faint scan band drifting down the glass.
  float scanY = uHalf.y - fract(uTime * 0.11 + uSeed * 0.37) * uHalf.y * 2.6;
  float scan = d < 0.0 ? exp(-pow((vLocal.y - scanY) / 0.012, 2.0)) * 0.05 : 0.0;

  // Opening: the rim draws on from the top centre in both directions.
  float drawn = 1.0 - smoothstep(uReveal * 1.05 - 0.04, uReveal * 1.05, min(t, 1.0 - t) * 2.0);
  float energy = 0.75 + 0.5 * uEnergy;
  vec3 col = tint * (rim + glow) * drawn * energy + uHot * (sweep * 1.2 + bracket * 1.0) * drawn * energy + tint * scan;
  float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * uOpacity, alpha);
}`;

export class HoloFrame {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly bleed: number;
  private readonly u: { uOpacity: { value: number }; uReveal: { value: number }; uEnergy: { value: number } };

  constructor(widthM: number, heightM: number, radiusM: number, seed = Math.random() * 10) {
    this.bleed = 0.012;
    const outerW = widthM + 2 * this.bleed;
    const outerH = heightM + 2 * this.bleed;
    this.u = { uOpacity: { value: 1 }, uReveal: { value: 1 }, uEnergy: { value: 0 } };
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uOuter: { value: [outerW, outerH] },
        uHalf: { value: [widthM / 2, heightM / 2] },
        uRadius: { value: radiusM },
        uTime: holoClock,
        ...this.u,
        uSeed: { value: seed },
        uColorA: { value: new Color(HOLO.rimA) },
        uColorB: { value: new Color(HOLO.rimB) },
        uHot: { value: new Color(HOLO.hot) },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(outerW, outerH), material);
    this.mesh.name = "holo-frame";
    // Drawn over the panel's glass so the sweep is never hidden by it; never a pick target.
    this.mesh.renderOrder = 6;
    this.mesh.position.z = 0.0005;
    this.mesh.raycast = () => undefined;
  }

  /** Follows the panel's fade. */
  setOpacity(k: number): void {
    this.u.uOpacity.value = k;
  }

  /** 0 = no rim yet, 1 = fully drawn. */
  setReveal(k: number): void {
    this.u.uReveal.value = k;
  }

  /** Brighter while something is live on the panel (a mic held, a voice speaking). 0..1. */
  setEnergy(e: number): void {
    this.u.uEnergy.value = e;
  }
}
