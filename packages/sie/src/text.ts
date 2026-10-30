// Deterministic text checks shared by the finding validators and the voice validator.
// When unsure whether a phrase is a claim, these treat it as one (CLAUDE.md).
import type { ClaimType, MeasurementRecord } from "@nexus/schemas";

export type NumberUnit = "m" | "km" | "deg" | "%" | null;

export interface NumberMention {
  value: number;
  unit: NumberUnit;
  raw: string;
}

const UNIT_ALIASES: Record<string, Exclude<NumberUnit, null>> = {
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  km: "km",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  deg: "deg",
  degree: "deg",
  degrees: "deg",
  "°": "deg",
  "%": "%",
  percent: "%",
};

const WITH_UNIT =
  /(?<![\w.-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(kilomet(?:er|re)s?|met(?:er|re)s?|km|m|degrees?|deg|°|%|percent)(?![\w])/gi;
/** Identifiers such as EV-ELBOW-001, MEAS-…, product ids: never read as numbers. */
const IDENTIFIER = /\b[\w-]*[A-Za-z][\w-]*\d[\w-]*\b|\b\d+[A-Za-z][\w-]*\b/g;
const BARE = /(?<![\w.-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\w])/g;
/** Mission and spacecraft names whose numbers are names, not values. */
const NAME_BEFORE = /\b(apollo|luna|surveyor|ranger|lunar orbiter|chang'?e|station)\s*$/i;

/**
 * Every numeric value in `text`. Numbers inside identifiers, mission names (Apollo 15) and
 * plausible calendar years are skipped; everything else counts as a value that needs a record.
 */
export function extractNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  const masked = text.replace(WITH_UNIT, (raw, int: string, frac: string | undefined, unit: string) => {
    out.push({ value: toNumber(int, frac), unit: UNIT_ALIASES[unit.toLowerCase()] ?? null, raw });
    return " ".repeat(raw.length);
  });
  const noIds = masked.replace(IDENTIFIER, (m) => " ".repeat(m.length));
  for (const m of noIds.matchAll(BARE)) {
    const int = m[1] ?? "";
    const value = toNumber(int, m[2]);
    const before = noIds.slice(0, m.index);
    if (NAME_BEFORE.test(before)) continue;
    if (m[2] === undefined && !int.includes(",") && int.length === 4 && value >= 1950 && value <= 2035) continue;
    out.push({ value, unit: null, raw: m[0] });
  }
  return out;
}

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b[\s-]*(?:\w+[\s-]+){0,3}?(kilomet(?:er|re)s?|met(?:er|re)s?|km|degrees?)\b/i;

/** Spelled-out measurements ("three hundred metres") cannot be checked, so they are rejected outright. */
export function hasSpelledMeasurement(text: string): boolean {
  return NUMBER_WORDS.test(text);
}

/** Tolerance for spoken and written numbers vs MeasurementRecord (SIE V3, VV2). */
export const NUMBER_TOLERANCE = 0.05;

/** Returns the mentions that do not match any candidate record within ±5 % in a compatible unit. */
export function unmatchedNumbers(text: string, records: readonly MeasurementRecord[]): NumberMention[] {
  return extractNumbers(text).filter((n) => !records.some((r) => numberMatches(n, r)));
}

export function numberMatches(n: NumberMention, r: MeasurementRecord): boolean {
  if (n.unit === "%") return false;
  // A bare number is read in the record's own unit ("about 400" next to a 400 m record).
  if (n.unit === null) return Math.abs(n.value - r.value) <= NUMBER_TOLERANCE * Math.abs(r.value);
  if (dimension(n.unit) !== dimension(r.unit)) return false;
  const actual = toBase(r.value, r.unit);
  return Math.abs(toBase(n.value, n.unit) - actual) <= NUMBER_TOLERANCE * Math.abs(actual);
}

function dimension(u: Exclude<NumberUnit, null | "%">): "length" | "angle" {
  return u === "deg" ? "angle" : "length";
}

function toBase(v: number, u: Exclude<NumberUnit, null | "%">): number {
  return u === "km" ? v * 1000 : v;
}

function toNumber(int: string, frac: string | undefined): number {
  return Number(`${int.replace(/,/g, "")}${frac === undefined ? "" : `.${frac}`}`);
}

// --- Wording ---------------------------------------------------------------------------------

/** AGENTS.md §10: never "confirmed", "discovered" or "proven" for an AI finding. */
export const FORBIDDEN_ALWAYS =
  /\b(prov(?:e|es|ed|en|ing)|proof|confirm(?:s|ed|ing)?|discover(?:s|ed|y)?|definitely|definitive(?:ly)?|certainly|undoubtedly|without (?:a )?doubt|beyond doubt|clearly shows)\b/i;

/** VOICE.md §5: observations do not assign causes. */
export const CAUSAL = /\b(caused|formed|created|produced|carved|made) by\b|\bdue to\b|\bresult(?:ed|s)? (?:of|from)\b|\borigin(?:ated)? (?:as|from)\b/i;

const HEDGE_INTERPRETATION =
  /\b(consistent with|one interpretation|interpreted as|may|might|could|possibl[ey]|possibility|suggests?|suggestive|appears? to|likely|compatible with|hypothes[ie]s|perhaps)\b/i;
const HEDGE_HYPOTHESIS = /\b(may|might|could|possibl[ey]|possibility|hypothes[ie]s|perhaps)\b/i;

export function wordingIssue(text: string, type: ClaimType): string | undefined {
  const forbidden = FORBIDDEN_ALWAYS.exec(text);
  if (forbidden) return `forbidden certainty word "${forbidden[0]}"`;
  switch (type) {
    case "observation":
    case "measurement": {
      const causal = CAUSAL.exec(text);
      return causal ? `${type} assigns a cause ("${causal[0]}")` : undefined;
    }
    case "interpretation":
      return HEDGE_INTERPRETATION.test(text) ? undefined : "interpretation stated as fact";
    case "hypothesis":
      return HEDGE_HYPOTHESIS.test(text) ? undefined : "hypothesis stated as fact";
  }
}

/** Precise coordinates in prose ("26.1° N", "lat 26.1"). */
export const COORDINATE = /\b\d{1,3}(?:\.\d+)?\s*°?\s*[NSEW]\b(?=[\s,.;]|$)|\b(?:lat(?:itude)?|lon(?:gitude)?)\s*[:=]?\s*-?\d/i;

/** Split a script into sentences, keeping decimals ("2.5 km") intact. */
export function splitSentences(script: string): string[] {
  return script
    .split(/(?<=[.!?])\s+(?=[A-Z"'“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
