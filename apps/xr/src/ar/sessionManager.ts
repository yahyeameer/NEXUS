// ARSessionManager: starts and ends the immersive-ar session. Hit-test is what makes placement possible, so it is
// asked for first; a browser that offers AR without hit-test still gets an AR session, and placement falls back to
// a fixed spot in front of the user (said plainly in the status), never to VR.
import type { WebGLRenderer } from "three";
import { AR_OPTIONAL_FEATURES, AR_REQUIRED_FEATURES, grantedFeatures } from "./capabilities.js";
import type { ArFeatures } from "./capabilities.js";

export interface ArSession {
  session: XRSession;
  features: ArFeatures;
  referenceSpaceType: XRReferenceSpaceType;
}

export type StartResult = { ok: true; value: ArSession } | { ok: false; error: string };

export interface StartOptions {
  /** DOM overlay root for phone AR: the toolbar and hints live here (ignored where unsupported, e.g. Quest). */
  overlayRoot?: HTMLElement;
}

export async function startArSession(renderer: WebGLRenderer, opts: StartOptions = {}): Promise<StartResult> {
  const xr = navigator.xr;
  if (!xr) return { ok: false, error: "This browser has no WebXR." };
  const init = (required: readonly string[]): XRSessionInit => ({
    requiredFeatures: [...required],
    optionalFeatures: [...AR_OPTIONAL_FEATURES],
    ...(opts.overlayRoot ? { domOverlay: { root: opts.overlayRoot } } : {}),
  });
  let session: XRSession;
  let required: readonly string[] = AR_REQUIRED_FEATURES;
  try {
    session = await xr.requestSession("immersive-ar", init(required));
  } catch (first) {
    // Camera permission refused, or no hit-test: try once more with nothing required before giving up.
    if (first instanceof DOMException && first.name === "NotAllowedError") return { ok: false, error: "Camera access was not allowed, so AR cannot start." };
    try {
      required = [];
      session = await xr.requestSession("immersive-ar", { ...init(required), optionalFeatures: [...AR_REQUIRED_FEATURES, ...AR_OPTIONAL_FEATURES] });
    } catch (second) {
      const name = second instanceof DOMException ? second.name : "";
      return { ok: false, error: name === "NotAllowedError" ? "Camera access was not allowed, so AR cannot start." : "This device could not start an AR session." };
    }
  }
  const enabled = (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures;
  const features = grantedFeatures(enabled, required);
  const referenceSpaceType: XRReferenceSpaceType = features.localFloor || enabled === undefined ? "local-floor" : "local";
  renderer.xr.setReferenceSpaceType(referenceSpaceType);
  try {
    await renderer.xr.setSession(session);
  } catch {
    // local-floor can be refused even when listed; local is always available in immersive sessions.
    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(session);
    return { ok: true, value: { session, features: { ...features, localFloor: false }, referenceSpaceType: "local" } };
  }
  return { ok: true, value: { session, features, referenceSpaceType } };
}
