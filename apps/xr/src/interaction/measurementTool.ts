// MeasurementTool: the scientist's ruler. Two pinches on the terrain; distance, height difference and gradient
// come from packages/terrain lineMeasurement on the full-resolution DEM (AGENTS.md rule 4). It is a measurement
// by code, shown with its method and source; it is not a finding and makes no claim about what the terrain means.
import { lineMeasurement } from "@nexus/terrain";
import type { DemGrid, LineMeasurement } from "@nexus/terrain";
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import type { TilePoint } from "@nexus/schemas";
import type { Vec3 } from "../scene/tabletop.js";
import { HEX } from "../ui/spatial/tokens.js";

export type MeasureState = { step: "first" } | { step: "second"; a: TilePoint } | { step: "done"; a: TilePoint; b: TilePoint; result: LineMeasurement } | { step: "error"; error: string };

const LIFT_M = 0.003;

export class MeasurementTool {
  /** Lives in the site's layout space, so it turns and zooms with the terrain. */
  readonly group = new Group();
  private readonly pins: [Mesh, Mesh];
  private readonly line: Line<BufferGeometry, LineBasicMaterial>;
  private _state: MeasureState = { step: "first" };

  constructor() {
    this.group.name = "measurement-tool";
    const pin = () => new Mesh(new SphereGeometry(0.0045, 16, 12), new MeshBasicMaterial({ color: HEX.selected, depthTest: false }));
    this.pins = [pin(), pin()];
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    this.line = new Line(g, new LineBasicMaterial({ color: HEX.accent, depthTest: false, transparent: true, opacity: 0.95 }));
    for (const o of [...this.pins, this.line]) {
      o.renderOrder = 4;
      o.visible = false;
      this.group.add(o);
    }
  }

  get state(): MeasureState {
    return this._state;
  }

  reset(): void {
    this._state = { step: "first" };
    for (const o of [...this.pins, this.line]) o.visible = false;
  }

  /** A pinch on the terrain at `layout` (scene layout point) / `tile` (tile metres). */
  addPoint(grid: DemGrid, layout: Vec3, tile: TilePoint): MeasureState {
    const s = this._state;
    if (s.step === "first" || s.step === "done" || s.step === "error") {
      this.reset();
      this.place(0, layout);
      this._state = { step: "second", a: tile };
      return this._state;
    }
    this.place(1, layout);
    const r = lineMeasurement(grid, s.a, tile);
    if (!r.ok) {
      this._state = { step: "error", error: r.error };
      this.pins[1].visible = false;
      return this._state;
    }
    const pos = this.line.geometry.getAttribute("position") as BufferAttribute;
    const [p0, p1] = this.pins;
    pos.setXYZ(0, p0.position.x, p0.position.y, p0.position.z);
    pos.setXYZ(1, p1.position.x, p1.position.y, p1.position.z);
    pos.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.line.visible = true;
    this._state = { step: "done", a: s.a, b: tile, result: r.value };
    return this._state;
  }

  private place(i: 0 | 1, p: Vec3): void {
    const pin = this.pins[i];
    pin.position.set(p.x, p.y + LIFT_M, p.z);
    pin.visible = true;
  }
}

/** Card lines for a measurement: every number from the DEM, with its method and source. Pure, for tests. */
export function measurementLines(r: LineMeasurement): string[] {
  const sign = r.heightDifferenceM > 0 ? "+" : "";
  const toward = r.heightDifferenceM > 0 ? "second point higher" : r.heightDifferenceM < 0 ? "second point lower" : "level";
  return [
    `Distance: ${fmt(r.horizontalM)} m (horizontal)`,
    `Height difference: ${sign}${fmt(r.heightDifferenceM)} m (${toward})`,
    `Mean gradient: ${r.gradientDeg.toFixed(1)}°`,
    `Elevation along the line: ${fmt(r.minElevationM)} to ${fmt(r.maxElevationM)} m (DTM datum)`,
  ];
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1).replace(/\.0$/, "");
}
