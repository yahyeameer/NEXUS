// Desktop emulator controls: the mouse is the right hand's pointer, a click is a pinch, and a few keys press the same
// buttons a hand would. Nothing here is a new action. It all goes through IWER's hand (set_transform / set_select_value),
// so the real hand code (ray, hover, pinch-drag to turn, two-hand zoom) is what the mouse exercises.
import type { XRDevice } from "iwer";
import { Quaternion, Raycaster, Vector2, Vector3 } from "three";
import type { NexusApp } from "../app.js";
import type { World } from "../scene/world.js";
import { controlsCard } from "../web/controlsCard.js";

/** How far in front of the eye the emulated hand floats while the mouse moves it. */
const HAND_DISTANCE_M = 0.55;
const FORWARD = new Vector3(0, 0, -1);

const CONFIRM = ["pair:go", "onboard:start", "sel:investigate"];


export class DesktopControls {
  private readonly ndc = new Vector2(0.4, -0.2);
  private readonly raycaster = new Raycaster();
  private readonly q = new Quaternion();
  private dirty = true;
  private queue: Promise<unknown> = Promise.resolve();
  private talking = false;

  constructor(
    private readonly device: XRDevice,
    private readonly world: World,
    private readonly app: NexusApp,
  ) {
    const el = world.renderer.domElement;
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.move(e);
      this.flush();
      this.send("set_select_value", { value: 1 });
    });
    el.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      this.move(e);
      this.flush();
      this.send("set_select_value", { value: 0 });
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.app.zoomBy(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener("keydown", (e) => this.key(e, "down"));
    window.addEventListener("keyup", (e) => this.key(e, "up"));
    document.body.append(controlsCard());
  }

  /** Called every frame: sends at most one hand pose per frame however fast the mouse moves. */
  update(): void {
    if (this.dirty) this.flush();
  }

  private move(e: PointerEvent): void {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.dirty = true;
  }

  private flush(): void {
    this.dirty = false;
    const cam = this.world.renderer.xr.getCamera();
    this.raycaster.setFromCamera(this.ndc, cam);
    const { origin, direction } = this.raycaster.ray;
    // The target ray points down -Z, so a hand on the eye ray aimed along it points exactly at the mouse.
    this.q.setFromUnitVectors(FORWARD, direction);
    const p = origin.clone().addScaledVector(direction, HAND_DISTANCE_M);
    this.send("set_transform", { position: { x: p.x, y: p.y, z: p.z }, orientation: { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w } });
  }

  private send(method: string, params: Record<string, unknown>): void {
    // One at a time, in order: a select must land after the pose it was clicked at.
    this.queue = this.queue.then(() => this.device.remote.dispatch(method, { device: "hand-right", ...params })).catch(() => undefined);
  }

  private key(e: KeyboardEvent, edge: "down" | "up"): void {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      // Hold to talk, like the wrist button: key repeat must not re-press it.
      if (edge === "down" && !e.repeat && !this.talking) {
        this.talking = this.app.press("wrist:ptt", "press");
      } else if (edge === "up" && this.talking) {
        this.talking = false;
        this.app.press("wrist:ptt", "release");
      }
      return;
    }
    if (edge !== "down" || e.repeat) return;
    if (e.key === "Enter") {
      // Enter confirms whatever the main panel is asking: pair, start, or investigate.
      for (const id of CONFIRM) if (this.app.press(id)) return;
      return;
    }
    const id = shortcut(e.key);
    if (id) this.app.press(id);
  }
}

function shortcut(key: string): string | undefined {
  if (/^[0-9]$/.test(key)) return `pair:${key}`;
  switch (key) {
    case "Backspace":
      return "pair:del";
    case "q":
    case "Q":
    case "ArrowLeft":
      return "view:rotate_left";
    case "e":
    case "E":
    case "ArrowRight":
      return "view:rotate_right";
    case "+":
    case "=":
      return "view:zoom_in";
    case "-":
      return "view:zoom_out";
    case "r":
    case "R":
      return "view:reset";
    case "Escape":
      return "evwin:close";
    default:
      return undefined;
  }
}
