// Boot (brief, phase 1): detect capabilities → launch screen → either an immersive-ar session on a real device, or
// the 3D viewer fallback in the browser. NEXUS never substitutes a VR session for missing AR.
//
// URL parameters (development and tests only):
//   ?devui=0|1        emulated Quest 3 (IWER) from the start: 0 drives it by test hooks, 1 adds IWER's own panel
//   ?surface=emulated in the emulator, a flat test plane stands in for hit-test so placement can be exercised
//   ?site=<SITE_ID>   open that site's terrain directly instead of starting on the Moon globe
//   ?debug=1          show the status line and capability dump
import { NexusApp } from "./app.js";
import type { ExperienceMode } from "./app.js";
import { detectCapabilities, launchOptions } from "./ar/capabilities.js";
import { ARGestureController } from "./ar/gestureController.js";
import { startArSession } from "./ar/sessionManager.js";
import { EmulatedPlaneSurface, XrHitTestSurface } from "./ar/surfaceDetection.js";
import type { SurfaceSource } from "./ar/surfaceDetection.js";
import { DEFAULT_STAGE } from "./ar/stage.js";
import { SITES } from "./config.js";
import { agentName } from "./ui/findingView.js";
import type { Emulator } from "./emulator.js";
import { loadSiteLocations, regionCentre } from "./planet/regions.js";
import { DEFAULT_TABLE } from "./scene/tabletop.js";
import { createWorld } from "./scene/world.js";
import { setupDebug } from "./web/debugPanel.js";
import { launchScreen } from "./web/launch.js";
import { ArToolbar } from "./web/toolbar.js";
import "./web/style.css";

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  const overlay = document.querySelector<HTMLElement>("#overlay");
  const status = document.querySelector<HTMLElement>("#status");
  if (!root || !overlay || !status) return;
  const params = new URLSearchParams(window.location.search);
  const debug = setupDebug(status, params.get("debug") === "1");
  const launch = launchScreen(overlay);

  // Dev and test emulator from the start; otherwise the real browser's capabilities decide what is offered.
  let emulator: Emulator | undefined;
  const devEmulator = params.has("devui") || params.has("emulator");
  if (devEmulator) emulator = await installEmulator(params, false);
  let hooksExposed = false;
  const exposeHooks = () => {
    if (!emulator || hooksExposed) return;
    hooksExposed = true;
    exposeTestHooks(app, emulator, world);
  };
  const caps = await detectCapabilities();
  debug.features(caps);
  launch.setOptions(launchOptions(caps), emulator ? "Emulator: an emulated Quest 3 stands in for the headset." : undefined);

  const world = createWorld(root);
  const app = new NexusApp(world, { emulated: devEmulator, desktop: false, simulatedTranscript: () => emulator?.takeSimulatedTranscript() });
  const toolbar = new ArToolbar(overlay, { act: (id) => app.act(id) });
  let controls: { update(): void } | undefined;
  let gestures: ARGestureController | undefined;
  app.guardSelect(() => gestures?.suppressSelect ?? false);

  // Start on NASA's globe; ?site= opens a terrain region directly (tests, demos).
  const siteParam = SITES.find((s) => s.siteId === params.get("site"))?.siteId;
  const ready = prepareEnvironment(app, siteParam);

  world.renderer.setAnimationLoop((t: number) => {
    controls?.update();
    app.frame(t);
    world.renderer.render(world.scene, world.camera);
  });

  const describe = () => {
    const s = app.state();
    status.textContent = `${emulator ? "Emulator (IWER, Quest 3 with hands)" : "Device"} · ${s.ar.mode} · ${s.ar.phase} · ${s.ar.environment} · ${s.paired ? "paired" : "not paired"} · ${s.screen}${s.pttActive ? " · listening" : ""}`;
    toolbar.update(s);
    if (emulator) {
      emulator.voiceBox.levelSource(() => app.micLevel);
      emulator.voiceBox.state(s.voice.mode, s.voice.speaker ? agentName(s.voice.speaker) : undefined);
    }
  };
  app.onChange(describe);
  describe();

  const begin = async (mode: ExperienceMode): Promise<void> => {
    launch.error(undefined);
    launch.enterAr.disabled = launch.enter3d.disabled = true;
    await ready;
    if (mode === "viewer" && !emulator) {
      // The 3D viewer: an emulated headset whose mouse is the hand, looking at the model on a virtual desk height.
      emulator = await installEmulator(params, true);
      exposeHooks();
    }
    const started = await startArSession(world.renderer, { overlayRoot: overlay });
    if (!started.ok) {
      launch.error(started.error);
      launch.setOptions(launchOptions(caps));
      return;
    }
    const { session, features } = started.value;
    debug.features(caps, features);
    launch.hide();
    let surface: SurfaceSource | undefined;
    if (mode === "ar") {
      surface = features.hitTest ? await XrHitTestSurface.create(session, () => world.renderer.xr.getReferenceSpace()) : undefined;
      // The emulator has no room for hit-test to see; tests can opt into a flat stand-in plane.
      if (!surface && emulator && params.get("surface") === "emulated") surface = new EmulatedPlaneSurface(world.renderer, DEFAULT_TABLE.center.y);
    }
    // Without a surface to find, the emulator keeps its seated layout; a real device places ahead of the viewer.
    const fixedAt = mode === "viewer" || (!surface && emulator) ? DEFAULT_STAGE.surface : undefined;
    app.beginSession(session, mode, surface, features.anchors, fixedAt);
    toolbar.show(mode === "viewer" || features.domOverlay);
    if (features.domOverlay) {
      overlay.classList.add("ar-touch");
      gestures = new ARGestureController(overlay, { rotateBy: (r) => app.rotateBy(r), scaleBy: (f) => app.zoomBy(f) });
    }
    if (mode === "viewer" && emulator && !params.has("devui")) {
      const { DesktopControls } = await import("./input/desktop.js");
      app.setDesktop(true);
      controls ??= new DesktopControls(emulator.device, world, app);
    }
    session.addEventListener("end", () => {
      gestures?.dispose();
      gestures = undefined;
      overlay.classList.remove("ar-touch");
      toolbar.show(false);
      launch.show();
      launch.setOptions(launchOptions(caps));
    });
  };
  launch.enterAr.addEventListener("click", () => void begin("ar"));
  launch.enter3d.addEventListener("click", () => void begin("viewer"));

  exposeHooks();
}

