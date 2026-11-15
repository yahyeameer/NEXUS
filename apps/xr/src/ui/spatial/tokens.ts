// NEXUS Spatial UI tokens: one place for colour, type and motion so every panel and scene element reads as one
// system. Dark translucent surfaces, a single restrained cyan accent, warm amber only for "needs you" states.
// Sizes are in metres (world space); comfort rules from INTERACTION.md §3 (poke targets ≥ 4 cm).

export const COLOR = {
  /** Panel glass, top to bottom. */
  glassTop: "rgba(16, 24, 36, 0.86)",
  glassBottom: "rgba(7, 11, 19, 0.9)",
  glassRim: "rgba(98, 214, 255, 0.32)",
  accent: "#4fd8ff",
  accentSoft: "rgba(79, 216, 255, 0.16)",
  textStrong: "#f3f8ff",
  text: "#d6e1ee",
  textMuted: "#8b9bb0",
  warn: "#ffc56b",
  badgeBg: "rgba(79, 216, 255, 0.14)",
  badgeFg: "#bdefff",
  /** Section labels and the eyebrow above a title: the accent, dimmed so it organises without shouting. */
  label: "#7fd9f5",
  /** Hairlines that divide a card into header, sections and actions. */
  hairline: "rgba(140, 200, 230, 0.2)",
  /** Soft light along the top of the glass, as if lit from above. */
  sheen: "rgba(255, 255, 255, 0.07)",
} as const;

/** The same accent and states as numbers, for three.js materials. */
export const HEX = {
  accent: 0x4fd8ff,
  accentDim: 0x2a8fb0,
  selected: 0xe8fbff,
  amber: 0xffb84d,
  green: 0x5fd39a,
  grey: 0x7c8796,
  agent: 0x9fe7ff,
} as const;

/**
 * Badge colours. Claim types differ in hue so an observation, a code-computed measurement, an interpretation and a
 * hypothesis never look alike (PRD §6.6); the label inside the badge always says which, so colour is never the only cue.
 * Uncertainty badges run neutral → amber → red with the level. All muted: no neon.
 */
export const BADGE = {
  default: { bg: COLOR.badgeBg, fg: COLOR.badgeFg },
  observation: { bg: "rgba(139, 155, 176, 0.2)", fg: "#dbe4ef" },
  measurement: { bg: "rgba(79, 216, 255, 0.16)", fg: "#bdefff" },
  interpretation: { bg: "rgba(160, 140, 235, 0.2)", fg: "#ddd3ff" },
  hypothesis: { bg: "rgba(255, 184, 77, 0.18)", fg: "#ffdca3" },
  "uncertainty-low": { bg: "rgba(139, 155, 176, 0.2)", fg: "#dbe4ef" },
  "uncertainty-medium": { bg: "rgba(255, 184, 77, 0.18)", fg: "#ffdca3" },
  "uncertainty-high": { bg: "rgba(229, 120, 130, 0.22)", fg: "#ffccd1" },
  /** Precomputed or simulated content (AGENTS.md rule 7): neutral slate, so it reads as a label, not a warning. */
  offline: { bg: "rgba(148, 163, 184, 0.22)", fg: "#e2e8f0" },
} as const;

export type BadgeTone = keyof typeof BADGE;

export type ButtonTone = "primary" | "secondary" | "chip" | "danger" | "active";

/**
 * Buttons, in order of visual weight. Only `primary` is a solid colour, so each card has one obvious next step;
 * `danger` is a tinted outline, not a red slab, so Reject is clear without competing with Approve.
 */
export const BUTTON: Record<ButtonTone, { top: string; bottom: string; rim: string; fg: string }> = {
  primary: { top: "#27bfe6", bottom: "#0a7da1", rim: "#a6efff", fg: "#ffffff" },
  secondary: { top: "rgba(52, 66, 88, 0.72)", bottom: "rgba(30, 40, 56, 0.72)", rim: "#5b7090", fg: "#e6eef8" },
  chip: { top: "rgba(22, 82, 102, 0.78)", bottom: "rgba(12, 54, 70, 0.78)", rim: "#45c4e4", fg: "#dcf8ff" },
  danger: { top: "rgba(138, 52, 62, 0.62)", bottom: "rgba(92, 30, 40, 0.62)", rim: "#f08f98", fg: "#ffe3e5" },
  active: { top: "#5ee3ff", bottom: "#22a9cf", rim: "#e6fbff", fg: "#03202b" },
};

/** Font stack: a crisp UI face where installed, system UI elsewhere. Canvas has no web-font wait, so no network fonts. */
export const FONT_FAMILY = `"Inter", "Segoe UI Variable Display", "Segoe UI", "SF Pro Display", system-ui, sans-serif`;

export type TextTone = "title" | "body" | "muted" | "warn" | "label";

/** Type scale in metres of cap-to-descender height; ≥ 9 mm stays readable at 60 cm on Quest 3. */
export const TYPE: Record<TextTone, { size: number; color: string; weight: number; tracking: number }> = {
  title: { size: 0.016, color: COLOR.textStrong, weight: 680, tracking: -0.0002 },
  body: { size: 0.0104, color: COLOR.text, weight: 440, tracking: 0 },
  muted: { size: 0.0092, color: COLOR.textMuted, weight: 440, tracking: 0.00005 },
  warn: { size: 0.0097, color: COLOR.warn, weight: 600, tracking: 0 },
  /** Section heading: small capitals with wide tracking and a hairline, e.g. "CLAIMS", "EVIDENCE". */
  label: { size: 0.0086, color: COLOR.label, weight: 700, tracking: 0.0011 },
};

export const SPACE = {
  margin: 0.014,
  gap: 0.01,
  radius: 0.016,
  buttonRadius: 0.01,
  /** Poke targets ≥ 4 cm (INTERACTION.md §3). */
  buttonH: 0.042,
} as const;

export const MOTION = {
  openMs: 200,
  closeMs: 140,
  glideMs: 320,
  /** Ease-out cubic: quick to respond, gentle to settle. */
  ease: (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3),
} as const;
