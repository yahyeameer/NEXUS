// Desktop emulator (docs/TESTING.md "XR emulated"): Meta's Immersive Web Emulation Runtime stands in for a Quest 3
// with tracked hands. Loaded only when the browser has no immersive WebXR device, so the headset build never runs it.
import { metaQuest3, XRDevice } from "iwer";
import type { TargetResolver } from "iwer";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { NexusApp } from "./app.js";

export interface Emulator {
  device: XRDevice;
  /** The desktop stand-in for speech until an STT provider is chosen (services/voice-gateway NEXUS_SIMULATED_STT). */
  takeSimulatedTranscript: () => string | undefined;
}

export async function installEmulator(opts: { devUi: boolean }): Promise<Emulator> {
  const device = new XRDevice(metaQuest3);
  // Desktop Chrome exposes navigator.xr with no device behind it; replace it.
  device.installRuntime({ forceInstall: true });
  device.primaryInputMode = "hand";
  // Seated eye height, looking at the desk (scene/world.ts).
  device.position.set(0, 1.2, 0);
  if (opts.devUi) {
    // Keyboard and mouse control of the head and both hands; lazy so tests and the headset never load it.
    const { DevUI } = await import("@iwer/devui");
    device.installDevUI(DevUI);
  }
  return { device, takeSimulatedTranscript: simulatedSpeechBox() };
}

/** Lets IWER's hand sequences ("press main/card:approve") find the app's buttons and features. */
export function connectTargets(device: XRDevice, app: NexusApp): void {
  const resolver: TargetResolver = {
    resolve(target) {
      const name = typeof target === "string" ? target : target.name;
      const t = app.targets().find((x) => x.name === name);
      if (!t) return null;
      return { name, position: xyz(t.position), normal: xyz(t.normal), size: xyz(t.size) };
    },
    list: () => app.targets().map((t) => ({ name: t.name, position: xyz(t.position), size: xyz(t.size) })),
  };
  device.remote.setTargetResolver(resolver);
}

/** Points the right hand's target ray at a named target, as a scientist would before pinching. */
export async function aimHand(device: XRDevice, app: NexusApp, name: string, hand: "left" | "right" = "right"): Promise<boolean> {
  const t = app.targets().find((x) => x.name === name);
  if (!t) return false;
  const from = new Vector3(hand === "right" ? 0.12 : -0.12, 1.02, -0.25);
  // Matrix4.lookAt builds the camera convention: -Z toward the target, which is the target ray's direction.
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, t.position, new Vector3(0, 1, 0)));
  await device.remote.dispatch("set_transform", { device: `hand-${hand}`, position: xyz(from), orientation: { x: q.x, y: q.y, z: q.z, w: q.w } });
  return true;
}

function xyz(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

/** A small desktop box for typed "speech", clearly labelled as simulated (AGENTS.md rule 7 spirit). */
function simulatedSpeechBox(): () => string | undefined {
  const box = document.createElement("form");
  box.className = "sim-speech";
  box.innerHTML = `
    <label for="sim-speech">Simulated speech <span>(emulator only)</span></label>
    <input id="sim-speech" name="speech" autocomplete="off" placeholder="e.g. investigate this" maxlength="500" />
    <small>Hold “Hold to talk” on the wrist menu; on release this text is sent as your words. Your desktop mic still streams while held.</small>`;
  box.addEventListener("submit", (e) => e.preventDefault());
  document.body.append(box);
  const input = box.querySelector("input");
  return () => {
    const text = input?.value.trim();
    if (input) input.value = "";
    return text || undefined;
  };
}
