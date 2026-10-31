// ARCapabilityDetector: what this browser can do before anything starts (brief: "detect capabilities before
// starting"). NEXUS is an AR application; when immersive AR is missing it offers the 3D viewer and says why, and it
// never quietly opens a VR session instead.

export interface XrCapabilities {
  /** navigator.xr exists. */
  webxr: boolean;
  /** isSessionSupported("immersive-ar"). */
  immersiveAr: boolean;
  /** WebXR needs a secure context (HTTPS or localhost). */
  secureContext: boolean;
}

export interface LaunchOptions {
  ar: { enabled: boolean; reason?: string };
  viewer3d: { enabled: true };
}

/** Optional AR features, requested and then read back from session.enabledFeatures. */
export const AR_REQUIRED_FEATURES = ["hit-test"] as const;
export const AR_OPTIONAL_FEATURES = ["local-floor", "anchors", "dom-overlay", "hand-tracking", "plane-detection"] as const;

export interface ArFeatures {
  hitTest: boolean;
  anchors: boolean;
  domOverlay: boolean;
  handTracking: boolean;
  localFloor: boolean;
  planeDetection: boolean;
}

export async function detectCapabilities(xr: XRSystem | undefined = navigator.xr, secureContext = window.isSecureContext): Promise<XrCapabilities> {
  let immersiveAr = false;
  if (xr) {
    try {
      immersiveAr = await xr.isSessionSupported("immersive-ar");
    } catch {
      immersiveAr = false;
    }
  }
  return { webxr: xr !== undefined, immersiveAr, secureContext };
}

/** What the launch screen offers, with a plain reason when AR is unavailable. */
export function launchOptions(caps: XrCapabilities): LaunchOptions {
  if (!caps.secureContext) return { ar: { enabled: false, reason: "AR needs a secure (HTTPS) connection." }, viewer3d: { enabled: true } };
  if (!caps.webxr) return { ar: { enabled: false, reason: "This browser has no WebXR. Use Meta Quest Browser, or Chrome on an ARCore Android phone." }, viewer3d: { enabled: true } };
  if (!caps.immersiveAr) return { ar: { enabled: false, reason: "This device does not support immersive AR. Explore in 3D instead." }, viewer3d: { enabled: true } };
  return { ar: { enabled: true }, viewer3d: { enabled: true } };
}

/**
 * Reads what the session actually granted. Browsers that do not report enabledFeatures (older Chrome) get the
 * features that were required, and optional ones count as missing until proven, so nothing is assumed.
 */
export function grantedFeatures(enabled: readonly string[] | undefined, required: readonly string[] = AR_REQUIRED_FEATURES): ArFeatures {
  const has = (f: string) => (enabled ? enabled.includes(f) : required.includes(f));
  return {
    hitTest: has("hit-test"),
    anchors: has("anchors"),
    domOverlay: has("dom-overlay"),
    handTracking: has("hand-tracking"),
    localFloor: has("local-floor"),
    planeDetection: has("plane-detection"),
  };
}
