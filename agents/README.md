# agents/

- `nexus.yaml` — Docker Agent team for the MVP research pipeline (catalog #1, 11, 22, 25, 26, 33, 34, 37).
- `prompts/` — canonical spec for each agent: role, inputs, tools, rules, output, examples. The YAML `instruction` is a short pointer; this folder is the source of truth.

Voice agents (`prompts/field_note_interpreter.md`, `dialogue_grounding_agent.md`, `spoken_briefing_composer.md`, `debate_moderator.md`) run inside `services/voice-gateway`, not in the Docker Agent team, to meet latency targets.

## Rules for every agent

1. Output **only** JSON matching `AgentOutput` (or the documented variant). No prose outside JSON.
2. Cite only evidence IDs returned by tools. Never invent IDs, URLs, product IDs, coordinates or numbers.
3. Every number in text must reference a `MeasurementRecord` id in `measurementIds`.
4. Stay inside your scope; anything else goes in `openQuestions`.
5. Label every claim with the right `claimType`. Hypotheses use hedged wording.
6. Never set or suggest a review status. The scientist decides.

## Running locally

```bash
docker agent run agents/nexus.yaml     # verify the exact CLI name/flags for your installed version
```

In the app, `services/orchestrator` starts the team per observation with timeouts and collects the outputs.
