// Launch screen (brief, phase 1): what NEXUS is, the two ways in, and why AR is unavailable when it is. Plain web
// UI, kept apart from the spatial design system in src/ui/spatial.
import type { LaunchOptions } from "../ar/capabilities.js";
import { MOON_CREDIT } from "../planet/moonModel.js";

export interface LaunchScreen {
  el: HTMLElement;
  enterAr: HTMLButtonElement;
  enter3d: HTMLButtonElement;
  show(): void;
  hide(): void;
  /** A problem starting a session (permission refused, device error), shown under the buttons. */
  error(text: string | undefined): void;
  setOptions(opts: LaunchOptions, note?: string): void;
}

export function launchScreen(root: HTMLElement): LaunchScreen {
  const el = document.createElement("section");
  el.className = "launch";
  el.setAttribute("aria-labelledby", "launch-title");
  el.innerHTML = `
    <div class="launch-inner">
      <h1 id="launch-title">NEXUS</h1>
      <p class="launch-sub">Spatial intelligence for scientific discovery</p>
      <div class="launch-actions">
        <button id="enter-ar" class="btn btn-primary" type="button" disabled>Enter AR Exploration</button>
        <button id="enter-3d" class="btn btn-secondary" type="button" disabled>Explore in 3D</button>
      </div>
      <p class="launch-note" id="launch-note">Checking what this device supports…</p>
      <p class="launch-error" id="launch-error" role="alert" hidden></p>
      <p class="launch-credit">${MOON_CREDIT}</p>
    </div>`;
  root.append(el);
  const enterAr = el.querySelector<HTMLButtonElement>("#enter-ar");
  const enter3d = el.querySelector<HTMLButtonElement>("#enter-3d");
  const note = el.querySelector<HTMLElement>("#launch-note");
  const err = el.querySelector<HTMLElement>("#launch-error");
  if (!enterAr || !enter3d || !note || !err) throw new Error("launch screen markup");
  return {
    el,
    enterAr,
    enter3d,
    show: () => {
      el.hidden = false;
    },
    hide: () => {
      el.hidden = true;
    },
    error: (text) => {
      err.hidden = !text;
      err.textContent = text ?? "";
    },
    setOptions: (opts, extra) => {
      enterAr.disabled = !opts.ar.enabled;
      enter3d.disabled = !opts.viewer3d.enabled;
      const ar = opts.ar.enabled
        ? "AR places the Moon on a real table or floor. Your browser will ask to use the camera to find surfaces; nothing is recorded."
        : (opts.ar.reason ?? "AR is not available here.");
      note.textContent = extra ? `${ar} ${extra}` : ar;
    },
  };
}
