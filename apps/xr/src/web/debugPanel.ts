// DebugPanel: the developer status line and capability dump. Hidden from users unless the page has ?debug=1
// (brief: no debug text permanently visible); the status line stays in the accessibility tree as a live region.
import type { XrCapabilities, ArFeatures } from "../ar/capabilities.js";

export function setupDebug(status: HTMLElement, enabled: boolean): { features(caps: XrCapabilities, features?: ArFeatures): void } {
  status.classList.toggle("debug-visible", enabled);
  const pre = document.createElement("pre");
  pre.className = "debug-panel";
  pre.hidden = !enabled;
  document.body.append(pre);
  return {
    features: (caps, features) => {
      pre.textContent = JSON.stringify({ capabilities: caps, granted: features ?? null }, null, 1);
    },
  };
}
