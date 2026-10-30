# agents/

- `nexus.yaml` — Docker Agent team for the research pipeline: 20 agents (catalog #1, 2, 3, 8, 11, 12, 14, 20, 22, 25, 26, 33, 34, 36, 37, 38, 39, 43, 45, 46).
- `prompts/` — canonical spec for each agent. The YAML loads each file with `instruction_file`, so the prompt file *is* the instruction and the two cannot drift.
- `prompts/_team_rules.md` — loaded before every agent's own prompt: output contract, evidence rules, web research policy.

Voice agents (`prompts/field_note_interpreter.md`, `dialogue_grounding_agent.md`, `spoken_briefing_composer.md`, `debate_moderator.md`) run inside `services/voice-gateway`, not in the Docker Agent team, to meet latency targets.

## The team

| Phase | Agents | Runs when |
| --- | --- | --- |
| root | `observation_coordinator` (#1, YAML key `root`) | always |
| 1 · what is there | `lola_elevation_researcher` (#26), `lroc_imagery_researcher` (#25), `lunar_image_analyst` (#2) | always |
| | `video_frame_analyst` (#3) | observation has a `frameRef` |
| | `visual_comparison_researcher` (#8) | a second observation is selected |
| 2 · what it may mean | `lunar_geology_researcher` (#11), `historical_observation_researcher` (#20) | always |
| | `impact_crater_researcher` (#12) | crater feature |
| | `lunar_volcanism_researcher` (#14) | rille, dome or mare feature |
| 3 · explanations | `hypothesis_generator` (#33), `alternative_explanation_researcher` (#34) | always |
| 4 · weighing | `contradiction_detection_agent` (#36), `research_gap_detector` (#38), `uncertainty_analyst` (#37) | always |
| 5 · draft | `research_synthesis_specialist` (#22) | always |
| 6 · integrity advisors | `claim_classification_agent` (#43), `finding_consistency_auditor` (#45) | always |
| 7 · next steps | `followup_investigation_planner` (#39) | always |
| | `human_review_escalation_agent` (#46) | contested, high uncertainty, or SIE escalation |

The Jev routing decision can drop any of these. Only the coordinator dispatches; specialists cannot call each other.

## Tools

| Toolset | What | Who |
| --- | --- | --- |
| `web_search` | DuckDuckGo `search` (Docker MCP `docker:duckduckgo`) | all 20 |
| `wikipedia` | Wikipedia search and summaries (`docker:wikipedia-mcp`) | all 20 |
| `papers` | Crossref, OpenAlex, Semantic Scholar, arXiv metadata search (`docker:paper-search`, no downloads) | all 20 |
| `science_fetch` | GET-only page reader limited to NASA, USGS, LPI, ADS, arXiv and a few other science hosts | all 20 |
| `nexus_evidence` | Read-only NEXUS MCP: `evidence_lookup`, `evidence_image`, `terrain_measurements`, `observation_get`, `fieldnote_get`, `site_features` | all 20 |
| `local_data` | Read-only filesystem over `data/evidence-packs`, `data/terrain`, `docs` | all 20 |
| `think` / `todo` | Scratchpad / task list | coordinator, hypothesis, skeptic, contradiction |
| `evidence_candidates` | `evidence_candidate_propose`: queue a web source for curation | the 7 literature-facing agents |

Not given to any agent: shell, file writes, code execution, memory, calculator, paper downloads, DuckDuckGo `fetch_content` (it would bypass the fetch domain list). `runtime.safety: restricted` denies any tool call that is not allowed or read-only.

### Web results are leads, not evidence

Every agent can search the web, but web pages are not in the evidence store, so a claim may still cite only `EV-…` and `MEAS-…` IDs (AGENTS.md rule 3). A useful web source goes into `openQuestions` and, for the literature-facing agents, into the curation queue via `evidence_candidate_propose`. It becomes citable only after #32 Dataset Provenance Validator checks it and a curator adds it to the site's evidence pack.

For the judged demo, run with `NEXUS_MODE=precomputed` so web tools are not on the critical path.

## Output contract

All agents except the coordinator and synthesis return `AgentOutput` (`packages/schemas/src/agentOutput.ts`), enforced by `structured_output` in `tool` mode: the runtime validates the JSON Schema, including `additionalProperties: false`, before the turn ends. The advisors (#38, #39, #43, #45, #46) return `claims: []` and put their findings in `openQuestions` (for people) and `notes` (JSON for the SIE), so the strict schema stays unchanged.

## Rules for every agent

1. Output **only** JSON matching `AgentOutput` (or the documented variant). No prose outside JSON.
2. Cite only evidence IDs returned by tools. Never invent IDs, URLs, product IDs, coordinates or numbers.
3. Every number in text must reference a `MeasurementRecord` id in `measurementIds`.
4. Stay inside your scope; anything else goes in `openQuestions`.
5. Label every claim with the right `claimType`. Hypotheses use hedged wording.
6. Never set or suggest a review status. The scientist decides.

## Requirements before a live run

- `services/orchestrator/dist/mcp/nexusTools.js` (not built yet) must expose the tools above, mark the read tools with `readOnlyHint: true` (the toolset is `readonly`, so unannotated tools are filtered out), and write `evidence_candidate_propose` only to a quarantined queue.
- Docker MCP Toolkit available for the `docker:` refs.
- Backend env: `MUSE_BASE_URL`, `MUSE_API_KEY`, `MUSE_MODEL`, `FAST_BASE_URL`, `FAST_API_KEY`, `FAST_MODEL` (see `.env.example`).

## Running locally

```bash
docker agent debug config agents/nexus.yaml   # parses and prints the canonical config
docker agent run --sandbox agents/nexus.yaml  # runs the team inside a Docker Sandbox
```

In the app, `services/orchestrator` starts the team per observation with timeouts and collects the outputs.
