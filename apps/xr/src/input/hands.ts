// Hands-first input (INTERACTION.md §2): poke near panels with the index fingertip, point + pinch at distance.
// Controllers work through the same ray path, so a Quest without hand tracking is not locked out.
import { BufferGeometry, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Quaternion, Raycaster, SphereGeometry, Vector3 } from "three";
import type { Group, Object3D, WebGLRenderer, XRHandSpace, XRTargetRaySpace } from "three";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import type { Panel } from "../ui/panel.js";
import { isTap, TAP_MAX_MOVE_M, yawDelta } from "./manipulate.js";
import type { Point2 } from "./manipulate.js";
import { PokeTracker } from "./poke.js";

export type Handedness = "left" | "right";

export interface InputHooks {
  panels: () => Panel[];
  terrain: () => Object3D | undefined;
  button: (panel: Panel, id: string, edge: "press" | "release", via: "poke" | "ray") => void;
  terrainSelect: (point: Vector3) => void;
  /** Table centre the diorama turns about. */
  pivot: () => Point2;
  /** Pinch + drag on the terrain: yaw in radians, or a two-hand zoom as the change in hand separation. */
  manipulate: (m: { yaw?: number; zoom?: { fromM: number; toM: number } }) => void;
}

export interface RayHit {
  onUi: boolean;
  point?: Vector3;
}

interface Slot {
  handedness?: Handedness;
  ray: XRTargetRaySpace;
  hand: XRHandSpace;
  line: Line;
  cursor: Mesh;
  pokes: Map<Panel, PokeTracker>;
  rayHeld?: { panel: Panel; id: string };
  /** A pinch that started on the terrain: a tap selects, a drag turns or zooms. */
  grab?: { point: Vector3; start: Vector3; last: Vector3; maxMove: number; dragging: boolean };
  hit: RayHit;
}

const RAY_LENGTH_M = 3;
/** Scratch objects reused every frame: no per-frame allocation in the render loop (AGENTS.md §6). */
const tmpTip = new Vector3();
const tmpDir = new Vector3();
const tmpQuat = new Quaternion();
const tmpHand = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();

export class HandInput {
  private readonly slots: Slot[] = [];
  private readonly raycaster = new Raycaster();

