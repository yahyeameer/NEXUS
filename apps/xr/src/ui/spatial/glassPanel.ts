// SpatialGlassPanel: the base of every NEXUS panel. A canvas texture on a plane, with poke/ray buttons in panel-local
// metres, a dark translucent glass look and smooth open, close and glide transitions.
// No UI library: keeps the Quest bundle small (AGENTS.md §10) and the hit areas exact for poke (≥ 4 cm, INTERACTION.md §3).
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import type { Object3D } from "three";
import type { Rect } from "../../input/poke.js";
import { wrapText } from "../textLayout.js";
import { BADGE, BUTTON, COLOR, FONT_FAMILY, MOTION, SPACE, TYPE } from "./tokens.js";
import type { BadgeTone, ButtonTone, TextTone } from "./tokens.js";

export type ButtonStyle = ButtonTone;

export interface ButtonSpec {
  id: string;
  label: string;
  style?: ButtonStyle;
}

export interface PanelLine {
  text: string;
  tone: TextTone;
  badge?: string;
  /** Badge colour; claim types and uncertainty levels each have one (tokens.ts BADGE). */
  badgeTone?: BadgeTone;
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
const MARGIN = SPACE.margin;
/** Poke targets ≥ 4 cm with ≥ 1 cm spacing (INTERACTION.md §3). */
export const BUTTON_H = SPACE.buttonH;
const GAP = SPACE.gap;
const FONT = TYPE;
const BUTTON_COLORS = BUTTON;

function font(tone: TextTone): string {
  const f = FONT[tone];
  return `${f.weight} ${Math.round(f.size * PX_PER_M)}px ${FONT_FAMILY}`;
}

type Fade = { kind: "open" | "close"; start: number };
type Glide = { from: Vector3; to: Vector3; face: Vector3; start: number };

export class SpatialGlassPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  buttons: PanelButton[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private content: PanelContent = { lines: [], rows: [] };
  private page = 0;
  private highlighted?: string;
  private hovered?: string;
  private fade?: Fade;
  private glide?: Glide;
  private closing = false;
  /** Height of glass actually drawn, up from the bottom edge; the panel shrinks to its content (no empty glass). */
  private visibleH: number;

  constructor(
    readonly name: string,
    readonly widthM: number,
    readonly heightM: number,
    /** Display-only panels (no buttons) show their first page and never grow paging buttons. */
    private readonly paging = true,
  ) {
    this.visibleH = heightM;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(widthM * PX_PER_M);
    this.canvas.height = Math.round(heightM * PX_PER_M);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), new MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 1, side: DoubleSide, depthTest: false, depthWrite: false }));
    this.mesh.name = name;
    // UI is drawn over the terrain so a zoomed-in diorama never hides a button.
    this.mesh.renderOrder = 5;
    this.mesh.userData.panel = this;
  }

  get object(): Object3D {
    return this.mesh;
  }

  /** Panel-local y (metres from the centre) of the drawn glass's bottom edge, for connectors and beams. */
  get bottomM(): number {
    return -this.heightM / 2;
  }

  /** Panel-local y (metres from the centre) of the drawn glass's top edge. */
  get topM(): number {
    return -this.heightM / 2 + this.visibleH;
  }

  /**
   * Sharper text when a panel is seen at an angle (the 3D viewer, a card turned toward the model). Call once with the
   * renderer's maximum; costs a little texture bandwidth, nothing per frame.
   */
  setAnisotropy(level: number): void {
    this.texture.anisotropy = level;
    this.texture.needsUpdate = true;
  }

  /** Shown, or on its way in. */
  get isOpen(): boolean {
    return this.mesh.visible && !this.closing;
  }

  /** Can take pokes and ray presses: open or opening, never while fading out. */
  get interactive(): boolean {
    return this.isOpen;
  }

  /** Not moving or fading in, so a fingertip aimed at a button now will still find it there. */
  get settled(): boolean {
    return this.isOpen && !this.glide && this.fade?.kind !== "open";
  }

  /** Fades and scales in. Calling it on an open panel does nothing. */
  open(now = performance.now()): void {
    if (this.isOpen) return;
    this.closing = false;
    this.mesh.visible = true;
    this.fade = { kind: "open", start: now };
    this.applyFade(0);
  }

  /** Fades out, then hides. Input stops at once so a finger cannot press a fading button. */
  close(now = performance.now()): void {
    if (!this.mesh.visible || this.closing) return;
    this.closing = true;
    this.fade = { kind: "close", start: now };
  }

  /** Show or hide without a transition (initial state, tests). */
  setOpen(open: boolean): void {
    this.fade = undefined;
    this.closing = false;
    this.mesh.visible = open;
    this.applyFade(1);
  }

  /** Puts the panel at `position` facing `face`, at once. */
  place(position: Vector3, face: Vector3): void {
    this.glide = undefined;
    this.mesh.position.copy(position);
    this.mesh.lookAt(face);
  }

  /** Slides to `position` facing `face`; `from` starts it somewhere else, e.g. at the rock it belongs to. */
  glideTo(position: Vector3, face: Vector3, from?: Vector3, now = performance.now()): void {
    if (from) this.mesh.position.copy(from);
    if (!from && this.mesh.position.distanceToSquared(position) < 1e-6) return this.place(position, face);
    this.glide = { from: this.mesh.position.clone(), to: position.clone(), face: face.clone(), start: now };
  }

  /** Advances transitions; call once per frame. Allocation-free. */
  update(now: number): void {
    const g = this.glide;
    if (g) {
      const t = MOTION.ease((now - g.start) / MOTION.glideMs);
      this.mesh.position.lerpVectors(g.from, g.to, t);
      this.mesh.lookAt(g.face);
      if (t >= 1) this.glide = undefined;
    }
    const f = this.fade;
    if (!f) return;
    const dur = f.kind === "open" ? MOTION.openMs : MOTION.closeMs;
    const t = MOTION.ease((now - f.start) / dur);
    this.applyFade(f.kind === "open" ? t : 1 - t);
    if (t < 1) return;
    this.fade = undefined;
    if (f.kind === "close") {
      this.mesh.visible = false;
      this.closing = false;
      this.applyFade(1);
    }
  }

  private applyFade(k: number): void {
    this.mesh.material.opacity = k;
    this.mesh.scale.setScalar(0.94 + 0.06 * k);
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
    if (!b || !this.settled) return undefined;
    this.mesh.updateWorldMatrix(true, false);
    const position = this.mesh.localToWorld(new Vector3(b.rect.x + b.rect.w / 2 - this.widthM / 2, b.rect.y + b.rect.h / 2 - this.heightM / 2, 0));
    const normal = new Vector3(0, 0, 1).transformDirection(this.mesh.matrixWorld);
    return { position, normal, size: new Vector3(b.rect.w, b.rect.h, 0.01) };
  }

  private render(): void {
    const { ctx, canvas } = this;
    const s = PX_PER_M;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Buttons bottom-up; text fills what is left above them.
    const rows = [...this.content.rows];
    const textLines = this.layoutText();
    const textBottom = (MARGIN + (rows.length + 1) * (BUTTON_H + GAP)) * s;
    const img = this.content.image;
    const imgH = img ? Math.min((this.widthM - 2 * MARGIN) / img.aspect, this.heightM * 0.42) * s : 0;
    const pages = paginate(textLines, canvas.height - textBottom - MARGIN * s - imgH);
    this.page = Math.min(this.page, pages.length - 1);
    if (pages.length > 1 && this.paging) {
      rows.push([
        { id: "page:prev", label: "◀ Previous", style: "secondary" },
        { id: "page:next", label: `More (${this.page + 1}/${pages.length}) ▶`, style: "secondary" },
      ]);
    }
    // Fit the glass to what this page holds, so a short screen is a short card rather than a tall empty one. Buttons
    // keep their place at the bottom (steady poke targets, captions stay adjacent); the empty glass comes off the top.
    // Paged panels and display-only panels with no text keep their full size.
    const pageText = (pages[this.page] ?? []).reduce((h, l) => h + FONT[l.tone].size * (l.gapAfter ? 1.9 : 1.4), 0);
    const needed = 2 * MARGIN + pageText + (img ? imgH / s + 0.004 : 0) + rows.length * (BUTTON_H + GAP) + (rows.length ? GAP : 0);
    this.fitTo(pages.length > 1 || textLines.length === 0 ? this.heightM : Math.min(this.heightM, Math.max(needed, 0.08)));
    this.buttons = [];
    rows.forEach((row, r) => {
      const y = MARGIN + r * (BUTTON_H + GAP);
      const w = (this.widthM - 2 * MARGIN - (row.length - 1) * GAP) / row.length;
      row.forEach((b, i) => this.buttons.push({ ...b, rect: { x: MARGIN + i * (w + GAP), y, w, h: BUTTON_H } }));
    });

    const top = (this.heightM - this.visibleH) * s;
    this.drawGlass(top, this.visibleH * s);
    let y = top + MARGIN * s;
    let lineIndex = 0;
    for (const l of pages[this.page] ?? []) {
      if (img && lineIndex === 1) {
        const w = imgH * img.aspect;
        ctx.drawImage(img.source, MARGIN * s, y, w, imgH);
        y += imgH + 0.004 * s;
      }
      lineIndex++;
      const f = FONT[l.tone];
      ctx.font = font(l.tone);
      ctx.textBaseline = "top";
      let x = MARGIN * s;
      if (l.badge) {
        const bw = ctx.measureText(l.badge).width + 0.008 * s;
        const tone = BADGE[l.badgeTone ?? "default"];
        ctx.fillStyle = tone.bg;
        roundRect(ctx, x, y - 0.001 * s, bw, f.size * 1.25 * s, 0.003 * s);
        ctx.fill();
        ctx.fillStyle = tone.fg;
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
        // A wider translucent rim reads as a glow; canvas shadowBlur does too but costs far more on every hover change.
        ctx.fillStyle = c.rim;
        ctx.globalAlpha = 0.35;
        roundRect(ctx, px - 0.004 * s, py - 0.004 * s, bw + 0.008 * s, bh + 0.008 * s, 0.014 * s);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, px, py, bw, bh, SPACE.buttonRadius * s);
      ctx.fill();
      ctx.lineWidth = (hot ? 0.0018 : 0.001) * s;
      ctx.strokeStyle = hot ? "#ffffff" : c.rim;
      ctx.globalAlpha = hot ? 1 : 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.fg;
      ctx.font = `600 ${Math.round(0.011 * s)}px ${FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, b.label, b.rect.w * s - 0.008 * s), px + bw / 2, py + bh / 2);
      ctx.textAlign = "left";
    }
    this.texture.needsUpdate = true;
  }

  /** Dark translucent glass with a faint lit rim and a thin cyan accent along the top edge, from `top`, `h` pixels tall. */
  private drawGlass(top: number, h: number): void {
    const { ctx, canvas } = this;
    const s = PX_PER_M;
    const bg = ctx.createLinearGradient(0, top, 0, top + h);
    bg.addColorStop(0, COLOR.glassTop);
    bg.addColorStop(1, COLOR.glassBottom);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, top, canvas.width, h, SPACE.radius * s);
    ctx.fill();
    ctx.lineWidth = 0.0014 * s;
    ctx.strokeStyle = COLOR.glassRim;
    roundRect(ctx, ctx.lineWidth / 2, top + ctx.lineWidth / 2, canvas.width - ctx.lineWidth, h - ctx.lineWidth, SPACE.radius * s);
    ctx.stroke();
    const bar = ctx.createLinearGradient(0, 0, canvas.width, 0);
    bar.addColorStop(0, "rgba(79, 216, 255, 0)");
    bar.addColorStop(0.5, COLOR.accent);
    bar.addColorStop(1, "rgba(79, 216, 255, 0)");
    ctx.fillStyle = bar;
    ctx.fillRect(SPACE.radius * s, top + 0.0016 * s, canvas.width - 2 * SPACE.radius * s, 0.0016 * s);
  }

  /**
   * Trims the plane to the bottom `h` metres of the canvas. The mesh origin stays at the full panel's centre, so
   * button rects, poke and ray mapping (toLocal) are unchanged; only the drawn and hittable area shrinks, which also
   * keeps an empty strip of glass from blocking a ray aimed at the terrain behind it.
   */
  private fitTo(h: number): void {
    if (Math.abs(h - this.visibleH) < 1e-4) return;
    this.visibleH = h;
    const pos = this.mesh.geometry.getAttribute("position");
    const uv = this.mesh.geometry.getAttribute("uv");
    // PlaneGeometry(1×1 segments): vertices 0,1 on top, 2,3 on the bottom; canvas row 0 is uv v = 1.
    pos.setY(0, -this.heightM / 2 + h);
    pos.setY(1, -this.heightM / 2 + h);
    uv.setY(0, h / this.heightM);
    uv.setY(1, h / this.heightM);
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.geometry.computeBoundingBox();
  }

  /** Wrap every line to the panel width; badges take room on the first wrapped line. */
  private layoutText(): (PanelLine & { gapAfter?: boolean })[] {
    const { ctx } = this;
    const s = PX_PER_M;
    const out: (PanelLine & { gapAfter?: boolean })[] = [];
    for (const l of this.content.lines) {
      ctx.font = font(l.tone);
      const badgeW = l.badge ? ctx.measureText(l.badge).width + 0.012 * s : 0;
      const wrapped = wrapText(l.text, (this.widthM - 2 * MARGIN) * s - badgeW, (t) => ctx.measureText(t).width);
      wrapped.forEach((t, i) => out.push({ text: t, tone: l.tone, badge: i === 0 ? l.badge : undefined, badgeTone: l.badgeTone, gapAfter: i === wrapped.length - 1 }));
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
