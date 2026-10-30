import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvidenceStore } from "./evidenceStore.js";

describe("loadEvidenceStore", () => {
  it("loads packs and computes measurements from the DEM with packages/terrain", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-data-"));
    await mkdir(join(root, "evidence-packs"), { recursive: true });
    await mkdir(join(root, "terrain", "TEST_SITE"), { recursive: true });
    const item = {
      id: "EV-TEST-001",
      siteId: "TEST_SITE",
      type: "dataset",
      title: "test elevation data",
      spokenLabel: "test elevation data",
      sourceUrl: "https://example.org/test/EV-TEST-001",
      credit: "test fixture",
      license: "test fixture",
    };
    await writeFile(join(root, "evidence-packs", "TEST_SITE.json"), JSON.stringify({ siteId: "TEST_SITE", version: 1, items: [item] }));
    // 3×3 DEM, 10 m posts, centre post 5 m.
    const bytes = Buffer.alloc(36);
    [0, 0, 0, 0, 5, 0, 0, 0, 0].forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    await writeFile(join(root, "terrain", "TEST_SITE", "dem.bin"), bytes);
    await writeFile(
      join(root, "terrain", "TEST_SITE", "dem.json"),
      JSON.stringify({ siteId: "TEST_SITE", width: 3, height: 3, cellSizeM: 10, coordinateReferenceSystem: "TEST_LOCAL", sourceEvidenceId: "EV-TEST-001" }),
    );
    await writeFile(
      join(root, "terrain", "TEST_SITE", "features.json"),
      JSON.stringify({
        siteId: "TEST_SITE",
        features: [{ id: "TEST_PEAK", siteId: "TEST_SITE", kind: "point", label: "peak", spokenLabel: "the peak", center: { x: 10, z: 10 } }],
      }),
    );
    const store = await loadEvidenceStore(root);
    expect(store.items.map((i) => i.id)).toEqual(["EV-TEST-001"]);
    expect(store.measurements.map((m) => [m.id, m.value, m.unit])).toEqual([["MEAS-TEST_SITE-TEST_PEAK-ELEVATION", 5, "m"]]);
    expect(store.contextFor("TEST_SITE").measurements.size).toBe(1);
  });
});
