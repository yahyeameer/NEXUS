// Where each demo site sits on the Moon, read from the site's own evidence (the LROC DTM item's region bbox, cut
// from the product label by scripts/data/build_data.py). Nothing here is typed in by hand (AGENTS.md rule 3).
import { evidencePack } from "@nexus/schemas";
import type { EvidencePack } from "@nexus/schemas";

export interface SiteLocation {
  siteId: string;
  lat: number;
  lon: number;
  /** The evidence item the location came from. */
  evidenceId: string;
}

/** Longitude folded into (-180, 180]; the DTM label counts some longitudes as negative-from-360. */
export function normalizeLon(lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return l === -180 ? 180 : l;
}

/** Centre of the first item in the pack that carries a lon/lat bbox (west, south, east, north). */
export function siteLocation(pack: EvidencePack): SiteLocation | undefined {
  for (const item of pack.items) {
    const b = item.region?.bbox;
    if (!b || !item.region?.crs?.includes("longitude/latitude")) continue;
    const [w, s, e, n] = b;
    return { siteId: pack.siteId, lat: (s + n) / 2, lon: normalizeLon((w + e) / 2), evidenceId: item.id };
  }
  return undefined;
}

/** Mean position of a set of nearby sites: they are a few kilometres apart, one spot at globe scale. */
export function regionCentre(locations: SiteLocation[]): { lat: number; lon: number } | undefined {
  if (locations.length === 0) return undefined;
  const lat = locations.reduce((a, l) => a + l.lat, 0) / locations.length;
  const lon = locations.reduce((a, l) => a + l.lon, 0) / locations.length;
  return { lat, lon };
}

export async function loadSiteLocations(siteIds: readonly string[]): Promise<SiteLocation[]> {
  const base = `${import.meta.env.BASE_URL}evidence-packs`;
  const out: SiteLocation[] = [];
  await Promise.all(
    siteIds.map(async (id) => {
      try {
        const res = await fetch(`${base}/${encodeURIComponent(id)}.json`);
        if (!res.ok) return;
        const pack = evidencePack.safeParse(await res.json());
        const loc = pack.success ? siteLocation(pack.data) : undefined;
        if (loc) out.push(loc);
      } catch {
        // A site without a readable pack is simply not marked on the globe.
      }
    }),
  );
  return siteIds.map((id) => out.find((l) => l.siteId === id)).filter((l): l is SiteLocation => l !== undefined);
}
