// AgentActivityPanel: a small, non-interactive glass card floating over the feature under investigation, listing
// which agents are working, done or stuck. It shows work, never results: findings only appear after the SIE.
import type { Vector3 } from "three";
import { agentName } from "../findingView.js";
import { SpatialGlassPanel } from "./glassPanel.js";
import type { PanelLine } from "./glassPanel.js";

export type AgentState = "working" | "done" | "failed";

const STATE_LABEL: Record<AgentState, string> = { working: "Working", done: "Done", failed: "Stopped" };

/** Agents listed by name before the rest are summed up, so the card stays small and readable. */
const MAX_LISTED = 4;

/** Lines for the panel: a heading with a tally, then the agents still working first. Pure. */
export function agentActivityLines(agents: ReadonlyMap<string, AgentState>): PanelLine[] {
  const all = [...agents];
  const done = all.filter(([, s]) => s === "done").length;
  const lines: PanelLine[] = [{ text: "Research team", tone: "title" }];
  if (all.length === 0) {
    lines.push({ text: "Waiting for the team to start.", tone: "muted" });
    return lines;
  }
  lines.push({ text: `${done} of ${all.length} agents done`, tone: "muted" });
  const order: Record<AgentState, number> = { working: 0, failed: 1, done: 2 };
  const sorted = all.sort((a, b) => order[a[1]] - order[b[1]]);
  for (const [id, state] of sorted.slice(0, MAX_LISTED)) lines.push({ text: agentName(id), tone: state === "failed" ? "warn" : state === "done" ? "muted" : "body", badge: STATE_LABEL[state] });
  if (sorted.length > MAX_LISTED) lines.push({ text: `+${sorted.length - MAX_LISTED} more`, tone: "muted" });
  return lines;
}

/** Height above the anchor, in metres, so the card clears the marker and the agent orbs. */
const LIFT_M = 0.14;

export class AgentActivityPanel extends SpatialGlassPanel {
  constructor() {
    super("agents", 0.26, 0.15, false);
    this.setOpen(false);
  }

  show(agents: ReadonlyMap<string, AgentState>): void {
    this.set({ lines: agentActivityLines(agents), rows: [] });
    this.open();
  }

  /** Keeps the card over `anchorWorld`, facing the viewer; the diorama may be turning underneath it. */
  follow(anchorWorld: Vector3, viewer: Vector3): void {
    if (!this.mesh.visible) return;
    anchorWorld.y += LIFT_M;
    this.mesh.position.copy(anchorWorld);
    this.mesh.lookAt(viewer);
  }
}
