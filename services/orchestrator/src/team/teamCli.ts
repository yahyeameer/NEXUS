// NEXUS_TEAM_CMD entry: reads one request as JSON on stdin, prints JSON on stdout (README "Team runner contract").
//   NEXUS_MODE=live NEXUS_TEAM_CMD="pnpm --silent --dir services/orchestrator team"
// stdout carries only the result; diagnostics go to stderr, which the CommandRunner discards.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fieldNote, observation, type Result } from "@nexus/schemas";
import { rerunAgent, runTeam, type AgentExec } from "./dockerAgentTeam.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

const base = z.object({ runId: z.string().regex(/^[A-Za-z0-9_-]+$/), observation, fieldNotes: z.array(fieldNote), agentIds: z.array(z.string().min(1)) });
const request = z.discriminatedUnion("mode", [
  base.extend({ mode: z.literal("run") }),
  base.extend({ mode: z.literal("rerun"), agentId: z.string().min(1), issues: z.array(z.string()) }),
]);
const savedOutputs = z.array(z.object({ agentId: z.string(), output: z.unknown() }).transform((o) => ({ agentId: o.agentId, output: o.output as unknown })));

/** Command and flags checked against docker-agent v1.161 (`docker agent run --help`), AGENTS.md §8. */
export function dockerAgentArgs(agent: string, env: NodeJS.ProcessEnv, root = repoRoot): { command: string; args: string[] } {
  const [command = "docker", ...pre] = (env.NEXUS_DOCKER_AGENT ?? "docker agent").split(" ").filter(Boolean);
  const args = [...pre, "run", "--exec", "--last", "--json", "--safety", "restricted", "--agent", agent, "--working-dir", root];
  // Flavors are YAML patches in agents/nexus.yaml, e.g. "container" swaps docker: MCP refs for stdio servers.
  for (const f of (env.NEXUS_AGENT_FLAVORS ?? "").split(",").filter(Boolean)) args.push("--flavor", f);
  // Optional model overrides without editing the YAML, e.g. NEXUS_GEMINI_MODEL=gemini-3.8-flash.
  if (env.NEXUS_GEMINI_MODEL) args.push("--model", `google/${env.NEXUS_GEMINI_MODEL}`);
  args.push(path.join(root, "agents/nexus.yaml"), "-");
  return { command, args };
}

const exec: AgentExec = ({ agent, prompt, signal }) =>
  new Promise<Result<string>>((resolve) => {
    const { command, args } = dockerAgentArgs(agent, process.env);
    const child = spawn(command, args, {
      cwd: repoRoot,
      signal,
      // NEXUS_RUN_DIR is inherited, so every agent's NEXUS tool server shares the run's team board.
      env: { ...process.env, TELEMETRY_ENABLED: "false" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.on("error", (e) => resolve({ ok: false, error: e.name === "AbortError" ? "agent aborted" : `agent failed to start: ${e.message}` }));
    child.on("close", (code) => {
      if (code === 0) return resolve({ ok: true, value: out });
      // Logged to stderr only; it can contain provider errors, never keys (they live in env, not argv).
      process.stderr.write(JSON.stringify({ msg: "agent exited", agent, code, stderrTail: err.slice(-500) }) + "\n");
      resolve({ ok: false, error: `agent ${agent} exited with ${code}` });
    });
    child.stdin.end(prompt);
  });

async function main(): Promise<number> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const parsed = request.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
  if (!parsed.success) {
    process.stderr.write("team request is not valid\n");
    return 2;
  }
  const req = parsed.data;
  const controller = new AbortController();
  // The CommandRunner aborts on the team timeout; pass it on so no agent process outlives the run.
  for (const s of ["SIGTERM", "SIGINT"] as const) process.on(s, () => controller.abort());
  const runDir = process.env.NEXUS_RUN_DIR ?? path.join(repoRoot, ".nexus-run", req.runId);
  const saved = path.join(runDir, "team-outputs.json");
  const opts = {
    exec,
    signal: controller.signal,
    concurrency: Number(process.env.NEXUS_TEAM_CONCURRENCY ?? 3),
    log: (msg: string, fields: Record<string, unknown>) => process.stderr.write(JSON.stringify({ msg, ...fields }) + "\n"),
  };

  if (req.mode === "run") {
    const res = await runTeam(req, opts);
    if (!res.ok) {
      opts.log("team run failed", { runId: req.runId, reason: res.error });
      return 1;
    }
    await writeFile(saved, JSON.stringify(res.value.outputs)).catch(() => undefined);
    process.stdout.write(JSON.stringify(res.value));
    return 0;
  }
  const prior = savedOutputs.safeParse(JSON.parse((await readFile(saved, "utf8").catch(() => "[]")) || "[]"));
  const res = await rerunAgent(req, req.agentId, req.issues, opts, prior.success ? prior.data : []);
  if (!res.ok) return 1;
  process.stdout.write(JSON.stringify({ output: res.value }));
  return 0;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`team command crashed: ${String(e)}\n`);
      process.exit(1);
    },
  );
}
