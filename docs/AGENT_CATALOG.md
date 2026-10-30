# Agent Catalog (56 configurations)

Agents are **responsibilities**, not running processes. The coordinator activates only what an observation needs. A simple observation uses 3–5 research agents; a complex one 10–15.

Legend — **MVP**: ✅ built for the competition · ⏳ should-have · — later.
**Runs in**: `team` = Docker Agent team in a sandbox · `voice` = low-latency call inside voice-gateway · `code` = deterministic code, no model.

## Group 1 — Observation Intelligence (10)

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 1 | Observation Coordinator | Route observations, merge outputs, never makes claims itself | ✅ | team (root) |
| 2 | Lunar Image Analyst | Describe features visible in imagery | ⏳ | team |
| 3 | Video Frame Analyst | Describe selected video frames | ⏳ | team |
| 4 | Geological Feature Detector | Classify feature type (crater, rille, ridge…) | — | team |
| 5 | Rock Formation Analyst | Describe rock/boulder morphology | — | team |
| 6 | Surface Anomaly Analyst | Flag unusual features vs surroundings | — | team |
| 7 | Terrain Observation Analyst | Describe terrain context | — | team |
| 8 | Visual Comparison Researcher | Compare two observations visually | ⏳ | team |
| 9 | Observation Metadata Validator | Check timestamps, IDs, CRS | ✅ | code |
| 10 | Observation Quality Auditor | Flag low-quality frames/notes | — | code |

## Group 2 — Scientific Research (12)

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 11 | Lunar Geology Researcher | Interpretations from curated literature in the evidence pack | ✅ | team |
| 12 | Impact Crater Researcher | Crater morphology, degradation, relative age | ⏳ | team |
| 13 | Mineralogy Researcher | Composition evidence (only with spectral data) | — | team |
| 14 | Lunar Volcanism Researcher | Volcanic features incl. rilles | ⏳ | team |
| 15 | Regolith Researcher | Regolith properties | — | team |
| 16 | Tectonic Feature Researcher | Faults, wrinkle ridges, grabens | — | team |
| 17 | Surface Evolution Researcher | Sequence of events | — | team |
| 18 | Planetary Science Literature Researcher | Find literature (whitelisted sources) | — | team |
| 19 | Geological Hypothesis Researcher | Expand hypotheses from literature | — | team |
| 20 | Historical Observation Researcher | Apollo-era observations and records | ⏳ | team |
| 21 | Scientific Methodology Researcher | Suggest methods to test hypotheses | — | team |
| 22 | Research Synthesis Specialist | Draft finding from outputs (Muse) | ✅ | team |

## Group 3 — Dataset Intelligence (10)

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 23 | NASA Dataset Discovery Agent | Find candidate products | — | team |
| 24 | Lunar Reconnaissance Orbiter Researcher | LRO instrument context | — | team |
| 25 | LROC Imagery Researcher | Describe LROC imagery evidence items | ✅ | team |
| 26 | LOLA Elevation Data Researcher | Explain measurements computed by `packages/terrain` | ✅ | team + code |
| 27 | Terrain Model Analyst | Slope/profile analysis (code) | ✅ | code |
| 28 | Orbital Imagery Comparison Agent | Compare images across dates/illumination | — | team |
| 29 | Spatial Metadata Analyst | CRS, resolution, footprint checks | — | code |
| 30 | Dataset Quality Auditor | Product quality flags | — | code |
| 31 | Scientific Source Retrieval Agent | Fetch whitelisted sources into evidence store | — | team |
| 32 | Dataset Provenance Validator | Verify product IDs, licenses, credits | ✅ | code |

## Group 4 — Hypothesis and Evidence Analysis (8)

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 33 | Hypothesis Generator | Propose 2–3 hypotheses with evidence | ✅ | team |
| 34 | Alternative Explanation Researcher (Skeptic) | Alternatives + contradicting evidence | ✅ | team |
| 35 | Evidence Comparison Agent | Weigh evidence across hypotheses | — | team |
| 36 | Contradiction Detection Agent | Detect contradictions (supports SIE V6) | ⏳ | code + team |
| 37 | Scientific Uncertainty Analyst | Assign uncertainty level + explanation | ✅ | team |
| 38 | Research Gap Detector | What data is missing | ⏳ | team |
| 39 | Follow-up Investigation Planner | Suggest next observations | ⏳ | team |
| 40 | Hypothesis Review Agent | Internal consistency of hypotheses | — | team |

## Group 5 — Scientific Integrity (6) — *advisors to the SIE; the SIE itself is code + Jev*

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 41 | Source Verification Agent | Evidence ID existence (SIE V2) | ✅ | code |
| 42 | Evidence Integrity Auditor | Evidence ↔ claim mapping | ✅ | code |
| 43 | Claim Classification Agent | Assign claim types (SIE V5) | ✅ | team |
| 44 | Scientific Scope Validator | Agent scope checks (SIE V4) | ✅ | code |
| 45 | Finding Consistency Auditor | Summary vs claims consistency | ⏳ | team |
| 46 | Human Review Escalation Agent | Prepare escalation notes | ⏳ | team |

## Group 6 — Spatial Intelligence (4)

| # | Agent | Scope | MVP | Runs in |
| --- | --- | --- | --- | --- |
| 47 | Spatial Coordinate Validator | CRS + coordinate sanity (SIE V8) | ✅ | code |
| 48 | Scientific Annotation Generator | Card layout payload from finding | ✅ | code |
| 49 | Spatial Evidence Anchor Agent | Map evidence to terrain points/regions (beams) | ✅ | code |
| 50 | Environment Synchronisation Agent | Push state to XR | ✅ | code |

## Group 7 — Voice and Conversation (6) — new

| # | Agent | Scope | May not | MVP | Runs in |
| --- | --- | --- | --- | --- | --- |
| 51 | Field Note Interpreter | Transcript → structured observation | Add descriptors the user didn't say | ✅ | voice |
| 52 | Deictic Reference Resolver | Resolve "this/that" from ray + gaze + words | Resolve below threshold | ✅ | code |
| 53 | Dialogue Grounding Agent | Answer from evidence only | Use outside knowledge unlabelled | ✅ | voice |
| 54 | Spoken Briefing Composer | Write spoken scripts and mission briefing | Bypass SIE voice check | ✅ | voice |
| 55 | Debate Moderator | Run Evidence Debate turns | Declare a winner | ⏳ | voice |
| 56 | Review Rationale Recorder | Store spoken decisions verbatim | Paraphrase the user | ✅ | code |

## MVP research team (Docker Agent)

`observation_coordinator` → (`lola_elevation_researcher`, `lroc_imagery_researcher`) in parallel → (`lunar_geology_researcher`, `hypothesis_generator`, `alternative_explanation_researcher`) → `uncertainty_analyst` → `research_synthesis_specialist` → SIE.

See `agents/nexus.yaml` and `agents/prompts/`.

## Common output contract

Every team agent returns JSON matching `AgentOutput` (`docs/DATA_MODELS.md`). Free text outside that JSON is discarded.
