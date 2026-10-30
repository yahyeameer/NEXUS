// One research run per observation (ARCHITECTURE.md request flow steps 6–10).
import { randomUUID } from "node:crypto";
import type { Observation, Result, ScientificFinding } from "@nexus/schemas";
import { decide, selectSpecialistsFallback, validateNoSelfApproval, validateSchema } from "@nexus/sie";
import type { DecisionAdapter } from "@nexus/sie";
import type { Api } from "./apiClient.js";
import type { TeamRunner, TeamTask } from "./teamRunner.js";

/** MVP research team (AGENT_CATALOG.md, agents/README.md): the only ids routing may choose from. */
export const MVP_TEAM = [
  "26_lola_elevation_researcher",
  "25_lroc_imagery_researcher",
  "2_lunar_image_analyst",
  "3_video_frame_analyst",
  "11_lunar_geology_researcher",
  "12_impact_crater_researcher",
  "14_lunar_volcanism_researcher",
  "20_historical_observation_researcher",
  "33_hypothesis_generator",
  "34_alternative_explanation_researcher",
  "36_contradiction_detection_agent",
  "37_uncertainty_analyst",
  "22_research_synthesis_specialist",
] as const;

const SYNTHESIS = "22_research_synthesis_specialist";

/** SECURITY_PRIVACY.md: total team run timeout 3 min in live mode. */
export const TEAM_TIMEOUT_MS = 180_000;

export interface RunDeps {
  api: Api;
  runner: TeamRunner;
  decisions?: DecisionAdapter;
  timeoutMs?: number;
  log?: (msg: string, fields: Record<string, unknown>) => void;
}

export type RunOutcome = Result<ScientificFinding, string>;

export async function runResearch(observationId: string, sessionId: string, deps: RunDeps): Promise<RunOutcome> {
  const { api, runner } = deps;
  const log = deps.log ?? (() => undefined);
  const obs = await api.getObservation(observationId);
  if (!obs.ok) return { ok: false, error: "observation not found" };
  const notes = await api.listFieldNotes(observationId);
  const fieldNotes = notes.ok ? notes.value : [];

  const agentIds = await chooseSpecialists(obs.value, fieldNotes.flatMap((n) => n.descriptors), deps.decisions);
  // Synthesis always runs: it assembles, it does not research.
  if (!agentIds.includes(SYNTHESIS)) agentIds.push(SYNTHESIS);
  await api.emit("research.started", sessionId, observationId, { observationId, agentIds });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TEAM_TIMEOUT_MS);
  const task: TeamTask = { runId: `RUN-${randomUUID()}`, observation: obs.value, fieldNotes, agentIds, signal: controller.signal };
  try {
    const taskIds = new Map(agentIds.map((a) => [a, `TASK-${randomUUID()}`]));
    for (const agentId of agentIds) await api.emit("agent.task.dispatched", sessionId, observationId, { agentId, taskId: taskIds.get(agentId) });

    const team = await runner.run(task);
    if (!team.ok) {
      log("team run failed", { observationId, reason: team.error });
      for (const agentId of agentIds) await api.emit("agent.task.failed", sessionId, observationId, { agentId, taskId: taskIds.get(agentId), reason: team.error, retry: false });
      return { ok: false, error: team.error };
    }

    // AGENTS.md §8: output that fails parsing is retried once, then the task fails.
    // Self-approval (V9) is not retried: the SIE rejects it outright.
    const outputs: unknown[] = [];
    for (const { agentId, output } of team.value.outputs) {
      if (!agentIds.includes(agentId)) continue;
      let current = output;
      let parsed = validateNoSelfApproval(current).ok ? validateSchema(current) : undefined;
      if (parsed && !parsed.ok) {
        const retry = await runner.rerun(task, agentId, parsed.error.map((i) => i.message));
        await api.emit("agent.task.failed", sessionId, observationId, { agentId, taskId: taskIds.get(agentId), reason: "invalid AgentOutput", retry: true });
        if (retry.ok) {
          current = retry.value;
          parsed = validateNoSelfApproval(current).ok ? validateSchema(current) : undefined;
        }
      }
      const okNow = parsed?.ok === true;
      await api.emit(okNow ? "agent.task.completed" : "agent.task.failed", sessionId, observationId, {
        agentId,
        taskId: taskIds.get(agentId),
        ...(okNow ? { outputRef: taskIds.get(agentId) } : { reason: parsed ? "invalid AgentOutput after retry" : "self-approval", retry: false }),
      });
      // Failed outputs still go to the SIE so they appear in its audit trail.
      outputs.push(current);
    }
    const cited = new Set(outputs.flatMap(citedIds));
    if (cited.size > 0) await api.emit("evidence.retrieved", sessionId, observationId, { evidenceIds: [...cited] });

    let synthesis = team.value.synthesis;
    let res = await api.submitResearch(observationId, { sessionId, agentOutputs: outputs, synthesis });
    if (!res.ok && res.error.status === 422) {
      const retry = await runner.rerun(task, SYNTHESIS, ["synthesis output rejected by the SIE"]);
      if (retry.ok) {
        synthesis = retry.value;
        res = await api.submitResearch(observationId, { sessionId, agentOutputs: outputs, synthesis });
      }
    }
    if (!res.ok) return { ok: false, error: `research rejected (${res.error.status})` };
    const finding = res.value.finding;
    await api.emit("finding.generated", sessionId, observationId, { findingId: finding.id });

    // VOICE.md §5: one automatic rewrite of the briefing, then card only.
    if (finding.spokenBriefing?.voiceDecision === "REWRITE_SCRIPT") {
      const rewrite = await runner.rerun(task, SYNTHESIS, ["spoken briefing failed the Epistemic Voice Policy; rewrite the script only"]);
      const draft = rewrite.ok ? briefingOf(rewrite.value) : undefined;
      if (draft) {
        await api.validateBriefing({ sessionId, scriptId: `${finding.id}-briefing`, findingId: finding.id, ...draft });
      }
    }
    return { ok: true, value: finding };
  } finally {
    clearTimeout(timer);
  }
}

