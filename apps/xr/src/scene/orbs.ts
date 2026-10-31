// Agent orbs (PRD §6.4, INTERACTION.md §4 "Researching: pulsing + agent orbs"): one small light per dispatched
// agent circling above the feature it investigates; the one that is speaking pulses. Purely visual: no claims.
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import type { Vec3 } from "./tabletop.js";

export type OrbState = "working" | "done" | "failed";

const COLORS: Record<OrbState, number> = { working: 0x9bb8ff, done: 0xdfe8ff, failed: 0x6b6b6b };
const GEOMETRY = new SphereGeometry(0.009, 16, 12);

interface Orb {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  state: OrbState;
  phase: number;
}

export class AgentOrbs {
  /** Lives inside the diorama so orbs turn and zoom with the terrain. */
  readonly group = new Group();
  private readonly orbs = new Map<string, Orb>();
  private anchor?: Vec3;
  private speaking?: string;
  private fadeAt?: number;

  constructor() {
    this.group.name = "agent-orbs";
  }

  /** Starts a fresh set of orbs over a feature's anchor (layout coordinates). */
  begin(anchor: Vec3): void {
    this.clear();
    this.anchor = anchor;
  }

  set(agentId: string, state: OrbState): void {
    if (!this.anchor) return;
    let orb = this.orbs.get(agentId);
    if (!orb) {
      orb = { mesh: new Mesh(GEOMETRY, new MeshBasicMaterial({ color: COLORS[state], transparent: true })), state, phase: this.orbs.size * 1.3 };
      orb.mesh.name = `orb:${agentId}`;
      this.orbs.set(agentId, orb);
      this.group.add(orb.mesh);
    }
    orb.state = state;
    orb.mesh.material.color.setHex(COLORS[state]);
    this.fadeAt = undefined;
  }

  speaker(agentId: string | undefined): void {
    this.speaking = agentId;
  }

  /** Research is over: orbs linger briefly, then leave. */
  finish(now: number): void {
    this.fadeAt = now + 6000;
  }

  /** Each agent's state, for the AgentActivityPanel. */
  states(): Map<string, OrbState> {
    return new Map([...this.orbs].map(([id, o]) => [id, o.state]));
  }

  get count(): number {
    return this.orbs.size;
  }

  update(now: number): void {
    const a = this.anchor;
    if (!a) return;
    if (this.fadeAt !== undefined && now > this.fadeAt && this.speaking === undefined) {
      this.clear();
      return;
    }
    for (const [id, orb] of this.orbs) {
      const t = now / 1400 + orb.phase;
      const r = 0.05;
      orb.mesh.position.set(a.x + Math.cos(t) * r, a.y + 0.06 + Math.sin(t * 2) * 0.006, a.z + Math.sin(t) * r);
      const pulse = id === this.speaking ? 1.4 + 0.3 * Math.sin(now / 120) : orb.state === "working" ? 1 + 0.15 * Math.sin(now / 200 + orb.phase) : 1;
      orb.mesh.scale.setScalar(pulse);
    }
  }

  clear(): void {
    for (const orb of this.orbs.values()) {
      this.group.remove(orb.mesh);
      orb.mesh.material.dispose();
    }
    this.orbs.clear();
    this.anchor = undefined;
    this.fadeAt = undefined;
  }
}
