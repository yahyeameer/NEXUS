# Testing

## Layers

| Layer | Tool | What |
| --- | --- | --- |
| Unit | Vitest | Validators, measurements, intent grammar, deictic scoring, schemas |
| Red-team | Vitest (`pnpm sie:redteam`) | Planted bad claims/scripts — all must be caught (see SCIENTIFIC_INTEGRITY.md §7) |
| Service | Vitest + Fastify inject | API endpoints, event ordering, auth on review endpoints |
| Agent contract | Fixture runs with `Fake*Adapter` | Every agent output parses as `AgentOutput` |
| XR emulated | Playwright + IWER (`pnpm test:e2e`) | Full flows hands-only and with simulated voice input. Tests drive IWER's emulated hands (fingertip press, ray + pinch, palm up), never app handlers. This is the main way to verify the XR app without a Quest |
| Device | Manual on Quest 3 | Comfort, frame rate, passthrough, audio placement |

## Acceptance checklist (run before submission)

**Core**

- [ ] Enter environment on Quest (tabletop + immersive)
- [ ] Select an observation by hand
- [ ] Observation registered with metadata
- [ ] Coordinator activates relevant agents
- [ ] Agents use real source material (evidence packs)
- [ ] Structured finding produced
- [ ] Jev evaluates decision task (or fallback logged)
- [ ] SIE validates finding + evidence references
- [ ] Insufficient evidence → more investigation/escalation, not certainty
- [ ] Finding appears at correct anchor
- [ ] Supporting + contradicting evidence inspectable
- [ ] Follow-up question works
- [ ] Approve / reject / inconclusive works
- [ ] Audit history present

**Voice**

- [ ] Spoken field note while pointing → observation at the pointed feature
- [ ] Ambiguous "this" → one clarification question
- [ ] Finding spoken from the lead agent's position, with captions
- [ ] Planted "hypothesis as fact" script rewritten or silenced
- [ ] Planted wrong number blocked
- [ ] Unsupported question → "I don't have evidence for that…"
- [ ] Spoken rejection reason stored verbatim
- [ ] Barge-in stops speech ≤ 300 ms
- [ ] **Full run with mic disabled succeeds**

**Resilience**

- [ ] Precomputed mode works with LLM, STT and TTS adapters disabled
- [ ] Mic permission denied → hands-only continues
- [ ] Backend unreachable → precomputed demo still loads

**Performance**

- [ ] Stable frame rate on Quest 3 while agents run and audio plays
- [ ] Start to first finding < 3 min for a new user
