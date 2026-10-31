// Placement flow (brief, phase 1): search for a surface → reticle → tap or pinch to place → anchored. Reposition
// starts the search again. Owns the reticle, the surface source and the anchor; the app owns what is placed.
import { Vector3 } from "three";
import type { Scene, WebGLRenderer } from "three";
import { PlacementReticle } from "./placementReticle.js";
import { PlanetaryAnchor } from "./planetaryAnchor.js";
import type { AnchorKind } from "./planetaryAnchor.js";
import type { StagePose } from "./stage.js";
import { stageFromPlacement } from "./stage.js";
import type { SurfaceHit, SurfaceKind, SurfaceSource } from "./surfaceDetection.js";

export type PlacementPhase = "placing" | "placed";

export interface PlacementStatus {
  phase: PlacementPhase;
  surface: SurfaceKind;
  /** A surface is under the reticle right now. */
  surfaceFound: boolean;
  anchor: AnchorKind;
  tracking: boolean;
}

/** Where the explorer goes when nothing can be hit-tested: ahead of the viewer, below eye level, never in their face. */
export const FALLBACK_AHEAD_M = 0.75;
export const FALLBACK_BELOW_EYE_M = 0.45;

const tmpHead = new Vector3();
const tmpDir = new Vector3();

export class PlacementController {
  readonly reticle = new PlacementReticle();
  readonly anchor = new PlanetaryAnchor();
  private source?: SurfaceSource;
  private anchorsSupported = false;
  private lastHit?: SurfaceHit;
  private _phase: PlacementPhase = "placing";
  private session?: XRSession;
  /** XR frames seen since attach: the viewer's pose is only real once the session has rendered a frame. */
  private frames = 0;
  private pendingFallback = false;
  private readonly onSelect = () => this.tryPlace();

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    private readonly hooks: { placed: (stage: StagePose) => void; changed: () => void; allowSelect?: () => boolean },
  ) {
    scene.add(this.reticle.group);
  }

  get phase(): PlacementPhase {
    return this._phase;
  }

  status(): PlacementStatus {
    return {
      phase: this._phase,
      surface: this.source?.kind ?? "none",
      surfaceFound: this.reticle.visible,
      anchor: this.anchor.kind,
      tracking: this.anchor.tracking,
    };
  }

  /** Starts listening to a session. `source` undefined means no hit-test: the next reposition places at the fallback spot. */
  attach(session: XRSession, source: SurfaceSource | undefined, anchorsSupported: boolean): void {
    this.detach();
    this.session = session;
    this.source = source;
    this.anchorsSupported = anchorsSupported;
    this.frames = 0;
    session.addEventListener("select", this.onSelect);
  }

  detach(): void {
    this.session?.removeEventListener("select", this.onSelect);
    this.session = undefined;
    this.source?.dispose();
    this.source = undefined;
    this.anchor.clear();
    this.reticle.hide();
    this._phase = "placing";
  }

  /** Begins (or restarts) the surface search. Without a surface source the explorer is placed at once. */
  reposition(): void {
    this._phase = "placing";
    this.lastHit = undefined;
    this.anchor.clear();
    // Without a surface source, place ahead of the viewer as soon as their pose is known.
    this.pendingFallback = !this.source;
    this.hooks.changed();
  }

  /** True once the session has rendered: camera-relative placement is meaningful from then on. */
  get viewerReady(): boolean {
    return this.frames >= 2;
  }

  /**
   * Place at a known point with no surface behind it (3D viewer, tests, devices without hit-test). `stage` gives the
   * pose outright, for callers that know the viewer's layout before the first frame (the seated default).
   */
  placeFixed(point: Vector3, stage?: StagePose): void {
    this.pendingFallback = false;
    this.anchor.setFixed(point);
    this.finish(point, stage);
  }

  /** Per frame, inside the XR animation loop. */
  update(now: number): void {
    const frame = this.renderer.xr.getFrame() ?? undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    if (frame) this.frames++;
    if (this._phase === "placing" && this.pendingFallback) {
      if (this.viewerReady) this.placeFixed(this.fallbackPoint());
      return;
    }
    if (this._phase === "placing") {
      const hit = this.source?.update(frame);
      const was = this.reticle.visible;
      if (hit) {
        this.lastHit = hit;
        this.reticle.show(hit.position);
      } else this.reticle.hide();
      this.reticle.update(now);
      if (was !== this.reticle.visible) this.hooks.changed();
      return;
    }
    const tracking = this.anchor.tracking;
    if (this.anchor.update(frame, ref)) this.hooks.placed(this.stageAt(this.anchor.position));
    if (tracking !== this.anchor.tracking) this.hooks.changed();
  }

  setFootprint(diameterM: number): void {
    this.reticle.setFootprint(diameterM);
  }

  private tryPlace(): void {
    if (this._phase !== "placing" || !this.reticle.visible || !this.lastHit) return;
    if (this.hooks.allowSelect && !this.hooks.allowSelect()) return;
    const hit = this.lastHit;
    const point = hit.position.clone();
    void this.anchor.set(hit, this.anchorsSupported).then(() => this.hooks.changed());
    this.finish(point);
  }

  private finish(point: Vector3, stage?: StagePose): void {
    this._phase = "placed";
    this.reticle.hide();
    this.hooks.placed(stage ?? this.stageAt(point));
    this.hooks.changed();
  }

  private stageAt(point: Vector3): StagePose {
    this.viewer(tmpHead, tmpDir);
    return stageFromPlacement(point, tmpHead);
  }

  private fallbackPoint(): Vector3 {
    this.viewer(tmpHead, tmpDir);
    tmpDir.y = 0;
    if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, -1);
    tmpDir.normalize();
    return tmpHead.clone().addScaledVector(tmpDir, FALLBACK_AHEAD_M).setY(tmpHead.y - FALLBACK_BELOW_EYE_M);
  }

  private viewer(pos: Vector3, dir: Vector3): void {
    const cam = this.renderer.xr.getCamera();
    cam.getWorldPosition(pos);
    cam.getWorldDirection(dir);
  }
}
