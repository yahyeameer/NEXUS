// How the orchestrator reaches the Docker Agent team (agents/nexus.yaml). The runner is a seam:
// CommandRunner bridges to a local command that drives docker-agent; PrecomputedRunner replays stored,
// curated outputs for the judged demo (AGENTS.md §6 demo safety). Both feed the same SIE path.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { FieldNote, Observation, Result } from "@nexus/schemas";

export interface TeamTask {
  observation: Observation;
  fieldNotes: FieldNote[];
  /** Specialists chosen by Jev or the fallback policy; the runner must not add others. */
  agentIds: string[];
  signal: AbortSignal;
}

export const teamResult = z.object({
  outputs: z.array(z.object({ agentId: z.string().min(1), output: z.unknown() })),
  synthesis: z.unknown(),
});
export type TeamResult = z.infer<typeof teamResult>;

export interface TeamRunner {
  run(task: TeamTask): Promise<Result<TeamResult>>;
  /** Re-run one agent once, with the reasons its previous output failed (AGENTS.md §8). */
  rerun(task: TeamTask, agentId: string, issues: readonly string[]): Promise<Result<unknown>>;
}

/**
 * Runs `command` (no shell) with the task as JSON on stdin and expects JSON on stdout:
 * `{ "mode": "run", ... }` → TeamResult; `{ "mode": "rerun", "agentId", "issues", ... }` → `{ "output": … }`.
 * The command is configured from the backend environment so docker-agent flags are checked against the
 * installed version rather than hard-coded here (AGENTS.md §8).
 */
export class CommandRunner implements TeamRunner {
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly cwd: string,
  ) {}

  async run(task: TeamTask): Promise<Result<TeamResult>> {
    const out = await this.exec({ mode: "run", ...payload(task) }, task.signal);
    if (!out.ok) return out;
    const parsed = teamResult.safeParse(out.value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "team output is not a TeamResult" };
  }

  async rerun(task: TeamTask, agentId: string, issues: readonly string[]): Promise<Result<unknown>> {
    const out = await this.exec({ mode: "rerun", agentId, issues, ...payload(task) }, task.signal);
    if (!out.ok) return out;
    const parsed = z.object({ output: z.unknown() }).safeParse(out.value);
    return parsed.success ? { ok: true, value: parsed.data.output } : { ok: false, error: "rerun output missing" };
  }

  private exec(input: unknown, signal: AbortSignal): Promise<Result<unknown>> {
    return new Promise((resolve) => {
      const child = spawn(this.command, this.args, { cwd: this.cwd, signal, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      // stderr is drained but not logged: it may echo prompts or provider errors.
      child.stderr.resume();
      child.on("error", (e) => resolve({ ok: false, error: e.name === "AbortError" ? "team run timed out" : "team command failed to start" }));
      child.on("close", (code) => {
        if (code !== 0) return resolve({ ok: false, error: `team command exited with ${code}` });
        try {
          resolve({ ok: true, value: JSON.parse(stdout) as unknown });
        } catch {
          resolve({ ok: false, error: "team command printed invalid JSON" });
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
}

function payload(task: TeamTask) {
  return { observation: task.observation, fieldNotes: task.fieldNotes, agentIds: task.agentIds };
}

/**
 * Replays `data/precomputed/<SITE_ID>/<FEATURE_ID>.json` (a TeamResult). The stored outputs still go through
 * the SIE in services/api, so precomputed mode cannot bypass validation.
 */
export class PrecomputedRunner implements TeamRunner {
  constructor(private readonly dir: string) {}

  async run(task: TeamTask): Promise<Result<TeamResult>> {
    const { siteId, featureId } = task.observation;
    if (!featureId || !/^[A-Z0-9_]+$/.test(siteId) || !/^[A-Z0-9_]+$/.test(featureId)) {
      return { ok: false, error: "no precomputed research for this observation" };
    }
    const raw = await readFile(join(this.dir, siteId, `${featureId}.json`), "utf8").catch(() => undefined);
    if (raw === undefined) return { ok: false, error: "no precomputed research for this feature" };
    const parsed = teamResult.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ok: false, error: "precomputed file is not a TeamResult" };
    // Stored outputs were recorded for a template observation; bind them to this one.
    const bind = (o: unknown) => (o !== null && typeof o === "object" && "observationId" in o ? { ...o, observationId: task.observation.id } : o);
    const allowed = new Set(task.agentIds);
    return {
      ok: true,
      value: {
        outputs: parsed.data.outputs.filter((o) => allowed.has(o.agentId)).map((o) => ({ agentId: o.agentId, output: bind(o.output) })),
        synthesis: parsed.data.synthesis,
      },
    };
  }

  async rerun(): Promise<Result<unknown>> {
    return { ok: false, error: "precomputed outputs cannot be re-run" };
  }
}