/** Loads the globe (and the site, if one was asked for) while the launch screen is up: progressive, not blocking. */
async function prepareEnvironment(app: NexusApp, siteId: string | undefined): Promise<void> {
  const globe = app.env.moon.load().catch(() => undefined);
  const marks = loadSiteLocations(SITES.map((s) => s.siteId)).then((locs) => {
    const centre = regionCentre(locs);
    if (centre) app.env.markRegion(centre);
  });
  if (siteId) {
    await app.openRegion(siteId);
  } else {
    app.showGlobe();
    await Promise.all([globe, marks]);
    // Sites load behind the globe so opening the region is instant.
    void app.loadSite(SITES[0].siteId);
  }
}

async function installEmulator(params: URLSearchParams, viewer: boolean): Promise<Emulator> {
  const { installEmulator: install } = await import("./emulator.js");
  // The 3D viewer drives the emulated hand with the mouse; ?devui=1 shows IWER's own panel; ?devui=0 is the test setup.
  return install({ devUi: params.get("devui") === "1", desktop: viewer && !params.has("devui") });
}

function exposeTestHooks(app: NexusApp, emulator: Emulator, world: ReturnType<typeof createWorld>): void {
  void import("./emulator.js").then(({ aimHand, connectTargets }) => {
    const device = emulator.device;
    connectTargets(device, app);
    // Test hooks for Playwright (apps/xr/e2e): they drive the emulated hands, never the app's handlers directly.
    Object.assign(window, {
      __nexus: {
        state: () => app.state(),
        targets: () => app.targets().map((t) => t.name),
        remote: (method: string, params?: Record<string, unknown>) => device.remote.dispatch(method, params),
        aim: (name: string, hand?: "left" | "right") => aimHand(device, app, name, hand),
        /** Where a target appears in the window, so desktop tests can aim the mouse at it. */
        screenPoint: (name: string) => {
          const t = app.targets().find((x) => x.name === name);
          if (!t) return undefined;
          const p = t.position.clone().project(world.renderer.xr.getCamera());
          const r = world.renderer.domElement.getBoundingClientRect();
          return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
        },
      },
    });
  });
}

void boot();
