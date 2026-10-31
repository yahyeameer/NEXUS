# apps/xr: NEXUS AR client

Three.js WebXR client. NEXUS is an **AR application**: on Meta Quest (Quest Browser) or an ARCore Android phone
(Chrome) it opens an `immersive-ar` session, finds a real table or floor with WebXR hit-test, and the scientist taps
or pinches to place NASA's Moon there. There is no virtual room or sky: the camera passthrough is the background.
Browsers without immersive AR get the **3D viewer** instead, said plainly on the launch screen; NEXUS never swaps in a
VR session. The 3D viewer and the tests run on **IWER** (Meta's Immersive Web Emulation Runtime), which emulates a
Quest 3 with tracked hands.

## The flow

1. **Launch screen**: "Enter AR Exploration" (enabled only when `immersive-ar` is supported, with the reason when it is
   not) and "Explore in 3D". The browser asks for camera access when AR starts; nothing is recorded.
2. **Find a surface**: a small guide panel says what to do; a cyan ring with the model's footprint lies on the surface
   found by hit-test (right hand's ray on Quest, screen centre on a phone). Walls are ignored.
3. **Place**: pinch, trigger or tap. The pose is held by a WebXR anchor where the device grants `anchors`, otherwise
   fixed in the session's reference space. Devices with AR but no hit-test place it ahead of you, and say so.
4. **The Moon**: NASA's LRO colour globe (SVS 14959) with the surveyed region marked. Its position comes from the
   sites' own evidence (the LROC DTM item's lon/lat bbox), never typed in.
5. **The region**: pinch the marker (or a site button) to open that site's LROC terrain as a tabletop model on the same
   anchor; **Moon** goes back. Panels dock in front of you, turned toward the model, wherever it was placed.
6. **Move it**: pinch-drag turns, two-hand pinch zooms; on a phone, drag turns, pinch scales and twist turns. Reset and
   Move (search and place again) are on the wrist menu, and on the phone's on-screen toolbar.

## Run it without a headset

```bash
pnpm install
pnpm dev:xr        # API (in memory) + orchestrator (precomputed) + voice gateway (simulated speech) + this client
```

Open https://localhost:5173, accept the self-signed certificate and choose **Explore in 3D**. The **mouse is your
right hand**: no gestures needed. Pair with code `1234` (type it on the keyboard), or set `NEXUS_PAIRING_CODE`.

| Mouse and keyboard | Does |
| --- | --- |
| Move the mouse | Aims the right hand's ray. Buttons, rings and the globe's marker light up under it |
| Click | A pinch: press a button, pick a feature, open the region on the globe |
| Drag on the model | Turns it |
| Wheel | Zooms |
| `0`–`9`, `Backspace`, `Enter` | Pairing code; Enter also means Start and Investigate |
| Hold `Space` | Hold to talk (type your words in the Simulated speech box first) |
| `Q` / `E`, `+` / `-`, `R` | Turn, zoom, reset |
| `Esc` | Close the evidence window |

These keys press the same buttons a hand would, so nothing is desktop-only. The **Controls** card (top right) folds
this table away. Add `?devui=1` to get IWER's own panel for moving the head and both hands directly (the
fingertip-poke and palm-up paths), or `?devui=0` for the test setup.

