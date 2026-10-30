# AGENTS.md — NEXUS

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repository.
Read this file fully before writing code. When this file and another doc disagree, this file wins; flag the conflict in your PR.

---

## 1. What we are building

**NEXUS** is an agentic spatial intelligence platform for scientific discovery, running on **Meta Quest** (WebXR via IWSDK).
A scientist explores lunar terrain, points at a feature and *says what they see*. Specialist AI agents investigate it using real NASA data.
A **Scientific Integrity Engine (SIE)** checks every claim — written **and spoken** — before it reaches the headset.
Findings appear anchored to the terrain and are spoken by agents from where they are working. The scientist approves, rejects or marks them inconclusive.

- Competition: **Meta VR Start Developer Competition 2026**, Productivity track.
- Hard deadline: **Nov 18, 2026, 12:00 PM PST**. Feature freeze: **Nov 15**. Submit target: **Nov 17**.
- Full product spec: `docs/PRD.md` (v2, Voice Intelligence Edition). Short specs per area live in `docs/`.

---

## 2. Non-negotiable rules

These rules come from the competition and from the product's core promise. Breaking one is a blocking bug.

1. **Hands-complete.** Every action must be completable with hands alone. Voice is always an optional shortcut. Any new voice feature needs a hand equivalent in the same PR (`docs/INTERACTION.md`).
2. **Nothing reaches the user without the SIE.** No finding is rendered and no sentence is spoken unless it has an SIE decision (`docs/SCIENTIFIC_INTEGRITY.md`). Only fixed system phrases in `packages/voice/src/systemPhrases.ts` are exempt.
3. **No invented evidence.** Agents may only cite evidence IDs that exist in the evidence store. Never fabricate dataset IDs, URLs, coordinates or measurements — not in code, fixtures, prompts or demo data.
4. **Numbers come from code, not models.** Depth, slope, distance and elevation values are computed from terrain data by deterministic code. Models may explain numbers, never produce them.
5. **Speak at the confidence of the evidence.** Spoken framing must match the claim type (Epistemic Voice Policy, `docs/VOICE.md` §5).
6. **No secrets in the client.** The XR app never holds model, speech or data provider keys. All provider calls go through backend services.
7. **Label simulated data.** Simulated telemetry and archival imagery are never presented as live mission data.
8. **The scientist decides.** No agent or service may set a finding to `reviewed`. Only a human review event can.
9. **Push-to-talk by default.** No always-on microphone. Raw audio is stored only with explicit opt-in.

---

## 3. Repository layout

The repo is a pnpm monorepo. If a folder below does not exist yet, create it in this shape.

```
nexus/
├─ AGENTS.md                  ← you are here
├─ CLAUDE.md                  ← points here
├─ README.md
├─ apps/
│  ├─ xr/                     ← IWSDK / Three.js WebXR client (Quest Browser)
│  └─ dashboard/              ← Next.js companion (optional, post-MVP)
├─ services/
│  ├─ api/                    ← Fastify: observations, findings, reviews, WebSocket events
│  ├─ voice-gateway/          ← Fastify WS: mic stream in, STT, intent routing, TTS out
│  └─ orchestrator/           ← runs Docker Agent teams, collects structured outputs
├─ packages/
│  ├─ schemas/                ← zod schemas + TS types shared by every app/service
│  ├─ sie/                    ← Scientific Integrity Engine: validators + Jev adapter
│  ├─ voice/                  ← intent grammar, deictic resolver, script validator, system phrases
│  └─ terrain/                ← DEM loading, mesh building, deterministic measurements
├─ agents/
│  ├─ nexus.yaml              ← Docker Agent team definition
│  └─ prompts/                ← canonical instruction spec per agent
├─ data/
│  ├─ evidence-packs/         ← one JSON pack per site (curated, sourced)
│  └─ terrain/                ← DEM tiles + textures (git LFS)
├─ infra/
│  └─ docker-compose.yml      ← Postgres+PostGIS, api, voice-gateway, orchestrator
└─ docs/
```

---

## 4. Tech stack

| Area | Choice |
| --- | --- |
| Language | TypeScript everywhere (strict mode) |
| Runtime | Node.js ≥ 20.19 (IWSDK requirement) |
| Package manager | pnpm workspaces |
| XR client | IWSDK + Three.js, hand tracking, passthrough, spatial anchors, Web Audio |
| Backend | Fastify, WebSocket |
| Validation | zod (all boundaries) |
| Database | PostgreSQL + PostGIS |
| Agents | Docker Agent (YAML), MCP tools, Docker Sandboxes |
| Reasoning / decisions | Muse (via adapter) / Jev (via adapter) |
| Speech | Hosted streaming STT + TTS behind `services/voice-gateway` adapters |
| Tests | Vitest (unit), Playwright + IWER emulator (XR flows) |

