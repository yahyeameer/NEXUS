// ResearchStatusIndicator: a small pill floating over a feature saying where its research stands. Words follow
// AGENTS.md §10: never "confirmed", "discovered" or "proven"; a reviewed finding is one *the scientist* approved.
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import type { Vector3 } from "three";
import type { RingState } from "../findingView.js";
import { COLOR, FONT_FAMILY } from "./tokens.js";

const LABEL: Record<RingState, { text: string; dot: string }> = {
  observed: { text: "Observed", dot: "#8b9bb0" },
  researching: { text: "Researching", dot: COLOR.accent },
  needs_evidence: { text: "Needs evidence", dot: "#ffb84d" },
  ready: { text: "Ready for review", dot: "#ffb84d" },
  reviewed: { text: "Approved by you", dot: "#5fd39a" },
  closed: { text: "Closed by you", dot: "#7c8796" },
};

/** The pill's words for a research state. Pure, so the vocabulary is unit-tested. */
export function statusLabel(state: RingState): string {
  return LABEL[state].text;
}

const W_M = 0.1;
const H_M = 0.022;
const PX_PER_M = 2600;

export class ResearchStatusIndicator {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: CanvasTexture;
  private state?: RingState;

  constructor(name: string) {
    this.canvas.width = Math.round(W_M * PX_PER_M);
    this.canvas.height = Math.round(H_M * PX_PER_M);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(W_M, H_M), new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.name = `status:${name}`;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  set(state: RingState | undefined): void {
    if (state === this.state) return;
    this.state = state;
    this.mesh.visible = state !== undefined;
    if (state) this.draw(state);
  }

  /** Faces the viewer and cancels the diorama's zoom so the pill stays one readable size. */
  face(viewer: Vector3, parentScale: number): void {
    if (!this.mesh.visible) return;
    this.mesh.lookAt(viewer);
    this.mesh.scale.setScalar(1 / parentScale);
  }

  private draw(state: RingState): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const { text, dot } = LABEL[state];
    ctx.clearRect(0, 0, w, h);
    ctx.font = `600 ${Math.round(h * 0.46)}px ${FONT_FAMILY}`;
    const tw = Math.min(w - h * 1.4, ctx.measureText(text).width);
    const pw = tw + h * 1.3;
    const x = (w - pw) / 2;
    ctx.fillStyle = "rgba(8, 13, 22, 0.86)";
    ctx.beginPath();
    ctx.roundRect(x, 1, pw, h - 2, (h - 2) / 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.glassRim;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x + h * 0.48, h / 2, h * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR.textStrong;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + h * 0.8, h / 2 + 1, tw);
    this.texture.needsUpdate = true;
  }
}
