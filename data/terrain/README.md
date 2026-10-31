# Terrain

DEM tiles, textures and `<site>/features.json` per site. Binary tiles and textures are tracked with git LFS
(see `.gitattributes`); run `git lfs install` before adding any.

## Per-site layout

```
data/terrain/<SITE_ID>/
├─ dem.json       ← DemHeader (packages/schemas/src/terrain.ts): size, cell size, CRS, source evidence id
├─ dem.bin        ← float32 little-endian, row-major, north-up (LFS)
├─ texture.png    ← orthophoto on the same grid, 8-bit, ≤ 2048² (LFS)
└─ features.json  ← FeatureCollection: hand-labelled craters, rilles, slopes, points in tile-local metres
```

Tile-local coordinates: origin at the DEM's north-west post, `x` east, `z` south, metres. `packages/terrain`
computes every depth, width, diameter, slope, elevation and length from these files; models never supply them.

## Demo sites and provenance

All three tiles are cut from one real product pair in the LROC PDS archive (public domain; credit
NASA/GSFC/Arizona State University):

- DTM: [`NAC_DTM_APOLLO15_E261N0036.IMG`](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15_E261N0036.IMG), 2 m posts, decimated to 4 m for the tiles
- Orthophoto: [`NAC_DTM_APOLLO15_M111578606_2M.IMG`](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO15/NAC_DTM_APOLLO15_M111578606_2M.IMG), same grid

| Site | Tile | Centred on | Feature |
| --- | --- | --- | --- |
| `HADLEY_RILLE` | 701 × 701 posts (2.8 km) | reach of the rille west of the Apollo 15 landing site | `HADLEY_RILLE` (path traced on trough minima, two perpendicular cross-sections) |
| `ELBOW_CRATER` | 501 × 501 posts (2.0 km) | USGS Gazetteer position of Elbow (26.03 N, 3.60 E) | `ELBOW_CRATER` |
| `HADLEY_DELTA` | 751 × 751 posts (3.0 km) | lower north flank of Mons Hadley Delta | `HADLEY_DELTA_SLOPE` (mean slope, 500 m radius) |

Feature geometry is hand-labelled from the DTM and orthophoto; every number is then computed by
`packages/terrain`. Known method limit: the rille width is rim-crest to rim-crest along each cross-section,
which reads wider than the channel-floor widths often quoted in the literature.

### Rebuilding

`scripts/data/build_data.py` regenerates the tiles, textures, evidence packs and media crops. Download the
two `.IMG` products above into `dem/A15.IMG` and `dem/ORTHO.IMG` under a scratch directory, then from that
directory run `python3 <repo>/scripts/data/build_data.py <repo>/data` (needs numpy and Pillow).

## Planet models

`data/planets/<body>/` holds whole-body models for the AR globe view, each with a `provenance.json`. The Moon globe
(`data/planets/moon/globe/`) is derived from NASA SVS 14959 by `scripts/data/build_moon_globe.py`; see its provenance
file for the source, checksum, credit and what the source does not state.

`data/planets/moon/samples/` holds six real lunar specimens scanned by NASA Astromaterials 3D (photogrammetry, in
metres): Apollo 15 basalts 15016 and 15556 from Hadley Rille, Apollo 11 basalt 10022, breccias 14321 and 67016, and
lunar meteorite MIL 090036. `scripts/data/build_lunar_samples.py` downloads NASA's web-resolution models, takes
every number from NASA's files or the output, and writes Quest-sized GLBs (about 30,000 triangles, 2048² colour maps) with a `provenance.json` each
and a `catalog.json`. They are laboratory reference specimens at true size, not evidence about a site unless an
evidence pack cites them. The same models are listed on Sketchfab by Astromaterials3D under CC0.
