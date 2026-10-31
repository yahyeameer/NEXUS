// ARGestureController: phone AR touch gestures on the DOM overlay. One finger dragged sideways turns the explorer,
// two fingers pinch to scale and twist to turn. A plain tap is left to WebXR's select (placement, picking a feature).
// Headsets use HandInput's pinch-drag and two-hand zoom instead; both end in the same rotate/scale calls.
import { isDrag, twoFinger, YAW_PER_PX } from "./gestures.js";
import type { Touch2 } from "./gestures.js";

export interface GestureHooks {
  rotateBy: (radians: number) => void;
  scaleBy: (factor: number) => void;
}

export class ARGestureController {
  private readonly touches = new Map<number, Touch2>();
  private start?: Touch2;
  private dragging = false;
  /** Set when a touch turned into a drag, so the select WebXR fires at its end is not a tap. */
  private suppressUntil = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly hooks: GestureHooks,
  ) {
    el.addEventListener("pointerdown", this.down);
    el.addEventListener("pointermove", this.move);
    el.addEventListener("pointerup", this.up);
    el.addEventListener("pointercancel", this.up);
  }

  /** True just after a drag or pinch: the matching XR select should not pick or place anything. */
  get suppressSelect(): boolean {
    return this.dragging || this.touches.size > 1 || performance.now() < this.suppressUntil;
  }

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.down);
    this.el.removeEventListener("pointermove", this.move);
    this.el.removeEventListener("pointerup", this.up);
    this.el.removeEventListener("pointercancel", this.up);
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.pointerType !== "touch" || e.target !== this.el) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 1) {
      this.start = { x: e.clientX, y: e.clientY };
      this.dragging = false;
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const prev = this.touches.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (this.touches.size >= 2) {
      const [first, second] = [...this.touches];
      if (!first || !second) return;
      const [idA, a] = first;
      const [idB, b] = second;
      const nextA = idA === e.pointerId ? next : a;
      const nextB = idB === e.pointerId ? next : b;
      const g = twoFinger(a, b, nextA, nextB);
      this.hooks.scaleBy(g.scale);
      this.hooks.rotateBy(g.rotation);
      this.dragging = true;
    } else if (this.start) {
      if (!this.dragging && isDrag(next.x - this.start.x, next.y - this.start.y)) this.dragging = true;
      if (this.dragging) this.hooks.rotateBy((next.x - prev.x) * YAW_PER_PX);
    }
    this.touches.set(e.pointerId, next);
  };

  private readonly up = (e: PointerEvent): void => {
    if (!this.touches.delete(e.pointerId)) return;
    if (this.dragging) this.suppressUntil = performance.now() + 250;
    if (this.touches.size === 0) {
      this.dragging = false;
      this.start = undefined;
    }
  };
}
