# Precomputed research

Demo-safe fallback for the three judged sites (AGENTS.md §6). `services/orchestrator` replays
`<SITE_ID>/<FEATURE_ID>.json` when it runs without `NEXUS_MODE=live`, so a selection still produces a
finding with every provider down.

Each file is a `TeamResult` (`services/orchestrator/src/teamRunner.ts`): one `AgentOutput` per agent plus the
synthesis draft and spoken briefing. `observationId` is `OBS-TEMPLATE` and is rebound to the real observation.

These outputs are **curated, not recorded model runs**: they were written by hand from the site's evidence
pack and the code-computed measurements, and each agent output says so in its notes. They get no special
treatment: every replay goes through the full SIE in services/api, and
`services/orchestrator/src/demoSites.test.ts` fails if any claim is removed or the briefing would not be spoken.
When a measurement changes (new DEM or feature geometry), update the numbers here to match and rerun that test.
