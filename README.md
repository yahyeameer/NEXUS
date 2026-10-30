# NEXUS

**Discover beyond what you can see. Hear what the evidence says.**

NEXUS is an agentic spatial intelligence platform for scientific discovery on Meta Quest.
Point at a lunar feature and describe it out loud — specialist AI agents investigate it with real NASA data, a Scientific Integrity Engine checks every claim, and the findings appear (and are spoken) right where you're looking. You stay the final authority.

> Entry for the Meta VR Start Developer Competition 2026 — Productivity track.

## Highlights

- **Hands-first, voice-enhanced.** Everything works with hand tracking alone; voice makes it faster.
- **Spoken field notes.** "Layered outcrop here, darker band near the top" becomes an anchored observation.
- **Deictic grounding.** "This", "that ridge", "the boulder on the left" resolved from hand ray + gaze + words.
- **Spatial agent voices.** Each agent speaks from where it's working in the scene.
- **Epistemic Voice Policy.** NEXUS never sounds more certain than its evidence.
- **Evidence Debate.** Competing hypotheses argue out loud; you moderate.
- **Real data.** NASA Moon Trek, LRO LROC imagery, LRO LOLA elevation, PDS.

## Quick start

```bash
pnpm install
cp .env.example .env            # add provider keys (backend only)
docker compose -f infra/docker-compose.yml up -d
pnpm dev
```

Open the printed HTTPS URL in **Meta Quest Browser** (same network), or use the IWER emulator in a desktop browser with `pnpm dev:xr`, which needs no headset and no database (see `apps/xr/README.md`).

## Repository

| Path | What it is |
| --- | --- |
| `apps/xr` | WebXR client (IWSDK + Three.js) |
| `services/api` | Observations, findings, reviews, events |
| `services/voice-gateway` | Speech in/out, intent routing |
| `services/orchestrator` | Docker Agent team runner |
| `packages/sie` | Scientific Integrity Engine |
| `packages/voice` | Intent grammar, deictic resolver, script validator |
| `packages/terrain` | DEM → mesh, deterministic measurements |
| `agents/` | Docker Agent YAML + agent specs |
| `data/` | Evidence packs and terrain tiles |
| `docs/` | Specs — start with `docs/PRD.md` |

## Docs

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Voice Intelligence](docs/VOICE.md)
- [Scientific Integrity Engine](docs/SCIENTIFIC_INTEGRITY.md)
- [Agent catalog](docs/AGENT_CATALOG.md)
- [Interaction (hands + voice)](docs/INTERACTION.md)
- [Data models](docs/DATA_MODELS.md) · [Events](docs/EVENTS.md) · [Datasets](docs/DATASETS.md)
- [Security & privacy](docs/SECURITY_PRIVACY.md) · [Testing](docs/TESTING.md)
- [18-day task plan](docs/TASKS.md) · [Submission kit](docs/SUBMISSION.md)

## Data credits

Lunar imagery and elevation data courtesy of NASA / GSFC / Arizona State University (LROC) and NASA / GSFC (LOLA), accessed via NASA Moon Trek and the Planetary Data System. Verify each product's attribution text before release.

## License

TBD.
