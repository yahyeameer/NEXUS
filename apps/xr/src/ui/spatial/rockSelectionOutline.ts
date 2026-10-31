// RockSelectionOutline: a glowing line draped on the terrain around the selected feature's real footprint
// (crater rim, slope patch, rille course), so the scientist sees exactly what was picked. Heights come from the DEM.
import type { TerrainFeature, TilePoint } from "@nexus/schemas";
import { sampleElevation } from "@nexus/terrain";
import type { DemGrid } from "@nexus/terrain";
import { AdditiveBlending, CatmullRomCurve3, Mesh, MeshBasicMaterial, TubeGeometry, Vector3 } from "three";
import type { TileFrame } from "../../scene/tabletop.js";
import { tileToScene } from "../../scene/tabletop.js";
import { HEX } from "./tokens.js";

/** Footprint of a feature in tile metres: a closed ring for areas, the course for a rille. Pure. */
export function outlinePath(f: TerrainFeature, ringPoints = 72): { points: TilePoint[]; closed: boolean } {
  const circle = (c: TilePoint, r: number) => ({
    points: Array.from({ length: ringPoints }, (_, i) => {
      const a = (i / ringPoints) * Math.PI * 2;
      return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
    }),
    closed: true,
  });
  switch (f.kind) {
    case "crater":
      return circle(f.center, f.rimRadiusM);
    case "slope":
      return circle(f.center, f.radiusM);
    case "point":
      return circle(f.center, 40);
    case "rille": {
      // Densify so the tube hugs the ground between the path's vertices.
      const out: TilePoint[] = [];
      for (let i = 1; i < f.path.length; i++) {
        const a = f.path[i - 1];
        const b = f.path[i];
        if (!a || !b) continue;
        const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 25));
        for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
      const last = f.path[f.path.length - 1];
      if (last) out.push(last);
      return { points: out, closed: false };
    }
  }
}

const LIFT_M = 0.003;

export class RockSelectionOutline {
  readonly mesh: Mesh<TubeGeometry, MeshBasicMaterial>;
  private target = 0;
  private level = 0;
  private shownId?: string;

  constructor() {
    this.mesh = new Mesh(new TubeGeometry(), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: AdditiveBlending }));
    this.mesh.name = "selection-outline";
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Drapes the outline on `grid` in layout coordinates (the site group's space). */
  show(f: TerrainFeature, grid: DemGrid, frame: TileFrame, minElevation: number): void {
    if (this.shownId !== f.id) {
      const { points, closed } = outlinePath(f);
      const scene = points.map((p) => {
        const s = tileToScene(frame, { x: p.x, y: sampleElevation(grid, p) ?? minElevation, z: p.z });
        return new Vector3(s.x, s.y + LIFT_M, s.z);
      });
      if (scene.length < 2) return;
      this.mesh.geometry.dispose();
      this.mesh.geometry = new TubeGeometry(new CatmullRomCurve3(scene, closed), Math.min(400, scene.length * 3), 0.0012, 5, closed);
      this.shownId = f.id;
    }
    this.target = 1;
    this.mesh.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  update(now: number, dtMs: number): void {
    if (!this.mesh.visible) return;
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dtMs / 200);
    if (this.level <= 0 && this.target === 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.material.opacity = this.level * (0.75 + 0.2 * Math.sin(now / 420));
  }
}
