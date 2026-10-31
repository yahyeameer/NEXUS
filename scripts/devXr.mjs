// `pnpm dev:xr`: the whole stack for the desktop emulator, no headset and no database needed.
// API in memory, orchestrator in precomputed mode, voice gateway with simulated speech, XR client on HTTPS.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const token = () => randomBytes(18).toString("base64url");
const env = {
  ...process.env,
  NEXUS_PAIRING_CODE: process.env.NEXUS_PAIRING_CODE ?? "1234",
  ORCHESTRATOR_TOKEN: process.env.ORCHESTRATOR_TOKEN ?? token(),
  VOICE_GATEWAY_TOKEN: process.env.VOICE_GATEWAY_TOKEN ?? token(),
  NEXUS_SIMULATED_STT: "1",
  API_URL: "http://localhost:4000",
};
delete env.DATABASE_URL;

const isWindows = process.platform === "win32";

const procs = [
  ["api", ["--filter", "@nexus/api", "start"]],
  ["orchestrator", ["--filter", "@nexus/orchestrator", "start"]],
  ["voice", ["--filter", "@nexus/voice-gateway", "start"]],
  ["xr", ["--filter", "@nexus/xr", "dev"]],
].map(([name, args]) => {
  // On Windows pnpm is a .cmd shim, which spawn can only run through a shell.
  const p = spawn("pnpm", args, { env, stdio: ["ignore", "pipe", "pipe"], shell: isWindows });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", prefix);
  p.stderr.on("data", prefix);
  p.on("exit", (code) => {
    console.log(`[${name}] exited (${code ?? "signal"})`);
    shutdown(code ?? 1);
  });
  return p;
});

console.log(`\nNEXUS emulator stack: open https://localhost:5173 (pairing code ${env.NEXUS_PAIRING_CODE}).\n`);

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    // A shell wrapper hides the real process on Windows, so end the whole tree.
    if (isWindows && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