  constructor(
    renderer: WebGLRenderer,
    parent: Group | Object3D,
    private readonly hooks: InputHooks,
  ) {
    const factory = new XRHandModelFactory();
    for (const i of [0, 1]) {
      const ray = renderer.xr.getController(i);
      const hand = renderer.xr.getHand(i);
      hand.add(factory.createHandModel(hand, "spheres"));
      const line = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]), new LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7 }));
      line.scale.z = RAY_LENGTH_M;
      ray.add(line);
      const cursor = new Mesh(new SphereGeometry(0.006, 12, 8), new MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      cursor.renderOrder = 3;
      cursor.visible = false;
      parent.add(ray, hand, cursor);
      const slot: Slot = { ray, hand, line, cursor, pokes: new Map(), hit: { onUi: false } };
      ray.addEventListener("connected", (e) => {
        slot.handedness = e.data.handedness === "left" ? "left" : "right";
      });
      ray.addEventListener("disconnected", () => {
        slot.handedness = undefined;
      });
      ray.addEventListener("selectstart", () => this.selectStart(slot));
      ray.addEventListener("selectend", () => this.selectEnd(slot));
      this.slots.push(slot);
    }
  }

  /** Per-frame: fingertip pokes and ray hover. */
  update(): void {
    const panels = this.hooks.panels().filter((p) => p.mesh.visible);
    for (const slot of this.slots) {
      this.updatePokes(slot, panels);
      this.updateRay(slot, panels);
    }
    this.updateGrabs();
  }

  private updateGrabs(): void {
    const grabbing = this.slots.filter((s) => s.grab);
    for (const slot of grabbing) {
      const g = slot.grab;
      if (!g) continue;
      slot.ray.getWorldPosition(tmpHand);
      g.maxMove = Math.max(g.maxMove, tmpHand.distanceTo(g.start));
      if (g.maxMove >= TAP_MAX_MOVE_M) g.dragging = true;
    }
    const [a, b] = grabbing;
    if (a?.grab && b?.grab) {
      // Two-hand pinch: zoom by the change in distance between the hands.
      const pa = a.ray.getWorldPosition(tmpA);
      const pb = b.ray.getWorldPosition(tmpB);
      const fromM = a.grab.last.distanceTo(b.grab.last);
      const toM = pa.distanceTo(pb);
      if (a.grab.dragging || b.grab.dragging) this.hooks.manipulate({ zoom: { fromM, toM } });
      a.grab.last.copy(pa);
      b.grab.last.copy(pb);
      return;
    }
    if (a?.grab) {
      const now = a.ray.getWorldPosition(tmpA);
      if (a.grab.dragging) this.hooks.manipulate({ yaw: yawDelta(this.hooks.pivot(), a.grab.last, now) });
      a.grab.last.copy(now);
    }
  }

  /** Ray state of a hand, for the deictic resolver's pointer samples (VOICE.md §2). */
  rayHit(handedness: Handedness): RayHit {
    return this.slots.find((s) => s.handedness === handedness)?.hit ?? { onUi: false };
  }

  /** Left wrist and palm normal, when the left hand is tracked (wrist menu, INTERACTION.md §2 "Palm up"). */
  leftWrist(out: { position: Vector3; palmNormal: Vector3 }): boolean {
    const slot = this.slots.find((s) => s.handedness === "left");
    const wrist = slot?.hand.joints.wrist;
    if (!slot || !wrist || !wrist.visible) return false;
    wrist.getWorldPosition(out.position);
    wrist.getWorldQuaternion(tmpQuat);
    // WebXR joint space: +Y points out of the back of the hand, so the palm faces -Y.
    out.palmNormal.set(0, -1, 0).applyQuaternion(tmpQuat);
    return true;
  }

  private updatePokes(slot: Slot, panels: Panel[]): void {
    const tip = slot.hand.joints["index-finger-tip"];
    const tracked = tip !== undefined && tip.visible;
    if (tracked) tip.getWorldPosition(tmpTip);
    for (const panel of panels) {
      let tracker = slot.pokes.get(panel);
      if (!tracker) {
        tracker = new PokeTracker();
        slot.pokes.set(panel, tracker);
      }
      const edge = tracker.update(tracked ? panel.toLocal(tmpTip) : undefined, panel.buttons);
      if (edge) {
        panel.highlight(edge.kind === "press" ? edge.id : undefined);
        this.hooks.button(panel, edge.id, edge.kind, "poke");
      }
    }
    // A panel that was hidden mid-press releases cleanly.
    for (const [panel, tracker] of slot.pokes) {
      if (panels.includes(panel)) continue;
      const edge = tracker.update(undefined, []);
      if (edge) this.hooks.button(panel, edge.id, "release", "poke");
    }
  }

  private updateRay(slot: Slot, panels: Panel[]): void {
    const active = slot.handedness !== undefined && slot.ray.visible;
    slot.line.visible = active;
    slot.cursor.visible = false;
    slot.hit = { onUi: false };
    if (!active) return;
    const hit = this.cast(slot, panels);
    if (!hit) return;
    slot.cursor.visible = true;
    slot.cursor.position.copy(hit.point);
    slot.line.scale.z = Math.max(0.01, hit.distance);
    slot.hit = { onUi: hit.panel !== undefined, point: hit.panel ? undefined : hit.point };
  }

  private cast(slot: Slot, panels: Panel[]): { point: Vector3; distance: number; panel?: Panel; buttonId?: string } | undefined {
    slot.ray.getWorldPosition(this.raycaster.ray.origin);
    slot.ray.getWorldDirection(tmpDir);
    // Object3D.getWorldDirection returns +Z; the target ray points down -Z.
    this.raycaster.ray.direction.copy(tmpDir).negate();
    this.raycaster.far = RAY_LENGTH_M;
    const terrain = this.hooks.terrain();
    const hits = this.raycaster.intersectObjects(terrain ? [...panels.map((p) => p.mesh), terrain] : panels.map((p) => p.mesh), false);
    const first = hits[0];
    if (!first) return undefined;
    const panel = panels.find((p) => p.mesh === first.object);
    if (!panel) return { point: first.point, distance: first.distance };
    const local = panel.toLocal(first.point);
    const button = panel.buttons.find((b) => local.x >= b.rect.x && local.x <= b.rect.x + b.rect.w && local.y >= b.rect.y && local.y <= b.rect.y + b.rect.h);
    return { point: first.point, distance: first.distance, panel, buttonId: button?.id };
  }

  private selectStart(slot: Slot): void {
    const panels = this.hooks.panels().filter((p) => p.mesh.visible);
    const hit = this.cast(slot, panels);
    if (!hit) return;
    if (hit.panel) {
      if (!hit.buttonId) return;
      slot.rayHeld = { panel: hit.panel, id: hit.buttonId };
      hit.panel.highlight(hit.buttonId);
      this.hooks.button(hit.panel, hit.buttonId, "press", "ray");
      return;
    }
    const start = slot.ray.getWorldPosition(new Vector3());
    slot.grab = { point: hit.point.clone(), start, last: start.clone(), maxMove: 0, dragging: false };
  }

  private selectEnd(slot: Slot): void {
    const grab = slot.grab;
    slot.grab = undefined;
    if (grab && !grab.dragging && isTap(grab.maxMove)) this.hooks.terrainSelect(grab.point);
    const held = slot.rayHeld;
    if (!held) return;
    slot.rayHeld = undefined;
    held.panel.highlight(undefined);
    this.hooks.button(held.panel, held.id, "release", "ray");
  }
}
