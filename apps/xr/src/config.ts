// Backend locations. In dev, Vite proxies /api and /voice to the local services (vite.config.ts), so the headset
// only needs the one HTTPS origin and never holds a provider key (AGENTS.md rule 6).
export const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
export const VOICE_URL = import.meta.env.VITE_VOICE_URL ?? "/voice";

/** The three judged demo sites (data/terrain/<SITE_ID>), in wrist-menu order. */
export const SITES = [
  { siteId: "HADLEY_RILLE", name: "Hadley Rille", short: "Rille", names: ["hadley rille", "the rille site"] },
  { siteId: "ELBOW_CRATER", name: "Elbow crater", short: "Elbow", names: ["elbow", "elbow crater"] },
  { siteId: "HADLEY_DELTA", name: "Hadley Delta", short: "Delta", names: ["hadley delta", "the mountain"] },
] as const;

export type SiteId = (typeof SITES)[number]["siteId"];

/** Resolve a path against the page, turning http(s) into ws(s) for sockets. */
export function wsUrl(path: string): string {
  const u = new URL(path, window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
