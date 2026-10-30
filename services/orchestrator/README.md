# services/orchestrator

Starts one research run per observation, one at a time, and hands the raw results to `services/api`,
which runs the SIE. It never writes to the database and never sets a review status.

- **Triggers** (from the API event stream, service token): `observation.created` for spoken notes and video
  marks; `observation.selected` with `{ action: "investigate" }` when the scientist pokes Investigate.
- **Routing:** Jev `selectSpecialists` through `DecisionAdapter`, else `fallbackPolicy.ts`; only ids in `MVP_TEAM`.
- **Limits:** 3 min team timeout (SECURITY_PRIVACY.md); an unparseable `AgentOutput` is re-run once, then the
  task fails; self-approving output is never re-run; synthesis is re-run once if the SIE rejects it, and once
  more if the spoken briefing needs its rewrite.

## Team runner contract

`NEXUS_MODE=precomputed` (default) replays `data/precomputed/<SITE_ID>/<FEATURE_ID>.json`.

`NEXUS_MODE=live` runs `NEXUS_TEAM_CMD` (no shell) from the repo root. It receives JSON on stdin and prints JSON on stdout:

| stdin | stdout |
| --- | --- |
| `{ "mode": "run", "observation", "fieldNotes", "agentIds" }` | `{ "outputs": [{ "agentId", "output" }], "synthesis" }` |
| `{ "mode": "rerun", "agentId", "issues": [...], "observation", "fieldNotes", "agentIds" }` | `{ "output" }` |

`output` is each agent's raw `AgentOutput` JSON and `synthesis` is #22's `{ findingDraft, spokenBriefingDraft }`.
The command is the place to call `docker agent run` with flags checked against the installed docker-agent
version (AGENTS.md §8). Exit non-zero on failure; stderr is discarded.
