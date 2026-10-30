import { systemPhrases } from "@nexus/voice";

// Placeholder shell. The IWSDK scene (hand tracking, passthrough, anchors) replaces this
// in the Phase 1 task "IWSDK app boots on Quest over HTTPS" (docs/TASKS.md).
const root = document.querySelector<HTMLElement>("#app");
if (root) {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = `${systemPhrases.welcome} XR support: ${"xr" in navigator ? "available" : "not detected"}.`;
  root.append(status);
}