async function chooseSpecialists(obs: Observation, descriptors: string[], decisions?: DecisionAdapter): Promise<string[]> {
  const featureKind = kindOf(obs.featureId);
  const question = { observationSource: obs.source, featureKind, descriptors, allowed: [...MVP_TEAM] };
  const picked = await decide(
    decisions && (() => decisions.selectSpecialists(question)),
    () => selectSpecialistsFallback(question),
    (ids) => ids.length > 0 && ids.every((id) => (MVP_TEAM as readonly string[]).includes(id)),
  );
  const ids = [...picked.value];
  // agents/README.md: the frame analyst only runs for video observations.
  if (obs.frameRef && !ids.includes("3_video_frame_analyst")) ids.unshift("3_video_frame_analyst");
  return ids;
}

/** Feature ids follow `<NAME>_<KIND>` for the demo sites (data/terrain/<site>/features.json). */
function kindOf(featureId: string | undefined): "crater" | "rille" | "slope" | "point" | undefined {
  if (!featureId) return undefined;
  if (/CRATER/.test(featureId)) return "crater";
  if (/RILLE/.test(featureId)) return "rille";
  if (/SLOPE|DELTA|MONS/.test(featureId)) return "slope";
  return "point";
}

function citedIds(output: unknown): string[] {
  if (output === null || typeof output !== "object" || !("claims" in output) || !Array.isArray(output.claims)) return [];
  return output.claims.flatMap((c: unknown) =>
    c !== null && typeof c === "object" && "evidenceIds" in c && Array.isArray(c.evidenceIds) ? c.evidenceIds.filter((x: unknown): x is string => typeof x === "string") : [],
  );
}

function briefingOf(v: unknown): { script: string; sentenceEvidence: string[][]; speakerAgentId: string } | undefined {
  if (v === null || typeof v !== "object" || !("spokenBriefingDraft" in v)) return undefined;
  const b = v.spokenBriefingDraft;
  if (b === null || typeof b !== "object") return undefined;
  const { script, sentenceEvidence, speakerAgentId } = b as Record<string, unknown>;
  if (typeof script !== "string" || typeof speakerAgentId !== "string" || !Array.isArray(sentenceEvidence)) return undefined;
  if (!sentenceEvidence.every((s): s is string[] => Array.isArray(s) && s.every((x) => typeof x === "string"))) return undefined;
  return { script, sentenceEvidence, speakerAgentId };
}
