// Near-field UI panel: a canvas texture on a plane, with poke/ray buttons in panel-local metres.
// No UI library: keeps the Quest bundle small (AGENTS.md §10) and the hit areas exact for poke (≥ 4 cm, INTERACTION.md §3).
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import type { Object3D } from "three";
import type { Rect } from "../input/poke.js";
import { wrapText } from "./textLayout.js";

export type ButtonStyle = "primary" | "secondary" | "chip" | "danger" | "active";

export interface ButtonSpec {
  id: string;
  label: string;
  style?: ButtonStyle;
}

export interface PanelLine {
  text: string;
  tone: "title" | "body" | "muted" | "warn";
  badge?: string;
}

export interface PanelContent {
  lines: PanelLine[];
  /** Rows of buttons, laid out bottom-up below the text. */
  rows: ButtonSpec[][];
  /** Optional picture drawn under the first line (evidence windows). */
  image?: { source: CanvasImageSource; aspect: number; caption?: string };
}

export interface PanelButton extends ButtonSpec {
  rect: Rect;
}

const PX_PER_M = 2400;
const MARGIN = 0.014;
/** Poke targets ≥ 4 cm with ≥ 1 cm spacing (INTERACTION.md §3). */
export const BUTTON_H = 0.042;
const GAP = 0.01;
const FONT: Record<PanelLine["tone"], { size: number; color: string; weight: string }> = {
  title: { size: 0.0145, color: "#ffffff", weight: "700" },
  body: { size: 0.0102, color: "#e4ebf5", weight: "400" },
  muted: { size: 0.009, color: "#97a6bd", weight: "400" },
  warn: { size: 0.0097, color: "#ffc671", weight: "600" },
};
/** Top and bottom of each button's gradient, plus a rim colour that reads as a lit edge. */
const BUTTON_COLORS: Record<ButtonStyle, { top: string; bottom: string; rim: string; fg: string }> = {
  primary: { top: "#4aa8ff", bottom: "#2563eb", rim: "#9fd2ff", fg: "#ffffff" },
  secondary: { top: "#3a4560", bottom: "#262e44", rim: "#566383", fg: "#eef3ff" },
  chip: { top: "#1f7a82", bottom: "#135a62", rim: "#5fd9e3", fg: "#e9fdff" },
  danger: { top: "#d4525a", bottom: "#a02a38", rim: "#ff9aa2", fg: "#ffffff" },
  active: { top: "#ffa24d", bottom: "#e0662a", rim: "#ffd29c", fg: "#ffffff" },
};

