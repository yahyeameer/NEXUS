// SpatialFocus: bring a selected feature to the middle of the placed model and magnify it, smoothly, so the
// scientist can study it without walking round the table. Reset (view:reset) returns to the whole site.
import type { Diorama } from "../scene/diorama.js";
import type { Vec3 } from "../scene/tabletop.js";
import { DEFAULT_TABLE } from "../scene/tabletop.js";
import { MAX_SCALE } from "../input/manipulate.js";

export const FOCUS_SCALE = 2.2;
const FOCUS_MS = 650;

/** Ease-out cubic, 0 → 1. */
export function easeOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - (1 - k) ** 3;
}

export class SpatialFocus {
  private anim?: { from: { x: number; z: number; s: number }; to: { x: number; z: number; s: number }; start: number };
  private _target?: string;

  constructor(private readonly diorama: Diorama) {}

  /** Feature currently in focus, if any. */
  get target(): string | undefined {
    return this._target;
  }

  /** Focus on a layout point (a feature anchor). */
  focus(featureId: string, anchor: Vec3, now = performance.now()): void {
    this._target = featureId;
    const f = this.diorama.focus;
    this.anim = {
      from: { x: f.x, z: f.z, s: this.diorama.scale },
      to: { x: anchor.x - DEFAULT_TABLE.center.x, z: anchor.z - DEFAULT_TABLE.center.z, s: Math.min(MAX_SCALE, Math.max(this.diorama.scale, FOCUS_SCALE)) },
      start: now,
    };
  }

  /** Forget the focus target (the view itself is reset by Diorama.reset). */
  clear(): void {
    this._target = undefined;
    this.anim = undefined;
  }

  get animating(): boolean {
    return this.anim !== undefined;
  }

  update(now: number): void {
    const a = this.anim;
    if (!a) return;
    const k = easeOut((now - a.start) / FOCUS_MS);
    this.diorama.setFocus(a.from.x + (a.to.x - a.from.x) * k, a.from.z + (a.to.z - a.from.z) * k);
    this.diorama.setScale(a.from.s + (a.to.s - a.from.s) * k);
    if (k >= 1) this.anim = undefined;
  }
}
