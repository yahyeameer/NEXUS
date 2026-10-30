# Evidence packs

One `<SITE_ID>.json` per demo site, in the format in `docs/DATASETS.md`. Every item must parse as
`evidencePack` from `@nexus/schemas`. No placeholder IDs or URLs: only curated, verified sources.

## Demo packs

Built by `scripts/data/build_data.py` (see `data/terrain/README.md`). Each pack holds:

| Id | Source |
| --- | --- |
| `-001` | LROC NAC DTM of the Apollo 15 site (PDS) |
| `-002` | LROC NAC orthophoto on the same grid; a crop is in `media/` |
| `-003` | DTM README excerpt on vertical accuracy (tie to LOLA) |
| `-004` | USGS Gazetteer of Planetary Nomenclature entry, origin text verbatim |
| `-005` | NASA (NSSDCA traverse record or Apollo 15 caption), quoted verbatim |
| `-006` | Hadley Rille only: NSSDCA Apollo 15 landing site record |

Measurements (`MEAS-<SITE>-<FEATURE>-<QTY>`) are not stored here: services/api and the agent tool server
compute them from the DEMs at startup.

Known gap: no peer-reviewed interpretive source (for example on the rille's origin) has been verified and
added yet, so hypothesis and skeptic agents have little to cite. Add literature only with a working URL and
a verbatim excerpt.
