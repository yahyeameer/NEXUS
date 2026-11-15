// `pnpm demo:bundle`: writes data/demo/bundle.json, the precomputed research the XR client falls back to when no
// NEXUS service is reachable (static HTTPS hosting for judging). Fails loudly if any demo site does not pass the SIE.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildDemoBundle } from "./demoBundle.js";

const DATA = fileURLToPath(new URL("../../../data", import.meta.url));
const res = await buildDemoBundle(DATA);
if (!res.ok) {
  console.error(JSON.stringify({ level: "error", msg: "demo bundle not built", error: res.error }));
  process.exit(1);
}
await mkdir(`${DATA}/demo`, { recursive: true });
await writeFile(`${DATA}/demo/bundle.json`, `${JSON.stringify(res.value, null, 2)}\n`);
console.log(JSON.stringify({ level: "info", msg: "demo bundle written", sites: res.value.sites.map((s) => s.featureId) }));
