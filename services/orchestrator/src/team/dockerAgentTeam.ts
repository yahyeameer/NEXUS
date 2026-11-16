// Live research with the Docker Agent team (agents/nexus.yaml). This is the command behind
// NEXUS_TEAM_CMD (services/orchestrator/README.md "Team runner contract"): it takes one run or rerun
// request and returns raw agent outputs. It never validates claims itself — every output still goes
// through the SIE in services/api, which stays the hard gate (AGENTS.md rule 2).
import type { FieldNote, Observation, Result } from "@nexus/schemas";

/** Runs one agent of agents/nexus.yaml headlessly and returns its final answer (stdout). */
export type AgentExec = (req: { agent: string; prompt: string; signal?: AbortSignal }) => Promise<Result<string>>;

export interface TeamRequestBase {
  runId: string;
  observation: Observation;
  fieldNotes: FieldNote[];
  /** Chosen by Jev or the fallback policy. The team never adds agents (agents/README.md). */
  agentIds: string[];
}

export interface TeamOptions {
  exec: AgentExec;
  /** Agents run at the same time within one phase (AGENTS.md §10: never all agents at once). */
  concurrency?: number;
  signal?: AbortSignal;
  log?: (msg: string, fields: Record<string, unknown>) => void;
}

export const SYNTHESIS_ID = "22_research_synthesis_specialist";

/**
 * Phase order from agents/prompts/observation_coordinator.md. Agents in one phase are independent
 * and run in parallel; each later phase sees every output so far. Synthesis (phase 6) comes before
 * the integrity advisors, which read its draft.
 */
export const PHASES: readonly (readonly string[])[] = [
  ["26_lola_elevation_researcher", "25_lroc_imagery_researcher", "2_lunar_image_analyst", "3_video_frame_analyst", "8_visual_comparison_researcher"],
  ["11_lunar_geology_researcher", "20_historical_observation_researcher", "12_impact_crater_researcher", "14_lunar_volcanism_researcher"],
  ["33_hypothesis_generator", "34_alternative_explanation_researcher"],
  ["36_contradiction_detection_agent", "38_research_gap_detector"],
  ["37_uncertainty_analyst"],
  [SYNTHESIS_ID],
  ["43_claim_classification_agent", "45_finding_consistency_auditor"],
  ["39_followup_investigation_planner", "46_human_review_escalation_agent"],
];

/** Catalog id ("26_lola_elevation_researcher") to the agent key in agents/nexus.yaml. */
export function yamlAgentName(catalogId: string): string {
  return catalogId.replace(/^\d+_/, "");
}

/** The phases to run for this request: only allowed ids, in coordinator order, empty phases dropped. */
export function planPhases(agentIds: readonly string[]): string[][] {
  const allowed = new Set(agentIds);
  return PHASES.map((p) => p.filter((id) => allowed.has(id))).filter((p) => p.length > 0);
}

/**
 * Pulls the agent's JSON answer out of `docker agent run --exec --last --json` output. With
 * structured_output the answer is the JSON object; some versions wrap it as a JSON string, and a
 * model without structured output may add a code fence. Anything else is "no JSON", which the
 * orchestrator treats as an unparseable AgentOutput (one retry, then the task fails).
 */
export function extractJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  const direct = tryParse(text);
  if (direct !== undefined) return typeof direct === "string" ? (extractJson(direct) ?? direct) : direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) {
    const v = tryParse(fenced[1].trim());
    if (v !== undefined) return v;
  }
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  return start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The task message one agent receives. Inputs are labelled so the agent can tell the scientist's
 * words (focus, never evidence) from other agents' outputs (context, never evidence by themselves).
 */
export function agentPrompt(agentId: string, req: TeamRequestBase, prior: readonly { agentId: string; output: unknown }[], issues?: readonly string[]): string {
  const note = req.fieldNotes[0];
  const parts = [
    `You are ${agentId} in NEXUS run ${req.runId}. Investigate the observation below and answer only with your JSON output.`,
    `Your agentId is "${agentId}" and the observationId is "${req.observation.id}".`,
    "Before you start, read the team board (team_notes_read) for questions addressed to you. When you finish, post a short preview on the board (team_note_post) for the agents that come next.",
    "Use observation_get and site_features for the inputs, and the evidence and terrain tools for anything you cite. Web pages and browser results are leads, not evidence.",
    `Observation:\n${JSON.stringify(req.observation)}`,
  ];
  if (note) parts.push(`Scientist's field note (verbatim, focus only, not evidence):\n${JSON.stringify({ transcript: note.transcript, descriptors: note.descriptors })}`);
  if (prior.length > 0) parts.push(`Outputs from agents that already ran (context; cite only the evidence IDs they cite after checking them with evidence_get):\n${JSON.stringify(prior)}`);
  if (issues && issues.length > 0) parts.push(`Your previous output was rejected. Fix exactly these issues and answer again:\n- ${issues.join("\n- ")}`);
  return parts.join("\n\n");
}

/** Runs the allowed agents phase by phase and returns `{ outputs, synthesis }` (TeamResult). */
export async function runTeam(req: TeamRequestBase, opts: TeamOptions): Promise<Result<{ outputs: { agentId: string; output: unknown }[]; synthesis: unknown }>> {
  const log = opts.log ?? (() => undefined);
  const outputs: { agentId: string; output: unknown }[] = [];
  let synthesis: unknown;
  for (const phase of planPhases(req.agentIds)) {
    if (opts.signal?.aborted) return { ok: false, error: "team run aborted" };
    const prior = [...outputs];
    const results = await mapLimit(phase, opts.concurrency ?? 3, async (agentId) => {
      const res = await opts.exec({ agent: yamlAgentName(agentId), prompt: agentPrompt(agentId, req, withSynthesis(prior, synthesis)), signal: opts.signal });
      return { agentId, res };
    });
    for (const { agentId, res } of results) {
      if (!res.ok) {
        // The coordinator spec continues without a failed agent; the SIE sees fewer outputs, never invented ones.
        log("agent failed", { runId: req.runId, agentId, reason: res.error });
        continue;
      }
      const output = extractJson(res.value);
      if (agentId === SYNTHESIS_ID) synthesis = output;
      else outputs.push({ agentId, output: output ?? res.value });
    }
  }
  if (req.agentIds.includes(SYNTHESIS_ID) && synthesis === undefined) return { ok: false, error: "synthesis produced no output" };
  return { ok: true, value: { outputs, synthesis } };
}

/** Re-runs one agent once with the reasons its output failed (AGENTS.md §8). */
export async function rerunAgent(
  req: TeamRequestBase,
  agentId: string,
  issues: readonly string[],
  opts: TeamOptions,
  /** Outputs saved by the run, so a synthesis rerun sees what it assembles from. */
  prior: readonly { agentId: string; output: unknown }[] = [],
): Promise<Result<unknown>> {
  if (!req.agentIds.includes(agentId)) return { ok: false, error: "agent not allowed in this run" };
  const context = prior.filter((o) => o.agentId !== agentId);
  const res = await opts.exec({ agent: yamlAgentName(agentId), prompt: agentPrompt(agentId, req, context, issues), signal: opts.signal });
  if (!res.ok) return res;
  const output = extractJson(res.value);
  return output === undefined ? { ok: false, error: "rerun printed no JSON" } : { ok: true, value: output };
}

function withSynthesis(prior: { agentId: string; output: unknown }[], synthesis: unknown) {
  return synthesis === undefined ? prior : [...prior, { agentId: SYNTHESIS_ID, output: synthesis }];
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
