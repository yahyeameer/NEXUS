# 18-Day Task Plan

Deadline: **Nov 18, 2026, 12:00 PM PST (11:00 PM Mogadishu)**. Feature freeze **Nov 15**. Submit **Nov 17**.
Cut order if behind: Debate mode → extra languages → live mode polish → dashboard → third site.

## Phase 1 — Foundation (Oct 30 – Nov 2)

- [x] Monorepo scaffold (pnpm, TS strict, lint, vitest), `infra/docker-compose.yml`
- [ ] Confirm Docker Agent install + run a hello team from `agents/nexus.yaml`
- [ ] Confirm Muse access + `ReasoningAdapter`; confirm Jev access + `DecisionAdapter` (fallback policy if not available)
- [ ] STT/TTS provider bake-off on Quest: latency, word timestamps, languages → pick
- [ ] Test `speechSynthesis` and `getUserMedia` behaviour in Quest Browser
- [ ] IWSDK app boots on Quest over HTTPS; hand tracking + passthrough on
- [ ] Export first DEM + texture from Moon Trek; render tile on desk _(DEM + texture done from the LROC NAC DTM in PDS instead of Moon Trek; rendering lands with the XR client)_
- [x] `packages/schemas` with all models from DATA_MODELS.md

## Phase 2 — Observation + voice capture (Nov 1 – Nov 5)

- [ ] Ray/pinch selection of labelled features; observation registration
- [ ] Prerecorded video panel + simulated (labelled) telemetry timeline
- [ ] Push-to-talk on wrist menu; audio streaming to voice-gateway (gateway side done; wrist menu lands with the XR client)
- [ ] Streaming STT with word timestamps; captions strip
- [x] Intent router + command grammar
- [ ] Deictic resolver + clarification chips (resolver + candidates done; chips land with the XR client)
- [ ] FieldNote creation end to end

## Phase 3 — Agent research (Nov 3 – Nov 8)

- [x] Evidence packs for 3 sites (verified URLs, credits)
- [x] `packages/terrain` measurements + tests
- [ ] MCP tools: `evidence_lookup`, `terrain_measurements`
- [ ] Coordinator + 5 specialists running in Docker Agent; parallel where independent
- [x] Orchestrator: timeouts, retries, `AgentOutput` parsing
- [ ] Voice agents 51, 53, 54 inside voice-gateway (adapter seams, parsing, rewrite loop done; model client waits on Muse access)

## Phase 4 — Integrity + voice policy (Nov 6 – Nov 10)

- [x] Validators V1–V9 + tests
- [x] Voice validators VV1–VV3 + rewrite loop
- [x] Jev decision questions wired (or fallback)
- [x] Red-team suite green in CI
- [ ] Escalation + "Removed: no evidence" list

## Phase 5 — Spatial findings + voices (Nov 9 – Nov 13)

- [ ] Anchored finding cards, evidence windows, evidence beams
- [ ] Agent orbs + spatial voices (HRTF) + ducking
- [ ] Grounded Q&A (voice + chips) and provenance answers
- [ ] Review by poke + voice; rationale stored verbatim; Logbook
- [ ] Marker visual + audio states
- [ ] Precomputed mode for all 3 sites + pre-generated audio _(precomputed research done for all 3 sites; audio waits on the TTS provider)_
- [ ] ⏳ Evidence Debate (only if on schedule)

## Phase 6 — Test, film, submit (Nov 13 – Nov 17)

- [ ] TESTING.md checklist complete, incl. mic-disabled run
- [ ] Onboarding (first five minutes) polished
- [ ] Deploy XR build to HTTPS host; backend reachable; precomputed fallback verified on a clean Quest
- [ ] Record demo video (< 3 min) — script in SUBMISSION.md
- [ ] Upload video (YouTube/Vimeo, public)
- [ ] Fill Devpost form; submit by Nov 17
