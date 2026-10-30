// Loads curated evidence packs and code-computed measurements: the only things the SIE accepts as evidence.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { evidencePack, featureCollection } from "@nexus/schemas";
import type { EvidenceItem, MeasurementRecord } from "@nexus/schemas";
import { createContext } from "@nexus/sie";
import type { SieContext } from "@nexus/sie";
import { measureFeature, parseDem } from "@nexus/terrain";

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
 * `data/evidence-packs/*.json`, plus MeasurementRecords computed by packages/terrain from each site's
 * `dem.json` + `dem.bin` + `features.json`, exactly as the agent tool server does
 * (services/orchestrator/src/mcp/dataStore.ts), so agents and the SIE see the same ids and values.
 * Invalid files fail startup rather than being skipped, so a broken pack can never silently weaken the SIE.
 */
export async function loadEvidenceStore(dataDir: string): Promise<EvidenceStore> {
  const items: EvidenceItem[] = [];
  const measurements: MeasurementRecord[] = [];
  for (const file of await listJson(join(dataDir, "evidence-packs"))) {
    const pack = evidencePack.parse(JSON.parse(await readFile(file, "utf8")));
    items.push(...pack.items);
  }
  const terrainDir = join(dataDir, "terrain");
  for (const site of await listDirs(terrainDir)) measurements.push(...(await siteMeasurements(join(terrainDir, site))));
  return evidenceStore(items, measurements);
}

async function siteMeasurements(dir: string): Promise<MeasurementRecord[]> {
  const featuresRaw = await readFile(join(dir, "features.json"), "utf8").catch(() => undefined);
  const headerRaw = await readFile(join(dir, "dem.json"), "utf8").catch(() => undefined);
  const bytes = await readFile(join(dir, "dem.bin")).catch(() => undefined);
  if (featuresRaw === undefined || headerRaw === undefined || bytes === undefined) return [];
  const features = featureCollection.parse(JSON.parse(featuresRaw)).features;
  const grid = parseDem(JSON.parse(headerRaw), bytes);
  if (!grid.ok) throw new Error(`${dir}: ${grid.error}`);
  // The DEM's timestamp keeps records identical to the tool server's.
  const computedAt = (await stat(join(dir, "dem.bin"))).mtime.toISOString();
  return features.flatMap((f) => {
    const r = measureFeature(grid.value, f, computedAt);
    if (!r.ok) throw new Error(`${f.id}: ${r.error}`);
    return r.value;
  });
}

async function listJson(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => join(dir, e.name));
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
