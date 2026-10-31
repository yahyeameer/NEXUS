# apps/xr: NEXUS headset client

Three.js WebXR client for Meta Quest Browser. With no headset, it runs in **IWER** (Meta's Immersive Web Emulation
Runtime), which emulates a Quest 3 with tracked hands in a desktop browser.

## Run it without a Quest

```bash
pnpm install
pnpm dev:xr        # API (in memory) + orchestrator (precomputed) + voice gateway (simulated speech) + this client
```

Open https://localhost:5173 and accept the self-signed certificate. Press **Enter XR**. The IWER panel lets you move the
head and both hands with mouse and keyboard. Pair with code `1234`, or set `NEXUS_PAIRING_CODE`.

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
- `?devui=0` hides the IWER panel, which is what the tests use.
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
src/emulator.ts       IWER device, dev UI, test target resolver, simulated-speech box
src/app.ts            screens, selection → research → finding → review, wrist menu, voice wiring
src/scene/            world, terrain diorama (packages/terrain buildMesh), feature picking, tile↔scene mapping
src/input/            fingertip poke + ray/pinch for hands and controllers
src/ui/               canvas panels and the finding-card model
src/net/, src/audio/  API + event stream, voice gateway socket, push-to-talk mic, captioned speech
```

## Not yet in this client

Grab-and-move of the terrain; the immersive mode; the video panel; debate; whisper mode; suggested-question chips;
spatial (HRTF) voices; evidence beams; audio cues for ring states; the offline precomputed bundle inside the client.
These follow the later milestones in `docs/TASKS.md`.
