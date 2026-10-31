// ObservationCapture: mark any spot on the terrain and save it as the scientist's own observation (OBS-…), with
// the words they poke recorded verbatim (SIE VA1). Saving does not start research; Investigate on a feature does.
import { Group, Mesh, MeshBasicMaterial, CylinderGeometry, SphereGeometry } from "three";
import type { TilePoint } from "@nexus/schemas";
import type { Vec3 } from "../scene/tabletop.js";
import { HEX } from "../ui/spatial/tokens.js";

export interface PendingMark {
  layout: Vec3;
  tile: TilePoint & { y: number };
}

export class ObservationCapture {
  /** In the site's layout space; one pin per saved observation plus the pending one. */
  readonly group = new Group();
  private pending?: { mark: PendingMark; pin: Group };
  private readonly saved: { id: string; pin: Group }[] = [];

  constructor() {
    this.group.name = "observation-pins";
  }

  get pendingMark(): PendingMark | undefined {
    return this.pending?.mark;
  }

  get savedIds(): string[] {
    return this.saved.map((s) => s.id);
  }

  mark(m: PendingMark): void {
    this.cancel();
    const pin = makePin(HEX.selected);
    pin.position.set(m.layout.x, m.layout.y, m.layout.z);
    this.group.add(pin);
    this.pending = { mark: m, pin };
  }

  cancel(): void {
    if (this.pending) this.group.remove(this.pending.pin);
    this.pending = undefined;
  }

  /** The API stored it: keep the pin, in the saved colour. */
  commit(id: string): void {
    if (!this.pending) return;
    const pin = this.pending.pin;
    pin.traverse((o) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (m && "color" in m) m.color.setHex(HEX.accent);
    });
    this.saved.push({ id, pin });
    this.pending = undefined;
  }

  clear(): void {
    this.cancel();
    for (const s of this.saved) this.group.remove(s.pin);
    this.saved.length = 0;
  }
}

function makePin(color: number): Group {
  const g = new Group();
  const stem = new Mesh(new CylinderGeometry(0.0007, 0.0007, 0.022, 8), new MeshBasicMaterial({ color }));
  stem.position.y = 0.011;
  const head = new Mesh(new SphereGeometry(0.0038, 16, 12), new MeshBasicMaterial({ color }));
  head.position.y = 0.022;
  g.add(stem, head);
  return g;
}
