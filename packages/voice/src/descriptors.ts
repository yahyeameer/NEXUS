// Deterministic descriptor extraction for Spoken Field Notes (PRD §6.2). Descriptors are only words the
// scientist said (SIE VA1); this is the fallback for Field Note Interpreter #51 and the check on its output.

const COLOUR = ["dark", "darker", "bright", "brighter", "light", "grey", "gray", "black", "white", "reddish", "bluish", "orange"];
const TEXTURE = ["smooth", "rough", "hummocky", "blocky", "pitted", "grooved", "lumpy", "fine", "coarse", "layered", "streaky"];
const SHAPE = ["angular", "rounded", "sinuous", "circular", "elongated", "slumped", "terraced", "flat", "steep", "shallow", "deep", "degraded", "fresh", "sharp", "curved", "straight", "bowl-shaped"];
const SIZE = ["small", "large", "big", "huge", "tiny", "narrow", "wide", "long", "short"];
const OBJECTS = [
  "boulder field", "boulders", "boulder", "blocks", "block", "rocks", "rock", "rim", "floor", "wall", "walls", "rille", "crater",
  "ridge", "scarp", "slope", "ejecta", "layers", "layering", "outcrop", "bench", "channel", "bend", "terrace", "mound", "debris",
];
const DIRECTION = /\b((?:north|south|east|west)(?:ern)?(?:\s+|-)(?:rim|wall|side|slope|floor|edge|bank))\b/gi;

/** Multi-word terms first so "boulder field" wins over "boulder". */
const TERMS = [...OBJECTS, ...COLOUR, ...TEXTURE, ...SHAPE, ...SIZE].sort((a, b) => b.length - a.length);

export function extractDescriptors(transcript: string): string[] {
  let text = transcript.toLowerCase();
  const found: { at: number; term: string }[] = [];
  const take = (re: RegExp) => {
    text = text.replace(re, (m: string, ...rest: unknown[]) => {
      const at = rest.find((x): x is number => typeof x === "number") ?? 0;
      found.push({ at, term: m.replace(/\s+/g, " ") });
      return " ".repeat(m.length);
    });
  };
  take(DIRECTION);
  for (const t of TERMS) take(new RegExp(`\\b${t.replace(/-/g, "\\-")}\\b`, "g"));
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.term)
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
}