export class Panel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  buttons: PanelButton[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private content: PanelContent = { lines: [], rows: [] };
  private page = 0;
  private highlighted?: string;
  private hovered?: string;

  constructor(
    readonly name: string,
    readonly widthM: number,
    readonly heightM: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(widthM * PX_PER_M);
    this.canvas.height = Math.round(heightM * PX_PER_M);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthTest: false }));
    this.mesh.name = name;
    // UI is drawn over the terrain so a zoomed-in diorama never hides a button.
    this.mesh.renderOrder = 5;
    this.mesh.userData.panel = this;
  }

  get object(): Object3D {
    return this.mesh;
  }

  set(content: PanelContent): void {
    this.content = content;
    this.page = 0;
    this.render();
  }

  /** Visual feedback while a finger or ray holds a button (INTERACTION.md §3 "5 % scale bump"). */
  highlight(id: string | undefined): void {
    if (this.highlighted === id) return;
    this.highlighted = id;
    this.render();
  }

  /** Lights the button under a ray or the mouse so it is obvious what a pinch or click will press. */
  hover(id: string | undefined): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.render();
  }

  /** Handles the built-in paging buttons; returns true if `id` was one of them. */
  handlePaging(id: string): boolean {
    if (id === "page:next") this.page++;
    else if (id === "page:prev") this.page = Math.max(0, this.page - 1);
    else return false;
    this.render();
    return true;
  }

  /** World point → panel-local metres, origin bottom-left, z out of the face. */
  toLocal(world: Vector3): { x: number; y: number; z: number } {
    const p = this.mesh.worldToLocal(world.clone());
    return { x: p.x + this.widthM / 2, y: p.y + this.heightM / 2, z: p.z };
  }

  /** A button's centre and face normal in world space, for the emulator's target resolver. */
  buttonWorld(id: string): { position: Vector3; normal: Vector3; size: Vector3 } | undefined {
    const b = this.buttons.find((x) => x.id === id);
    if (!b || !this.mesh.visible) return undefined;
    this.mesh.updateWorldMatrix(true, false);
    const position = this.mesh.localToWorld(new Vector3(b.rect.x + b.rect.w / 2 - this.widthM / 2, b.rect.y + b.rect.h / 2 - this.heightM / 2, 0));
    const normal = new Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld);
    return { position, normal, size: new Vector3(b.rect.w, b.rect.h, 0.01) };
  }

  private render(): void {
    const { ctx, canvas } = this;
    const s = PX_PER_M;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Glass card: deep navy gradient, a lit rim and a cyan-to-violet accent bar along the top edge.
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "rgba(24, 32, 54, 0.95)");
    bg.addColorStop(1, "rgba(10, 13, 24, 0.95)");
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 0.016 * s);
    ctx.fill();
    ctx.lineWidth = 0.0016 * s;
    ctx.strokeStyle = "rgba(120, 190, 255, 0.55)";
    roundRect(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth, 0.016 * s);
    ctx.stroke();
    const bar = ctx.createLinearGradient(0, 0, canvas.width, 0);
    bar.addColorStop(0, "#37d6ff");
    bar.addColorStop(1, "#9a6bff");
    ctx.fillStyle = bar;
    roundRect(ctx, 0.016 * s, 0.0045 * s, canvas.width - 0.032 * s, 0.0032 * s, 0.0016 * s);
    ctx.fill();

    // Buttons bottom-up; text fills what is left above them.
    const rows = [...this.content.rows];
    const textLines = this.layoutText();
    const textBottom = (MARGIN + (rows.length + 1) * (BUTTON_H + GAP)) * s;
    const img = this.content.image;
    const imgH = img ? Math.min((this.widthM - 2 * MARGIN) / img.aspect, this.heightM * 0.42) * s : 0;
    const pages = paginate(textLines, canvas.height - textBottom - MARGIN * s - imgH);
    this.page = Math.min(this.page, pages.length - 1);
    if (pages.length > 1) {
      rows.push([
        { id: "page:prev", label: "◀ Previous", style: "secondary" },
        { id: "page:next", label: `More (${this.page + 1}/${pages.length}) ▶`, style: "secondary" },
      ]);
    }
    this.buttons = [];
    rows.forEach((row, r) => {
      const y = MARGIN + r * (BUTTON_H + GAP);
      const w = (this.widthM - 2 * MARGIN - (row.length - 1) * GAP) / row.length;
      row.forEach((b, i) => this.buttons.push({ ...b, rect: { x: MARGIN + i * (w + GAP), y, w, h: BUTTON_H } }));
    });

    let y = MARGIN * s;
    let lineIndex = 0;
    for (const l of pages[this.page] ?? []) {
      if (img && lineIndex === 1) {
        const w = imgH * img.aspect;
        ctx.drawImage(img.source, MARGIN * s, y, w, imgH);
        y += imgH + 0.004 * s;
      }
      lineIndex++;
      const f = FONT[l.tone];
      ctx.font = `${f.weight} ${Math.round(f.size * s)}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      let x = MARGIN * s;
      if (l.badge) {
        const bw = ctx.measureText(l.badge).width + 0.008 * s;
        ctx.fillStyle = "#4b3fa8";
        roundRect(ctx, x, y - 0.001 * s, bw, f.size * 1.25 * s, 0.003 * s);
        ctx.fill();
        ctx.fillStyle = "#f1eeff";
        ctx.fillText(l.badge, x + 0.004 * s, y);
        x += bw + 0.004 * s;
      }
      ctx.fillStyle = f.color;
      ctx.fillText(l.text, x, y);
      y += f.size * (l.gapAfter ? 1.9 : 1.4) * s;
    }

    for (const b of this.buttons) {
      const pressed = this.highlighted === b.id;
      const hot = pressed || this.hovered === b.id;
      const c = BUTTON_COLORS[pressed ? "active" : (b.style ?? "secondary")];
      const bump = pressed ? 0.025 : this.hovered === b.id ? 0.012 : 0;
      const px = b.rect.x * s - b.rect.w * s * bump;
      const py = canvas.height - (b.rect.y + b.rect.h) * s - b.rect.h * s * bump;
      const bw = b.rect.w * s * (1 + 2 * bump);
      const bh = b.rect.h * s * (1 + 2 * bump);
      const fill = ctx.createLinearGradient(0, py, 0, py + bh);
      fill.addColorStop(0, c.top);
      fill.addColorStop(1, c.bottom);
      if (hot) {
        ctx.shadowColor = c.rim;
        ctx.shadowBlur = 0.012 * s;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, px, py, bw, bh, 0.01 * s);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = (hot ? 0.0018 : 0.001) * s;
      ctx.strokeStyle = hot ? "#ffffff" : c.rim;
      ctx.globalAlpha = hot ? 1 : 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.fg;
      ctx.font = `600 ${Math.round(0.0112 * s)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, b.label, b.rect.w * s - 0.008 * s), px + bw / 2, py + bh / 2);
      ctx.textAlign = "left";
    }
    this.texture.needsUpdate = true;
  }

  /** Wrap every line to the panel width; badges take room on the first wrapped line. */
  private layoutText(): (PanelLine & { gapAfter?: boolean })[] {
    const { ctx } = this;
    const s = PX_PER_M;
    const out: (PanelLine & { gapAfter?: boolean })[] = [];
    for (const l of this.content.lines) {
      const f = FONT[l.tone];
      ctx.font = `${f.weight} ${Math.round(f.size * s)}px system-ui, sans-serif`;
      const badgeW = l.badge ? ctx.measureText(l.badge).width + 0.012 * s : 0;
      const wrapped = wrapText(l.text, (this.widthM - 2 * MARGIN) * s - badgeW, (t) => ctx.measureText(t).width);
      wrapped.forEach((t, i) => out.push({ text: t, tone: l.tone, badge: i === 0 ? l.badge : undefined, gapAfter: i === wrapped.length - 1 }));
    }
    return out;
  }
}

function paginate<T extends PanelLine & { gapAfter?: boolean }>(lines: T[], heightPx: number): T[][] {
  const pages: T[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = FONT[l.tone].size * (l.gapAfter ? 1.9 : 1.4) * PX_PER_M;
    if (used + h > heightPx && (pages[pages.length - 1]?.length ?? 0) > 0) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]?.push(l);
    used += h;
  }
  return pages;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