| Do this | Hands |
| --- | --- |
| Place the model | Point the right hand's ray at a table or the floor until the ring appears, then pinch |
| Open the region | Point at the marker on the Moon and pinch, or poke a site button on the card |
| Select a feature | Point the right hand's ray at a glowing ring and pinch |
| Press a button | Poke it with the right index fingertip, or ray + pinch |
| Open the wrist menu | Turn the left palm up or toward your face |
| Turn or zoom | Pinch on the model and drag sideways to turn it. Pinch with both hands and spread or squeeze to zoom. The wrist menu also has Turn, Zoom and Reset |
| Back to the Moon, or move it | Wrist menu: **Moon**, **Move** |
| Measure | On the site card poke **Measure**, then pinch two points. Distance, height difference, mean gradient and the elevation range come from the full DEM by `packages/terrain` `lineMeasurement`, shown with method and source. A measurement, not a finding |
| Mark a spot | Poke **Mark a spot**, pinch anywhere, poke what you see, **Save**. It is stored as your observation (`OBS-…`) in your words and does not start research |
| Focus | Select a feature, then **Focus** (card or wrist menu): it glides to the middle and is magnified. **Reset** returns to the whole site |
| Read a finding | The card shows the research status, observation ID, claim category, the integrity check's decision (and whether Jev or the rule-based fallback made it), uncertainty, the summary, each claim with its type, supporting and contradicting evidence IDs and the source datasets. **More** pages through a long card |
| Compare readings | On a finding that carries an interpretation or hypothesis poke **Compare**: each reading with the evidence for and against it, side by side. Nothing is ranked; weighing them is yours |
| Open evidence | On a finding card poke **Evidence**, then a chip. The source opens beside the card with its credit, licence and image crop |
| Describe what you see | After selecting, poke descriptor chips. They are saved with the observation as your words |
| Talk (optional) | Hold **Hold to talk** on the wrist menu. Your desktop mic streams while held. Type your words in the **Simulated speech** box before you release, since no STT provider is chosen yet |

Query options (development and tests):

- `?site=ELBOW_CRATER` opens that site's terrain directly instead of starting on the Moon.
- `?devui=0` is what the hands-only tests use: an emulated Quest 3 from the start, no mouse hand, no IWER panel.
  `?devui=1` adds IWER's panel. `?emulator` forces the emulator even when the browser has a WebXR device.
- `?surface=emulated` (emulator only) stands a flat test plane in for hit-test, so the placement flow can be tried and
  tested. IWER cannot hit-test without its 10 MB synthetic-environment module, which this client does not load.
- `?debug=1` shows the status line and the capability dump. Users never see debug text otherwise.

`pnpm dev:xr:client` runs only this client. It needs the services running elsewhere: set `API_URL` and
`VOICE_GATEWAY_URL` for the Vite proxy.

## On a device

Run `pnpm dev` and open `https://<your-machine>:5173` on the same network: Quest Browser on a Quest 3/3S/Pro, or
Chrome on an ARCore Android phone. Choose **Enter AR Exploration**. The session requires `hit-test` and asks for
`anchors`, `dom-overlay` (phone toolbar), `hand-tracking`, `local-floor` and `plane-detection`; it reads back what was
granted (`?debug=1` shows it) and works with whatever subset the device gives.

## Terrain detail

Each site's DEM is drawn as 4 × 4 tiles (`src/planet/terrainTileManager.ts`, meshes from `packages/terrain`
`buildTileMesh`). Every 250 ms the tiles are given a level of detail from 9 to 129 vertices per side by how large they
look from the eye: all tiles first reach 33, then the nearest refine further while the total stays within the Quest
budget of 256² surface vertices. One tile changes per frame, skirts hide cracks between levels, and normals come from
the full DEM so lighting has no seams. Loading is progressive: grey coarse tiles as soon as the DEM arrives, the
orthophoto when it lands, finer tiles frame by frame. Measurements always read the full-resolution grid.

## NASA assets

`data/planets/moon/globe/` holds the Moon globe and its `provenance.json` (source URL, SHA-256 of the NASA file, credit,
what was changed and why, what the source does not state). `scripts/data/build_moon_globe.py` rebuilds it from NASA's
`moon_small.glb`. The globe is a display only: its units and CRS are not published, so nothing is measured on it.
Measurements come from the LROC terrain (`data/terrain/README.md`).

## Tests

- `pnpm test` runs the pure logic: terrain tiles, skirts and level-of-detail budgeting, placement stage maths, capability and feature reading, touch gestures, the globe's
  lat/lon frame, site locations from evidence, tile↔scene mapping, feature picking, the poke state machine, terrain
  gestures, PCM encoding and finding cards.
- `pnpm test:e2e` runs Playwright against the full emulator stack. The tests move IWER's emulated hands through its
  remote-control API: aiming at a surface and pinching to place, fingertip presses on panel buttons, ray + pinch on
  the globe's marker and terrain features, and palm-up for the wrist menu. They never call app handlers, so a passing
  run means the flow works with hands only. Stop `pnpm dev:xr` first, because the tests start their own clean stack.
  In environments with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Layout

