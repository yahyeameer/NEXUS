// Poke detection for near panels (INTERACTION.md §2–§3). Pure: the frame loop feeds fingertip positions in
// panel-local metres (x right, y up, z out of the panel face) and gets press/release edges back.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fingertip must cross the face from the front: within this depth counts as touching. */
export const PRESS_DEPTH_M = 0.008;
/** Release once the tip is this far back out, so jitter at the surface does not re-fire (hysteresis). */
export const RELEASE_DEPTH_M = 0.02;
/** Beyond this the tip is not near the panel at all. */
const BEHIND_LIMIT_M = -0.06;

export type PokeEdge = { kind: "press"; id: string } | { kind: "release"; id: string };

export class PokeTracker {
  private pressed?: string;
  private armed = false;

  /** `buttons` in panel-local metres; returns at most one edge per frame. */
  update(tip: { x: number; y: number; z: number } | undefined, buttons: readonly { id: string; rect: Rect }[]): PokeEdge | undefined {
    if (!tip) return this.release();
    const hit = buttons.find((b) => inside(b.rect, tip.x, tip.y));
    if (this.pressed) {
      const still = hit?.id === this.pressed && tip.z < RELEASE_DEPTH_M && tip.z > BEHIND_LIMIT_M;
      return still ? undefined : this.release();
    }
    // Arm only while in front of the face, so a hand that enters from behind or the side never presses.
    if (tip.z > PRESS_DEPTH_M) {
      this.armed = true;
      return undefined;
    }
    if (this.armed && hit && tip.z > BEHIND_LIMIT_M) {
      this.armed = false;
      this.pressed = hit.id;
      return { kind: "press", id: hit.id };
    }
    if (tip.z <= BEHIND_LIMIT_M || !hit) this.armed = false;
    return undefined;
  }

  get current(): string | undefined {
    return this.pressed;
  }

  private release(): PokeEdge | undefined {
    this.armed = false;
    const id = this.pressed;
    this.pressed = undefined;
    return id ? { kind: "release", id } : undefined;
  }
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
