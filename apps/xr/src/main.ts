// Boot: real headset → native WebXR (passthrough when available); anything else → the IWER emulator.
import { NexusApp } from "./app.js";
import { SITES } from "./config.js";
import type { Emulator } from "./emulator.js";
import { createWorld } from "./scene/world.js";
import "./style.css";

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  const status = document.querySelector<HTMLElement>("#status");
  const enter = document.querySelector<HTMLButtonElement>("#enter");
  if (!root || !status || !enter) return;
  const params = new URLSearchParams(window.location.search);

  const nativeVr = !params.has("emulator") && (await supported("immersive-vr"));
  const desktop = !params.has("devui");
  let emulator: Emulator | undefined;
  if (!nativeVr) {
    const { installEmulator } = await import("./emulator.js");
    // No devui parameter: the mouse is the hand. ?devui=1 shows IWER's own panel instead; ?devui=0 is the test setup.
    emulator = await installEmulator({ devUi: params.get("devui") === "1", desktop });
  }
  // Passthrough tabletop on a real Quest; VR room in the emulator.
  const mode: XRSessionMode = !emulator && (await supported("immersive-ar")) ? "immersive-ar" : "immersive-vr";

  const world = createWorld(root);
  const desktopMode = emulator !== undefined && desktop;
  const app = new NexusApp(world, { emulated: emulator !== undefined, desktop: desktopMode, simulatedTranscript: emulator?.takeSimulatedTranscript });
  let controls: { update(): void } | undefined;
  const siteParam = params.get("site");
  await app.loadSite(SITES.find((s) => s.siteId === siteParam)?.siteId ?? SITES[0].siteId);

  world.renderer.setAnimationLoop((t: number) => {
    controls?.update();
    app.frame(t);
    world.renderer.render(world.scene, world.camera);
  });

  const describe = () => {
    const s = app.state();
    status.textContent = `${emulator ? "Emulator (IWER, Quest 3 with hands)" : "Headset"} · ${s.paired ? "paired" : "not paired"} · ${s.screen}${s.pttActive ? " · listening" : ""}`;
  };
  app.onChange(describe);
  describe();

  enter.disabled = false;
  enter.addEventListener("click", async () => {
    if (!navigator.xr) return;
    const session = await navigator.xr.requestSession(mode, { requiredFeatures: ["local-floor"], optionalFeatures: ["hand-tracking"] });
    world.renderer.xr.setReferenceSpaceType("local-floor");
    await world.renderer.xr.setSession(session);
    for (const o of world.room) o.visible = mode !== "immersive-ar";
    if (mode === "immersive-ar") world.scene.background = null;
    enter.hidden = true;
    session.addEventListener("end", () => {
      enter.hidden = false;
      for (const o of world.room) o.visible = true;
    });
  });

  if (emulator && desktopMode) {
    const { DesktopControls } = await import("./input/desktop.js");
    controls = new DesktopControls(emulator.device, world, app);
    enter.click();
  }

  if (emulator) {
    const { aimHand, connectTargets } = await import("./emulator.js");
    connectTargets(emulator.device, app);
    const device = emulator.device;
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
  }
}

async function supported(mode: XRSessionMode): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported(mode)) ?? false;
  } catch {
    return false;
  }
}

void boot();
