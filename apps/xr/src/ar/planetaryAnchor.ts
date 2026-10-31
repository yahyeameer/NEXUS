// PlanetaryAnchor: keeps the placed explorer where it was put. With the WebXR anchors feature the pose comes from an
// XRAnchor the device keeps tracking as its map of the room improves; without it the pose is fixed in the session's
// reference space, which is still stable on Quest and ARCore but can drift over a long session.
import { Matrix4, Quaternion, Vector3 } from "three";
import type { SurfaceHit } from "./surfaceDetection.js";

export type AnchorKind = "xr-anchor" | "fixed" | "none";

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const tmpBefore = new Vector3();

export class PlanetaryAnchor {
  readonly position = new Vector3();
  private anchor?: XRAnchor;
  private _kind: AnchorKind = "none";
  private _tracking = true;
  private generation = 0;

  get kind(): AnchorKind {
    return this._kind;
  }

  /** False while an XRAnchor exists but the device has lost it (pose unavailable this frame). */
  get tracking(): boolean {
    return this._tracking;
  }

  /** Pins to `hit`, upgrading to an XRAnchor when the device grants one; resolves to the kind in use. */
  async set(hit: SurfaceHit, anchorsSupported: boolean): Promise<AnchorKind> {
    this.clear();
    const gen = ++this.generation;
    this.position.copy(hit.position);
    this._kind = "fixed";
    this._tracking = true;
    if (!anchorsSupported || !hit.result?.createAnchor) return this._kind;
    try {
      const anchor = await hit.result.createAnchor();
      if (gen !== this.generation) {
        anchor?.delete();
        return this._kind;
      }
      if (anchor) {
        this.anchor = anchor;
        this._kind = "xr-anchor";
      }
    } catch {
      // Anchor creation can fail (tracking quality, limits); the fixed pose still holds.
    }
    return this._kind;
  }

  /** A pose with no surface behind it (3D viewer, or a device that cannot hit-test). */
  setFixed(position: Vector3): void {
    this.clear();
    this.position.copy(position);
    this._kind = "fixed";
    this._tracking = true;
  }

  /** Per XR frame: follow the anchor. Returns true when the position changed. */
  update(frame: XRFrame | undefined, refSpace: XRReferenceSpace | null): boolean {
    if (!this.anchor || !frame || !refSpace) return false;
    if (!frame.trackedAnchors?.has(this.anchor)) {
      this._tracking = false;
      return false;
    }
    const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
    this._tracking = pose !== undefined && pose !== null;
    if (!pose) return false;
    tmpMatrix.fromArray(pose.transform.matrix);
    tmpBefore.copy(this.position);
    tmpMatrix.decompose(this.position, tmpQuat, tmpScale);
    return tmpBefore.distanceToSquared(this.position) > 1e-8;
  }

  clear(): void {
    this.generation++;
    this.anchor?.delete();
    this.anchor = undefined;
    this._kind = "none";
    this._tracking = true;
  }
}
