// SurfaceDetection: where a placed object could rest. On a real device it is WebXR hit-test against the room the
// headset or phone has mapped; the emulator has no room, so it can opt into an explicitly emulated table plane for
// tests. Results are horizontal surfaces only: the Moon rests on tables and floors, not on walls.
import { Matrix4, Quaternion, Raycaster, Vector3 } from "three";
import type { WebGLRenderer, XRTargetRaySpace } from "three";

export interface SurfaceHit {
  position: Vector3;
  normal: Vector3;
  /** The WebXR result, when there is one: anchors are created from it. */
  result?: XRHitTestResult;
}

export type SurfaceKind = "xr-hit-test" | "emulated-plane" | "none";

export interface SurfaceSource {
  readonly kind: SurfaceKind;
  /** Latest horizontal hit, or undefined while searching. Call once per XR frame. */
  update(frame: XRFrame | undefined): SurfaceHit | undefined;
  dispose(): void;
}

/** Normals within ~37° of straight up count as a surface to rest on. */
export const HORIZONTAL_MIN_NORMAL_Y = 0.8;

export function isHorizontal(normalY: number): boolean {
  return normalY >= HORIZONTAL_MIN_NORMAL_Y;
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();

/** WebXR hit-test: a viewer-space source (phone screen centre, headset gaze), plus each tracked hand or controller ray. */
export class XrHitTestSurface implements SurfaceSource {
  readonly kind = "xr-hit-test" as const;
  private viewerSource?: XRHitTestSource;
  private readonly inputSources = new Map<XRInputSource, XRHitTestSource>();
  private readonly hit: SurfaceHit = { position: new Vector3(), normal: new Vector3() };
  private disposed = false;

  private constructor(
    private readonly session: XRSession,
    private readonly refSpace: () => XRReferenceSpace | null,
  ) {}

  /** Undefined when the session cannot hit-test (feature not granted, or the emulator has no room to test against). */
  static async create(session: XRSession, refSpace: () => XRReferenceSpace | null): Promise<XrHitTestSurface | undefined> {
    if (!session.requestHitTestSource) return undefined;
    const surface = new XrHitTestSurface(session, refSpace);
    try {
      const viewer = await session.requestReferenceSpace("viewer");
      surface.viewerSource = await session.requestHitTestSource({ space: viewer });
    } catch {
      return undefined;
    }
    const add = (sources: readonly XRInputSource[]) => {
      for (const s of sources) void surface.addInput(s);
    };
    add([...session.inputSources]);
    session.addEventListener("inputsourceschange", (e) => {
      add(e.added);
      for (const s of e.removed) surface.removeInput(s);
    });
    return surface;
  }

  private async addInput(source: XRInputSource): Promise<void> {
    // Phone taps (screen) are transient; the viewer source already follows the screen centre.
    if (source.targetRayMode !== "tracked-pointer" || this.inputSources.has(source) || !this.session.requestHitTestSource) return;
    try {
      const hs = await this.session.requestHitTestSource({ space: source.targetRaySpace });
      if (this.disposed || !hs) return hs?.cancel();
      this.inputSources.set(source, hs);
    } catch {
      // A hand ray that cannot hit-test still leaves the gaze source.
    }
  }

  private removeInput(source: XRInputSource): void {
    this.inputSources.get(source)?.cancel();
    this.inputSources.delete(source);
  }

  update(frame: XRFrame | undefined): SurfaceHit | undefined {
    const ref = this.refSpace();
    if (!frame || !ref) return undefined;
    // Prefer the right hand's ray (where the scientist points), then any ray, then the gaze.
    const ordered = [...this.inputSources].sort(([a], [b]) => (a.handedness === "right" ? -1 : 0) - (b.handedness === "right" ? -1 : 0)).map(([, s]) => s);
    if (this.viewerSource) ordered.push(this.viewerSource);
    for (const source of ordered) {
      for (const result of frame.getHitTestResults(source)) {
        const pose = result.getPose(ref);
        if (!pose) continue;
        tmpMatrix.fromArray(pose.transform.matrix);
        tmpMatrix.decompose(this.hit.position, tmpQuat, tmpScale);
        // Hit-test poses put the surface normal on +Y.
        this.hit.normal.set(0, 1, 0).applyQuaternion(tmpQuat);
        if (!isHorizontal(this.hit.normal.y)) continue;
        this.hit.result = result;
        return this.hit;
      }
    }
    return undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.viewerSource?.cancel();
    for (const s of this.inputSources.values()) s.cancel();
    this.inputSources.clear();
  }
}

/**
 * Emulator only: a horizontal plane at a fixed height standing in for a table, hit by the right hand's ray (or the
 * view direction when no hand is tracked). It is never used on a real device; status and state call it "emulated".
 */
export class EmulatedPlaneSurface implements SurfaceSource {
  readonly kind = "emulated-plane" as const;
  private readonly raycaster = new Raycaster();
  private readonly hit: SurfaceHit = { position: new Vector3(), normal: new Vector3(0, 1, 0) };
  private readonly dir = new Vector3();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly heightM: number,
  ) {}

  update(): SurfaceHit | undefined {
    const ray = this.rightRay();
    const r = this.raycaster.ray;
    if (ray) {
      ray.getWorldPosition(r.origin);
      ray.getWorldDirection(this.dir);
      r.direction.copy(this.dir).negate();
    } else {
      const cam = this.renderer.xr.getCamera();
      cam.getWorldPosition(r.origin);
      cam.getWorldDirection(r.direction);
    }
    if (r.direction.y >= -1e-3) return undefined;
    const t = (this.heightM - r.origin.y) / r.direction.y;
    if (t <= 0 || t > 6) return undefined;
    this.hit.position.copy(r.origin).addScaledVector(r.direction, t);
    return this.hit;
  }

  private rightRay(): XRTargetRaySpace | undefined {
    for (const i of [0, 1]) {
      const c = this.renderer.xr.getController(i);
      if (c.visible && c.userData.handedness !== "left") return c;
    }
    return undefined;
  }

  dispose(): void {}
}