Vendor-specific code lives only in adapters (`*Adapter.ts`). Never import a provider SDK outside its adapter.

---

## 5. Commands

```bash
pnpm install
pnpm dev            # all services + XR client with HTTPS for Quest
pnpm dev:xr         # XR client only, IWER emulator in desktop browser
pnpm test           # vitest across workspace
pnpm test:e2e       # Playwright XR flows (emulated)
pnpm lint
pnpm typecheck
pnpm sie:redteam    # runs planted-bad-claim fixtures through the SIE (must all be caught)
docker compose -f infra/docker-compose.yml up -d
```

If a command is missing, add it to the root `package.json` rather than inventing a different one.

Before marking any task done, run: `pnpm typecheck && pnpm lint && pnpm test && pnpm sie:redteam`.

---

## 6. How to work here

- **Read the matching doc first.** Voice → `docs/VOICE.md`. SIE → `docs/SCIENTIFIC_INTEGRITY.md`. Events → `docs/EVENTS.md`. Data shapes → `docs/DATA_MODELS.md`.
- **Schemas first.** New data → add the zod schema in `packages/schemas`, export the type, then use it. Never hand-write a duplicate type.
- **Events, not direct writes.** Agents and the voice gateway never write to the database directly. They emit events or call `services/api` endpoints that validate input.
- **Small PRs** scoped to one milestone task from `docs/TASKS.md`. Tick the box in the same PR.
- **Demo safety.** Every live path (LLM, STT, TTS, datasets) needs a cached/precomputed fallback for the three demo sites. The judged build must work if a provider is down.
- **Performance budget on Quest:** keep frame rate stable at 72 fps+. Terrain mesh ≤ 256×256 vertices for MVP, textures ≤ 2048². No per-frame allocations in render loops.
- **Comfort:** UI 50–70 cm from the user, slightly below eye level, poke targets ≥ 4 cm. Never place required UI at the edge of the field of view.

---

## 7. Coding standards

- `strict: true`, no `any` (use `unknown` + zod parse).
- Pure functions for validators and measurements; they must be unit-tested with fixtures.
- Errors: return typed results (`{ ok: true, value } | { ok: false, error }`) across service boundaries; never throw raw provider errors to the client.
- Logging: structured JSON with `observationId`, `findingId`, `utteranceId`, `agentId` where relevant. Never log raw audio or API keys.
- Naming: events `domain.noun.verb` (see `docs/EVENTS.md`); files `camelCase.ts`; React/IWSDK components `PascalCase`.
- Comments explain *why*. Link the PRD section when implementing a requirement: `// PRD §6.5 Epistemic Voice Policy`.

---

## 8. Agent (Docker Agent) rules

- Team definition: `agents/nexus.yaml`. Canonical behaviour spec per agent: `agents/prompts/<agent>.md`. Keep the YAML `instruction` and the prompt file in sync.
- Every agent returns JSON matching `AgentOutput` in `packages/schemas`. Output that fails parsing is retried once, then the task fails.
- Each agent gets only the tools it needs (`tools:` whitelist). Research agents get read-only data tools.
- Voice agents (51–56) are latency-critical: for MVP they run inside `services/voice-gateway` as direct model calls, not through the Docker Agent team.
- Validate Docker Agent YAML syntax against the installed version (`docker agent --version`) and official docs before relying on a field.

---

## 9. Definition of done (any feature)

- [ ] Works with hands only (verified in IWER emulator and on device when possible)
- [ ] If it speaks: script passes the SIE voice validator; captions shown
- [ ] If it shows a claim: claim has type, evidence IDs and SIE decision
- [ ] Fallback path works with providers disabled
- [ ] Types, lint, tests, red-team suite pass
- [ ] Docs updated if behaviour changed

---

## 10. Do not

- Do not add always-on listening, speaker identification or emotion detection.
- Do not let a model write measurements, coordinates or source URLs.
- Do not render "confirmed", "discovered" or "proven" for any AI finding.
- Do not run all agents at once or keep idle sandboxes alive (only the voice pool stays warm).
- Do not add new dependencies over ~200 KB to the XR client without noting the reason in the PR.
- Do not commit `.env`, keys, raw audio or large data outside git LFS.