```
src/main.ts           boot: capabilities → launch screen → AR session or 3D viewer
src/ar/               capability detection, session manager, surface detection (hit-test), placement reticle,
                      planetary anchor, placement flow, stage (layout ↔ placed pose), phone touch gestures
src/planet/           NASA Moon globe, site locations from evidence, the globe/region environment, terrain tiles with LOD
src/emulator.ts       IWER device, dev UI, test target resolver
src/interaction/      measurement tool, spot observation capture, spatial focus
src/app.ts            screens, selection → research → finding → review, wrist menu, voice wiring
src/scene/            renderer and lights, terrain model (packages/terrain buildMesh), feature picking, tile↔scene mapping
src/input/            fingertip poke + ray/pinch for hands and controllers; mouse-as-hand for the 3D viewer
src/ui/               the finding-card model and text layout
src/ui/spatial/       NEXUS Spatial UI design system (below)
src/web/              plain web UI: launch screen, toolbar and session status, debug panel, controls card, simulated speech
src/net/, src/audio/  API + event stream, voice gateway socket, push-to-talk mic, captioned speech
```

Panels draw over the model, and rays and pokes prefer the panel they visibly cross. HTML in `src/web` never imports
from `src/ui/spatial`, and nothing in `src/ui/spatial` touches the DOM outside its own canvases.

## NEXUS Spatial UI design system

World-space UI built directly on three.js, the client's existing renderer. `src/ui/spatial/tokens.ts` holds the
colours (dark translucent glass, one restrained cyan accent, amber only for "needs you"), type scale and motion.

| Component | What it is |
| --- | --- |
| `SpatialGlassPanel` | Base panel: canvas-drawn glass card with poke/ray buttons ≥ 4 cm, open/close fades and glides. A panel only reports button targets once it has settled, so a fingertip never chases a moving button |
| `ScientificFindingPanel` | The main card. Rises out of the selected feature, glides to its comfortable dock and stays tethered to the feature. Its lines come from `cardModel` in `src/ui/findingView.ts` |
| Claim badges | Observation (slate), measurement (cyan), interpretation (violet) and hypothesis (amber), always labelled in words too. An interpretation or hypothesis finding carries a line saying it is not an established result (`BADGE` in `tokens.ts`) |
| `UncertaintyIndicator` | A three-step meter badge (●○○ / ●●○ / ●●●) next to the level and explanation, neutral, amber or red (`uncertaintyBadge`) |
| `HypothesisComparison` | The **Compare** screen: every interpretation and hypothesis the finding holds, with its evidence for and against (`comparisonEntries`, `comparisonLines`) |
| `AgentActivityPanel` | Display-only card over the feature under investigation: which agents are working, done or stopped |
| `EvidenceViewer` | Evidence window with credit, licence and archival label, plus an evidence beam (the evidence connector) to the feature |
| `ScientificDecisionControls` | Approve / Reject / Inconclusive and the card's action row, in one place so the wording stays within AGENTS.md |
| `ObservationMarker` | Ring, halo, stem and bead on the terrain; colour follows the research state, swells under the pointer |
| `RockSelectionOutline` | Glowing line draped on the DEM around the selected feature's real footprint (rim, patch or rille course) |
| `ScanningBeam` | Faint cone and sweeping ring over a feature while it is researched. Shows work, never a result |
| `SpatialConnector` | Arc with a travelling pulse that ties a panel to its feature |
| `ResearchStatusIndicator` | Pill over a marker: Researching, Needs evidence, Ready for review, Approved by you… |

Panels draw over the terrain, and rays and pokes prefer the panel they visibly cross. HTML in `src/web` never imports
from `src/ui/spatial`, and nothing in `src/ui/spatial` touches the DOM outside its own canvases.

## Not yet in this client

Grab-and-move of the model by hand (Move re-places it instead); Mars (no curated Mars data yet); terrain tiles streamed from a server (tiles are cut in the client from each site's one DEM);
the immersive mode; the video panel; debate; whisper mode; suggested-question chips;
spatial (HRTF) voices; audio cues for ring states; the offline precomputed bundle inside the client.
These follow the later milestones in `docs/TASKS.md`.
