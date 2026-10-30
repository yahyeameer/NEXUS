# Terrain

DEM tiles, textures and `<site>/features.json` per site. Binary tiles and textures are tracked with git LFS
(see `.gitattributes`); run `git lfs install` before adding any.

## Per-site layout

```
data/terrain/<SITE_ID>/
├─ dem.json       ← DemHeader (packages/schemas/src/terrain.ts): size, cell size, CRS, source evidence id
├─ dem.bin        ← float32 little-endian, row-major, north-up (LFS)
├─ texture.ktx2   ← ≤ 2048² (LFS)
└─ features.json  ← FeatureCollection: hand-labelled craters, rilles, slopes, points in tile-local metres
```

Tile-local coordinates: origin at the DEM's north-west post, `x` east, `z` south, metres. `packages/terrain`
computes every depth, width, diameter, slope, elevation and length from these files; models never supply them.
