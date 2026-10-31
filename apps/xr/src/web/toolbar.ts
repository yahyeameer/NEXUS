// ARToolbar and SessionStatus: the small screen-space controls a phone (WebXR DOM overlay) or the 3D viewer shows.
// In a headset there is no DOM overlay, so the same actions live on the wrist menu (AGENTS.md rule 1: every action
// has a hand path). The toolbar presses the same button ids the spatial panels use.
import type { AppState } from "../app.js";

export interface ToolbarHooks {
  act: (id: string) => void;
}

const BUTTONS: { id: string; label: string; when: (s: AppState) => boolean }[] = [
  { id: "env:globe", label: "Moon", when: (s) => s.ar.environment === "region" },
  { id: "view:reset", label: "Reset view", when: () => true },
  { id: "ar:reposition", label: "Move", when: (s) => s.ar.mode === "ar" && s.ar.surface !== "none" },
];

export class ArToolbar {
  readonly el = document.createElement("nav");
  private readonly status = document.createElement("p");
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(root: HTMLElement, hooks: ToolbarHooks) {
    this.el.className = "toolbar";
    this.el.setAttribute("aria-label", "Explorer controls");
    this.status.className = "session-chip";
    this.status.setAttribute("aria-live", "polite");
    for (const b of BUTTONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-glass";
      btn.textContent = b.label;
      btn.dataset.id = b.id;
      btn.addEventListener("click", () => hooks.act(b.id));
      this.buttons.set(b.id, btn);
      this.el.append(btn);
    }
    // On phones a tap on the toolbar must not also place or pick through WebXR select.
    this.el.addEventListener("beforexrselect", (e) => e.preventDefault());
    this.el.hidden = true;
    this.status.hidden = true;
    root.append(this.status, this.el);
  }

  show(visible: boolean): void {
    this.el.hidden = !visible;
    this.status.hidden = !visible;
  }

  update(s: AppState): void {
    for (const b of BUTTONS) {
      const btn = this.buttons.get(b.id);
      if (btn) btn.hidden = s.ar.phase === "placing" || !b.when(s);
    }
    this.status.textContent = sessionStatusText(s);
  }
}

/** One short line on what the session is doing; pure so its wording is tested. */
export function sessionStatusText(s: AppState): string {
  if (s.ar.mode === "viewer") return "3D viewer · not AR";
  if (s.ar.phase === "placing") return s.ar.surfaceFound ? "AR · surface found, tap to place" : "AR · finding a surface";
  if (!s.ar.tracking) return "AR · tracking lost, move slowly";
  if (s.ar.anchor === "xr-anchor") return "AR · anchored";
  return s.ar.surface === "none" ? "AR · placed in front of you (no surface detection)" : "AR · placed";
}
