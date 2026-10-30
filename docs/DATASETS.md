# Datasets & Evidence Packs

NEXUS uses real public data. For the competition build, data is **preselected and curated** per site; agents cannot browse freely.

## Sources

| Source | Use | Notes |
| --- | --- | --- |
| NASA Moon Trek | Base terrain, mosaics, site context | Export DEM + texture tiles for each site |
| LRO LROC (NAC/WAC) | Imagery evidence | Record exact product IDs and credits |
| LRO LOLA | Elevation (DEM) → measurements | Measurements computed in `packages/terrain` |
| NASA PDS | Product metadata, provenance | Used by #32 Dataset Provenance Validator |
| Apollo 15 mission records | Historical observations and context | Short excerpts only, with links |

Verify licensing/attribution text for each product and copy it into `credit` / `license` fields. Never present archival imagery as live data.

## Demo region: Apollo 15 Hadley–Apennine

Candidate sites (confirm in Moon Trek during Phase 1; replace if data quality is poor):

| Site ID | Feature | Why |
| --- | --- | --- |
| `HADLEY_RILLE` | Sinuous rille | Several historical interpretations → good for hypotheses + debate |
| `ELBOW_CRATER` | Crater at the rille bend | Clear depth/diameter measurements |
| `HADLEY_DELTA` | Mons Hadley Delta slope | Contrast: highland slope vs lowland |

## Terrain processing (`packages/terrain`)

1. Export DEM tile (~20 × 20 km) and matching texture from Moon Trek.
2. Record product ID, resolution, CRS, acquisition info → `EvidenceItem` of type `dataset`.
3. Resample to ≤ 256 × 256 vertices for the XR mesh; keep full-res copy for measurements.
4. Label features (polygons/points) in `data/terrain/<site>/features.json`.
5. Compute `MeasurementRecord`s (depth, width, slope, length) with documented methods; unit-test against hand-checked values.

## Evidence pack format

`data/evidence-packs/<SITE_ID>.json`

```json
{
  "siteId": "ELBOW_CRATER",
  "version": 1,
  "items": [
    {
      "id": "EV-ELBOW-001",
      "type": "dataset",
      "title": "LOLA-derived DEM tile, Hadley region",
      "spokenLabel": "LOLA elevation data",
      "dataset": "LRO LOLA",
      "productId": "<exact product id>",
      "sourceUrl": "<verified url>",
      "credit": "NASA/GSFC",
      "license": "<verify>"
    }
  ]
}
```

Rules:

- 10–20 items per site; every `sourceUrl` checked by #32 before commit.
- Text excerpts < 60 words, quoted accurately, with link.
- No placeholder URLs or IDs in committed packs — CI fails on `<` characters in `productId`/`sourceUrl`.
