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

`NEXUS_MODE=live` runs `NEXUS_TEAM_CMD` (no shell) from the repo root. Before each call the runner writes
`.nexus-run/<runId>/context.json` (`AgentRunContext`) and sets `NEXUS_RUN_DIR` to that folder, which is what the
NEXUS tool server (`src/mcp`, started by `agents/nexus.yaml`) reads. The command receives JSON on stdin and prints JSON on stdout:

| stdin | stdout |
| --- | --- |
| `{ "mode": "run", "observation", "fieldNotes", "agentIds" }` | `{ "outputs": [{ "agentId", "output" }], "synthesis" }` |
| `{ "mode": "rerun", "agentId", "issues": [...], "observation", "fieldNotes", "agentIds" }` | `{ "output" }` |

`output` is each agent's raw `AgentOutput` JSON and `synthesis` is #22's `{ findingDraft, spokenBriefingDraft }`.
The command is the place to call `docker agent run` with flags checked against the installed docker-agent
version (AGENTS.md §8). Exit non-zero on failure; stderr is discarded.

## Live research with Docker Agent

`src/team/teamCli.ts` implements this contract with docker-agent (checked against v1.161):

```bash
NEXUS_MODE=live
NEXUS_TEAM_CMD="pnpm --silent --dir services/orchestrator team"
GEMINI_API_KEY=...                 # read by agents/nexus.yaml; backend only
NEXUS_DOCKER_AGENT=docker-agent    # optional; default "docker agent"
NEXUS_AGENT_FLAVORS=container      # without Docker Desktop's MCP Gateway
NEXUS_TEAM_TIMEOUT_MS=600000       # optional; a full live team can take longer than the 3 min default
```

- **run:** the allowed agents run phase by phase (`PHASES` in `src/team/dockerAgentTeam.ts`, the coordinator's order), up to `NEXUS_TEAM_CONCURRENCY` (default 3) at once. Later phases receive earlier outputs, and all agents share the run's team board. A failed agent is skipped; synthesis must answer.
- **rerun:** one agent, with the issues, and the outputs saved in `$NEXUS_RUN_DIR/team-outputs.json` so a synthesis rerun can see them.
- Output is passed on raw. Parsing, the one retry and the SIE all stay in `researchRun.ts` and `services/api`.
- `infra/Dockerfile.agents` bundles docker-agent, uv and Chromium. Run it with `docker compose --profile live` (see `infra/docker-compose.yml`).

The read-only research browser is `src/mcp/browserMain.ts` (`pnpm --filter @nexus/orchestrator mcp:browser`).
