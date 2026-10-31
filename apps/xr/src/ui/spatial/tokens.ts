// NEXUS Spatial UI tokens: one place for colour, type and motion so every panel and scene element reads as one
// system. Dark translucent surfaces, holographic cyan-to-violet accents (HOLO), warm amber only for "needs you" states.
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
  grid: "rgba(120, 214, 255, 0.07)",
  sheen: "rgba(150, 225, 255, 0.07)",
  badgeBg: "rgba(79, 216, 255, 0.14)",
  badgeFg: "#bdefff",
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
} as const;

export type BadgeTone = keyof typeof BADGE;

/** Holographic accents for animated frames and the voice orb: cyan into a cool violet, with a near-white hot core. */
export const HOLO = {
  rimA: 0x3fd0ff,
  rimB: 0x8b7bff,
  hot: 0xd8f8ff,
  listen: 0x4fe3ff,
  speak: 0xa58bff,
} as const;

export type ButtonTone = "primary" | "secondary" | "chip" | "danger" | "active";

export const BUTTON: Record<ButtonTone, { top: string; bottom: string; rim: string; fg: string }> = {
  primary: { top: "#1fb5dc", bottom: "#0b7fa3", rim: "#8eeaff", fg: "#ffffff" },
  secondary: { top: "rgba(44, 56, 74, 0.95)", bottom: "rgba(28, 36, 50, 0.95)", rim: "#4a5d78", fg: "#e6eef8" },
  chip: { top: "rgba(20, 74, 92, 0.95)", bottom: "rgba(12, 52, 66, 0.95)", rim: "#3fbfe0", fg: "#dcf8ff" },
  danger: { top: "#a8434c", bottom: "#7c2733", rim: "#e58a92", fg: "#ffffff" },
  active: { top: "#5ee3ff", bottom: "#22a9cf", rim: "#e6fbff", fg: "#03202b" },
};

/** Font stack: a crisp UI face where installed, system UI elsewhere. Canvas has no web-font wait, so no network fonts. */
export const FONT_FAMILY = `"Inter", "Segoe UI Variable Display", "Segoe UI", "SF Pro Display", system-ui, sans-serif`;

export type TextTone = "title" | "body" | "muted" | "warn";

/** Type scale in metres of cap-to-descender height; ≥ 9 mm stays readable at 60 cm on Quest 3. */
export const TYPE: Record<TextTone, { size: number; color: string; weight: number; tracking: number }> = {
  title: { size: 0.0146, color: COLOR.textStrong, weight: 650, tracking: -0.0002 },
  body: { size: 0.0102, color: COLOR.text, weight: 420, tracking: 0 },
  muted: { size: 0.0091, color: COLOR.textMuted, weight: 420, tracking: 0.00005 },
  warn: { size: 0.0097, color: COLOR.warn, weight: 600, tracking: 0 },
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
  /** Long enough for the hologram unfold and rim draw-on to read, short enough not to delay a press. */
  openMs: 300,
  closeMs: 140,
  glideMs: 320,
  /** Ease-out cubic: quick to respond, gentle to settle. */
  ease: (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3),
} as const;
