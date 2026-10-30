// Loads curated evidence packs and code-computed measurements: the only things the SIE accepts as evidence.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { evidencePack, measurementRecord } from "@nexus/schemas";
import type { EvidenceItem, MeasurementRecord } from "@nexus/schemas";
import { createContext } from "@nexus/sie";
import type { SieContext } from "@nexus/sie";

export interface EvidenceStore {
  items: EvidenceItem[];
  measurements: MeasurementRecord[];
  contextFor(siteId: string): SieContext;
}

export function evidenceStore(items: EvidenceItem[], measurements: MeasurementRecord[]): EvidenceStore {
  return {
    items,
    measurements,
    contextFor: (siteId) =>
      createContext(
        siteId,
        items.filter((i) => i.siteId === siteId),
        measurements.filter((m) => m.siteId === siteId),
      ),
  };
}

/**
 * `data/evidence-packs/*.json` and `data/terrain/<site>/measurements.json`. Invalid files fail startup
 * rather than being skipped, so a broken pack can never silently weaken the SIE.
 */
export async function loadEvidenceStore(dataDir: string): Promise<EvidenceStore> {
  const items: EvidenceItem[] = [];
  const measurements: MeasurementRecord[] = [];
  for (const file of await listJson(join(dataDir, "evidence-packs"))) {
    const pack = evidencePack.parse(JSON.parse(await readFile(file, "utf8")));
    items.push(...pack.items);
  }
  const terrainDir = join(dataDir, "terrain");
  for (const site of await listDirs(terrainDir)) {
    const file = join(terrainDir, site, "measurements.json");
    const raw = await readFile(file, "utf8").catch(() => undefined);
    if (raw !== undefined) measurements.push(...measurementRecord.array().parse(JSON.parse(raw)));
  }
  return evidenceStore(items, measurements);
}

async function listJson(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => join(dir, e.name));
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
