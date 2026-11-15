// SpatialGlassPanel: the base of every NEXUS panel. A canvas texture on a plane, with poke/ray buttons in panel-local
// metres, a dark translucent glass look and smooth open, close and glide transitions.
// No UI library: keeps the Quest bundle small (AGENTS.md §10) and the hit areas exact for poke (≥ 4 cm, INTERACTION.md §3).
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import type { Object3D } from "three";
import type { Rect } from "../../input/poke.js";
import { wrapText } from "../textLayout.js";
import { HoloFrame } from "./holoFrame.js";
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
  /** Small capitals above the title saying what kind of card this is, e.g. "FINDING", "SITE". */
  eyebrow?: string;
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

type LaidLine = PanelLine & { gapAfter?: boolean; headerEnd?: boolean };

/** Eyebrow row above the title, in metres. */
const EYEBROW_H = 0.0145;

/** Height a laid-out line takes, in metres: roomier leading than before, and air above a section label. */
function lineHeight(l: LaidLine): number {
  const size = FONT[l.tone].size;
  if (l.tone === "label") return size * 2.5;
  if (l.headerEnd) return size * 1.3 + 0.012;
  return size * (l.gapAfter ? 2.0 : 1.42);
}

/** Pill text: a little smaller and bolder than the line it sits on, never larger than body text. */
function badgeFont(tone: TextTone): string {
  return `650 ${Math.round(Math.min(FONT[tone].size, FONT.body.size) * 0.86 * PX_PER_M)}px ${FONT_FAMILY}`;
}

