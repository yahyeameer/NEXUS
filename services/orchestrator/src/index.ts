import { resolve } from "node:path";
import { HttpApi } from "./apiClient.js";
import { Dispatcher, listen } from "./dispatcher.js";
import { buildServer } from "./server.js";
import type { TeamRunner } from "./teamRunner.js";
import { CommandRunner, PrecomputedRunner } from "./teamRunner.js";

const port = Number(process.env.ORCHESTRATOR_PORT ?? 4200);
const host = process.env.HOST ?? "0.0.0.0";
const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const token = process.env.ORCHESTRATOR_TOKEN ?? "";
const repoRoot = resolve(import.meta.dirname, "../../..");

// Precomputed is the default for judging (ARCHITECTURE.md "Modes"). Live mode needs NEXUS_TEAM_CMD,
// e.g. a wrapper around `docker agent run` checked against the installed docker-agent version.
function runner(): TeamRunner {
  const cmd = process.env.NEXUS_TEAM_CMD;
  if (process.env.NEXUS_MODE === "live" && cmd) {
    const [command = "", ...args] = cmd.split(" ").filter(Boolean);
    return new CommandRunner(command, args, repoRoot);
  }
  return new PrecomputedRunner(process.env.NEXUS_PRECOMPUTED_DIR ?? resolve(repoRoot, "data/precomputed"));
}

const api = new HttpApi(apiUrl, token);
const dispatcher = new Dispatcher({ api, runner: runner() });
const app = buildServer(dispatcher);
listen(`${apiUrl.replace(/^http/, "ws")}/events`, token, (e) => dispatcher.onEvent(e), (m) => app.log.warn(m));
app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
