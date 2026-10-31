# apps/xr: NEXUS headset client

Three.js WebXR client for Meta Quest Browser. With no headset, it runs in **IWER** (Meta's Immersive Web Emulation
Runtime), which emulates a Quest 3 with tracked hands in a desktop browser.

## Run it without a Quest

```bash
pnpm install
pnpm dev:xr        # API (in memory) + orchestrator (precomputed) + voice gateway (simulated speech) + this client
```

Open https://localhost:5173 and accept the self-signed certificate. It enters the emulator by itself and the **mouse is
your right hand**: no gestures needed. Pair with code `1234` (type it on the keyboard), or set `NEXUS_PAIRING_CODE`.

| Mouse and keyboard | Does |
| --- | --- |
| Move the mouse | Aims the right hand's ray. Buttons and glowing rings light up under it |
| Click | A pinch: press a button, pick a feature |
| Drag on the terrain | Turns it |
| Wheel | Zooms |
| `0`–`9`, `Backspace`, `Enter` | Pairing code; Enter also means Start and Investigate |
| Hold `Space` | Hold to talk (type your words in the Simulated speech box first) |
| `Q` / `E`, `+` / `-`, `R` | Turn, zoom, reset |
| `Esc` | Close the evidence window |

These keys press the same buttons a hand would, so nothing is desktop-only. Add `?devui=1` to get IWER's own panel
for moving the head and both hands directly (the fingertip-poke and palm-up paths), or `?devui=0` for the test setup.

| Do this | Emulator |
| --- | --- |
| Select a feature | Point the right hand's ray at a glowing ring and pinch |
| Press a button | Poke it with the right index fingertip, or ray + pinch |
| Open the wrist menu | Turn the left palm up or toward your face |
| Turn or zoom the terrain | Pinch on the terrain and drag sideways to turn it. Pinch with both hands and spread or squeeze to zoom. The wrist menu also has Turn, Zoom and Reset buttons |
| Open evidence | On a finding card poke **Evidence**, then a chip. The source opens beside the card with its credit, licence and image crop |
| Describe what you see | After selecting, poke descriptor chips. They are saved with the observation as your words |
| Talk (optional) | Hold **Hold to talk** on the wrist menu. Your desktop mic streams while held. Type your words in the **Simulated speech** box before you release, since no STT provider is chosen yet |

Query options:

- `?site=ELBOW_CRATER` picks the starting site.
- `?devui=0` is what the hands-only tests use: no mouse hand, no IWER panel.
- `?emulator` forces the emulator even when the browser has a WebXR device.

`pnpm dev:xr:client` runs only this client. It needs the services running elsewhere: set `API_URL` and
`VOICE_GATEWAY_URL` for the Vite proxy.

## On a Quest

Run `pnpm dev` and open `https://<your-machine>:5173` in Quest Browser on the same network. The client asks for a
passthrough (`immersive-ar`) session when the headset supports it, so the diorama sits on your real desk.

## Tests

- `pnpm test` runs the pure logic: tile↔scene mapping, feature picking, the poke state machine, terrain gestures, PCM encoding and finding cards.
- `pnpm test:e2e` runs Playwright against the full emulator stack. The tests move IWER's emulated hands through its
  remote-control API: fingertip presses on panel buttons, ray + pinch on terrain features, and palm-up for the wrist
  menu. They never call app handlers, so a passing run means the flow works with hands only. Stop `pnpm dev:xr` first,
  because the tests start their own clean stack. In environments with a preinstalled Chromium, set
  `PLAYWRIGHT_CHROMIUM_PATH`.

## Layout

```
src/main.ts           boot: native WebXR or the emulator
src/emulator.ts       IWER device, dev UI, test target resolver
src/app.ts            screens, selection → research → finding → review, wrist menu, voice wiring
src/scene/            world, terrain diorama (packages/terrain buildMesh), feature picking, tile↔scene mapping
src/input/            fingertip poke + ray/pinch for hands and controllers; mouse-as-hand for the desktop emulator
src/ui/               the finding-card model and text layout
src/ui/spatial/       NEXUS Spatial UI design system (below)
src/web/              desktop-only HTML: simulated-speech box, controls card, page styles
src/net/, src/audio/  API + event stream, voice gateway socket, push-to-talk mic, captioned speech
```

## NEXUS Spatial UI design system

World-space UI built directly on three.js, the client's existing renderer. `src/ui/spatial/tokens.ts` holds the
colours (dark translucent glass, one restrained cyan accent, amber only for "needs you"), type scale and motion.

| Component | What it is |
| --- | --- |
| `SpatialGlassPanel` | Base panel: canvas-drawn glass card with poke/ray buttons ≥ 4 cm, open/close fades and glides. A panel only reports button targets once it has settled, so a fingertip never chases a moving button |
| `ScientificFindingPanel` | The main card. Rises out of the selected feature, glides to its comfortable dock and stays tethered to the feature |
| `AgentActivityPanel` | Display-only card over the feature under investigation: which agents are working, done or stopped |
| `EvidenceViewer` | Evidence window with credit, licence and archival label, plus an evidence beam to the feature |
| `ScientificDecisionControls` | Approve / Reject / Inconclusive and the card's action row, in one place so the wording stays within AGENTS.md |
| `ObservationMarker` | Ring, halo, stem and bead on the terrain; colour follows the research state, swells under the pointer |
| `RockSelectionOutline` | Glowing line draped on the DEM around the selected feature's real footprint (rim, patch or rille course) |
| `ScanningBeam` | Faint cone and sweeping ring over a feature while it is researched. Shows work, never a result |
| `SpatialConnector` | Arc with a travelling pulse that ties a panel to its feature |
| `ResearchStatusIndicator` | Pill over a marker: Researching, Needs evidence, Ready for review, Approved by you… |

Panels draw over the terrain, and rays and pokes prefer the panel they visibly cross. HTML in `src/web` never imports
from `src/ui/spatial`, and nothing in `src/ui/spatial` touches the DOM outside its own canvases.

## Not yet in this client

Grab-and-move of the terrain; the immersive mode; the video panel; debate; whisper mode; suggested-question chips;
spatial (HRTF) voices; audio cues for ring states; the offline precomputed bundle inside the client.
These follow the later milestones in `docs/TASKS.md`.