/** Canvas letter-spacing where the browser has it (Chromium, so Quest Browser); harmless elsewhere. */
function tracking(ctx: CanvasRenderingContext2D, metres: number): void {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(metres * PX_PER_M).toFixed(2)}px`;
}

type Fade = { kind: "open" | "close"; start: number };
type Glide = { from: Vector3; to: Vector3; face: Vector3; start: number };

export class SpatialGlassPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Animated holographic edge: rim sweep, corner brackets, glow (holoFrame.ts). */
  readonly frame: HoloFrame;
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
    /** Room kept free at the left of the text for a live element drawn over the panel (the voice orb). */
    private readonly insetLeftM = 0,
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
    this.frame = new HoloFrame(widthM, heightM, SPACE.radius);
    this.mesh.add(this.frame.mesh);
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

  /** Hologram unfold: the panel opens from a thin horizontal slit while its rim draws on. */
  private applyFade(k: number): void {
    this.mesh.material.opacity = k;
    this.mesh.scale.set(0.96 + 0.04 * k, 0.18 + 0.82 * k, 1);
    this.frame.setOpacity(k);
    this.frame.setReveal(this.closing ? 1 : k);
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
    const eyebrow = this.content.eyebrow;
    const headH = eyebrow ? EYEBROW_H : 0;
    // Room is kept for the paging row only on panels that can grow one; display-only panels use their whole height.
    const textBottom = (MARGIN + (rows.length + (this.paging ? 1 : 0)) * (BUTTON_H + GAP)) * s;
    const img = this.content.image;
    const imgH = img ? Math.min((this.widthM - 2 * MARGIN) / img.aspect, this.heightM * 0.42) * s : 0;
    const pages = paginate(textLines, canvas.height - textBottom - (MARGIN + headH) * s - imgH);
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
    const pageText = (pages[this.page] ?? []).reduce((h, l) => h + lineHeight(l), 0);
    const needed = 2 * MARGIN + headH + pageText + (img ? imgH / s + 0.004 : 0) + rows.length * (BUTTON_H + GAP) + (rows.length ? GAP : 0);
    // A panel with a live element beside its text (the voice orb) keeps its full height, so the element stays centred.
    this.fitTo(pages.length > 1 || textLines.length === 0 || this.insetLeftM > 0 ? this.heightM : Math.min(this.heightM, Math.max(needed, 0.08)));
    this.buttons = [];
    rows.forEach((row, r) => {
      const y = MARGIN + r * (BUTTON_H + GAP);
      const w = (this.widthM - 2 * MARGIN - (row.length - 1) * GAP) / row.length;
      row.forEach((b, i) => this.buttons.push({ ...b, rect: { x: MARGIN + i * (w + GAP), y, w, h: BUTTON_H } }));
    });

    const top = (this.heightM - this.visibleH) * s;
    this.drawGlass(top, this.visibleH * s);
    const left = (MARGIN + this.insetLeftM) * s;
    const right = canvas.width - MARGIN * s;
    let y = top + MARGIN * s;
    ctx.textBaseline = "top";
    if (eyebrow) {
      // A lit dot and small capitals: what kind of card this is, before what it says.
      ctx.fillStyle = COLOR.accent;
      ctx.beginPath();
      ctx.arc(left + 0.003 * s, y + 0.0045 * s, 0.0024 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font("label");
      tracking(ctx, FONT.label.tracking);
      ctx.fillStyle = COLOR.label;
      ctx.fillText(eyebrow.toUpperCase(), left + 0.0095 * s, y);
      tracking(ctx, 0);
      y += EYEBROW_H * s;
    }
    let lineIndex = 0;
    let imagePending = img !== undefined;
    let pastHeader = false;
    for (const l of pages[this.page] ?? []) {
      // The picture goes under the whole title, however many lines the title wraps to.
      if (img && imagePending && lineIndex > 0 && pastHeader) {
        imagePending = false;
        const w = Math.min(imgH * img.aspect, right - left);
        // Evidence pictures sit in a thin frame so a dark crop still reads as a picture on dark glass.
        ctx.save();
        roundRect(ctx, left, y, w, imgH, 0.004 * s);
        ctx.clip();
        ctx.drawImage(img.source, left, y, w, imgH);
        ctx.restore();
        ctx.lineWidth = 0.0008 * s;
        ctx.strokeStyle = COLOR.hairline;
        roundRect(ctx, left, y, w, imgH, 0.004 * s);
        ctx.stroke();
        y += imgH + 0.004 * s;
      }
      lineIndex++;
      if (l.headerEnd || l.tone !== "title") pastHeader = true;
      const f = FONT[l.tone];
      ctx.font = font(l.tone);
      let x = left;
      if (l.tone === "label") {
        // Section label: small capitals, then a hairline to the edge. Sits low in its row, close to what it heads.
        const ty = y + f.size * 1.1 * s;
        tracking(ctx, f.tracking);
        ctx.fillStyle = f.color;
        ctx.fillText(l.text, x, ty);
        const tw = ctx.measureText(l.text).width;
        tracking(ctx, 0);
        ctx.fillStyle = COLOR.hairline;
        ctx.fillRect(x + tw + 0.006 * s, ty + f.size * 0.45 * s, Math.max(0, right - x - tw - 0.006 * s), Math.max(1, 0.0006 * s));
        y += lineHeight(l) * s;
        continue;
      }
      if (l.badge) {
        // Pills: tinted fill, a thin edge in the text colour, slightly smaller bold text centred on the line.
        const tone = BADGE[l.badgeTone ?? "default"];
        ctx.font = badgeFont(l.tone);
        const bw = ctx.measureText(l.badge).width + 0.011 * s;
        const bh = f.size * 1.36 * s;
        const by = y - f.size * 0.14 * s;
        ctx.fillStyle = tone.bg;
        roundRect(ctx, x, by, bw, bh, bh / 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1, 0.0005 * s);
        ctx.strokeStyle = tone.fg;
        ctx.globalAlpha = 0.32;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = tone.fg;
        ctx.textBaseline = "middle";
        ctx.fillText(l.badge, x + 0.0055 * s, by + bh / 2 + 0.0003 * s);
        ctx.textBaseline = "top";
        ctx.font = font(l.tone);
        x += bw + 0.005 * s;
      }
      tracking(ctx, f.tracking);
      ctx.fillStyle = f.color;
      ctx.fillText(l.text, x, y);
      tracking(ctx, 0);
      if (l.headerEnd) {
        // Hairline under the title: header above, content below.
        const hy = y + f.size * 1.3 * s + 0.004 * s;
        const line = ctx.createLinearGradient(left, 0, right, 0);
        line.addColorStop(0, "rgba(79, 216, 255, 0.55)");
        line.addColorStop(0.35, COLOR.hairline);
        line.addColorStop(1, "rgba(140, 200, 230, 0.04)");
        ctx.fillStyle = line;
        ctx.fillRect(left, hy, right - left, Math.max(1, 0.0007 * s));
      }
      y += lineHeight(l) * s;
    }

    for (const b of this.buttons) {
      const pressed = this.highlighted === b.id;
      const hot = pressed || this.hovered === b.id;
      // A paging button with nowhere to go stays in place (steady targets) but is drawn faint.
      const idle = (b.id === "page:prev" && this.page === 0) || (b.id === "page:next" && this.page >= pages.length - 1);
      const tone = pressed ? "active" : (b.style ?? "secondary");
      const c = BUTTON_COLORS[tone];
      const bump = pressed ? 0.025 : this.hovered === b.id ? 0.012 : 0;
      const px = b.rect.x * s - b.rect.w * s * bump;
      const py = canvas.height - (b.rect.y + b.rect.h) * s - b.rect.h * s * bump;
      const bw = b.rect.w * s * (1 + 2 * bump);
      const bh = b.rect.h * s * (1 + 2 * bump);
      const r = SPACE.buttonRadius * s;
      ctx.globalAlpha = idle ? 0.38 : 1;
      const fill = ctx.createLinearGradient(0, py, 0, py + bh);
      fill.addColorStop(0, c.top);
      fill.addColorStop(1, c.bottom);
      if (hot || tone === "primary") {
        // A wider translucent rim reads as a glow; canvas shadowBlur does too but costs far more on every hover
        // change. The primary button keeps a faint one at rest, so the next step is findable at a glance.
        ctx.fillStyle = c.rim;
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * (hot ? 0.35 : 0.14);
        roundRect(ctx, px - 0.004 * s, py - 0.004 * s, bw + 0.008 * s, bh + 0.008 * s, r + 0.004 * s);
        ctx.fill();
        ctx.globalAlpha = base;
      }
      ctx.fillStyle = fill;
      roundRect(ctx, px, py, bw, bh, r);
      ctx.fill();
      // Top-lit edge: a soft highlight across the upper half makes the button read as raised glass.
      const lit = ctx.createLinearGradient(0, py, 0, py + bh * 0.55);
      lit.addColorStop(0, tone === "primary" || tone === "active" ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.09)");
      lit.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = lit;
      roundRect(ctx, px, py, bw, bh, r);
      ctx.fill();
      // Glass bevel: a bright hairline along the top edge.
      const bevel = ctx.createLinearGradient(px, 0, px + bw, 0);
      bevel.addColorStop(0, "rgba(255, 255, 255, 0)");
      bevel.addColorStop(0.5, hot ? "rgba(255, 255, 255, 0.7)" : "rgba(255, 255, 255, 0.28)");
      bevel.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = bevel;
      ctx.fillRect(px + SPACE.buttonRadius * s, py + 0.0006 * s, bw - 2 * SPACE.buttonRadius * s, 0.0008 * s);
      ctx.lineWidth = (hot ? 0.0018 : 0.001) * s;
      ctx.strokeStyle = hot ? "#ffffff" : c.rim;
      const base = ctx.globalAlpha;
      ctx.globalAlpha = base * (hot ? 1 : 0.6);
      roundRect(ctx, px, py, bw, bh, r);
      ctx.stroke();
      ctx.globalAlpha = base;
      ctx.fillStyle = c.fg;
      ctx.font = `620 ${Math.round(0.0112 * s)}px ${FONT_FAMILY}`;
      tracking(ctx, 0.00012);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, b.label, b.rect.w * s - 0.008 * s), px + bw / 2, py + bh / 2 + 0.0004 * s);
      tracking(ctx, 0);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Dark translucent glass, `h` pixels tall from `top`: a soft sheen from above, a faint lit rim, a cyan accent along
   * the top edge and small corner ticks, so every card reads as one instrument family.
   */
  private drawGlass(top: number, h: number): void {
    const { ctx, canvas } = this;
    const s = PX_PER_M;
    const w = canvas.width;
    const r = SPACE.radius * s;
    const bg = ctx.createLinearGradient(0, top, 0, top + h);
    bg.addColorStop(0, COLOR.glassTop);
    bg.addColorStop(1, COLOR.glassBottom);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, top, w, h, r);
    ctx.fill();
    // Sheen: light falling on the upper part of the glass, clipped to the card's shape.
    ctx.save();
    roundRect(ctx, 0, top, w, h, r);
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, top, 0, top + Math.min(h, 0.09 * s));
    sheen.addColorStop(0, COLOR.sheen);
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, top, w, Math.min(h, 0.09 * s));
    // A whisper of accent in the top-left corner, where the eye starts reading.
    const glow = ctx.createRadialGradient(0, top, 0, 0, top, 0.16 * s);
    glow.addColorStop(0, "rgba(79, 216, 255, 0.11)");
    glow.addColorStop(1, "rgba(79, 216, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, top, 0.16 * s, Math.min(h, 0.16 * s));
    ctx.restore();
    ctx.lineWidth = 0.0014 * s;
    const rim = ctx.createLinearGradient(0, top, 0, top + h);
    rim.addColorStop(0, "rgba(130, 226, 255, 0.5)");
    rim.addColorStop(1, COLOR.glassRim);
    ctx.strokeStyle = rim;
    roundRect(ctx, ctx.lineWidth / 2, top + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, r);
    ctx.stroke();
    const bar = ctx.createLinearGradient(0, 0, w, 0);
    bar.addColorStop(0, "rgba(79, 216, 255, 0)");
    bar.addColorStop(0.5, COLOR.accent);
    bar.addColorStop(1, "rgba(79, 216, 255, 0)");
    ctx.fillStyle = bar;
    ctx.fillRect(r, top + 0.0016 * s, w - 2 * r, 0.0016 * s);
    // Corner ticks just inside the bottom corners: a quiet instrument-panel detail that also marks the card's extent.
    const inset = 0.0065 * s;
    const tick = 0.009 * s;
    ctx.lineWidth = Math.max(1, 0.0009 * s);
    ctx.strokeStyle = "rgba(79, 216, 255, 0.42)";
    ctx.beginPath();
    ctx.moveTo(inset, top + h - inset - tick);
    ctx.lineTo(inset, top + h - inset);
    ctx.lineTo(inset + tick, top + h - inset);
    ctx.moveTo(w - inset - tick, top + h - inset);
    ctx.lineTo(w - inset, top + h - inset);
    ctx.lineTo(w - inset, top + h - inset - tick);
    ctx.stroke();
  }

  /**
   * Trims the plane to the bottom `h` metres of the canvas. The mesh origin stays at the full panel's centre, so
   * button rects, poke and ray mapping (toLocal) are unchanged; only the drawn and hittable area shrinks, which also
   * keeps an empty strip of glass from blocking a ray aimed at the terrain behind it.
   */
  private fitTo(h: number): void {
    if (Math.abs(h - this.visibleH) < 1e-4) return;
    this.visibleH = h;
    this.frame.setHeight(h, this.heightM);
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
  private layoutText(): LaidLine[] {
    const { ctx } = this;
    const s = PX_PER_M;
    const out: LaidLine[] = [];
    const width = (this.widthM - 2 * MARGIN - this.insetLeftM) * s;
    let header = this.content.lines[0]?.tone === "title";
    for (const l of this.content.lines) {
      if (l.tone === "label") {
        out.push({ text: l.text.toUpperCase(), tone: "label", gapAfter: true });
        continue;
      }
      ctx.font = font(l.tone);
      tracking(ctx, FONT[l.tone].tracking);
      let badgeW = 0;
      if (l.badge) {
        ctx.font = badgeFont(l.tone);
        badgeW = ctx.measureText(l.badge).width + 0.016 * s;
        ctx.font = font(l.tone);
      }
      // Only the first line shares its row with the badge; the rest run the full width.
      const wrapped = wrapText(l.text, width, (t) => ctx.measureText(t).width, width - badgeW);
      tracking(ctx, 0);
      wrapped.forEach((t, i) => {
        const last = i === wrapped.length - 1;
        out.push({ text: t, tone: l.tone, badge: i === 0 ? l.badge : undefined, badgeTone: l.badgeTone, gapAfter: last, headerEnd: header && last });
      });
      header = false;
    }
    return out;
  }
}

function paginate<T extends LaidLine>(lines: T[], heightPx: number): T[][] {
  const pages: T[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = lineHeight(l) * PX_PER_M;
    if (used + h > heightPx && (pages[pages.length - 1]?.length ?? 0) > 0) {
      // A section label never ends a page: it moves on with the lines it introduces.
      const prev = pages[pages.length - 1];
      const orphan = prev && prev.length > 1 && prev[prev.length - 1]?.tone === "label" ? prev.pop() : undefined;
      pages.push(orphan ? [orphan] : []);
      used = orphan ? lineHeight(orphan) * PX_PER_M : 0;
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
