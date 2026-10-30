import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import {
  anyNexusEvent,
  eventType,
  fieldNote,
  observation,
  reviewDecision,
  synthesisOutput,
  voiceUtterance,
} from "@nexus/schemas";
import type { EventType, NexusEvent, ScientificFinding } from "@nexus/schemas";
import { evaluateFinding, evaluateScript, validateAttribution, validateNoSelfApproval, validateReference } from "@nexus/sie";
import type { DecisionAdapter } from "@nexus/sie";
import { isSystemPhrase, systemPhrases } from "@nexus/voice";
import type { Principal } from "./auth.js";
import { Auth } from "./auth.js";
import { EventBus, RELAYABLE, XR_EVENTS } from "./eventBus.js";
import type { EvidenceStore } from "./evidenceStore.js";
import { evidenceStore } from "./evidenceStore.js";
import { buildFinding, newId, renderable } from "./findingBuilder.js";
import type { Store } from "./store.js";
import { MemoryStore } from "./store.js";

export interface ServerDeps {
  store: Store;
  evidence: EvidenceStore;
  auth: Auth;
  bus: EventBus;
  decisions?: DecisionAdapter;
  /** CORS allow-list = the XR origin (SECURITY_PRIVACY.md). */
  allowedOrigins?: readonly string[];
}

export function defaultDeps(): ServerDeps {
  return {
    store: new MemoryStore(),
    evidence: evidenceStore([], []),
    auth: new Auth({ pairingCode: "", serviceTokens: {} }),
    bus: new EventBus(),
  };
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

type Need = "human" | "orchestrator" | "voice-gateway" | "any";

export function buildServer(deps: ServerDeps = defaultDeps()) {
  const { store, evidence, auth, bus } = deps;
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { base: { service: "api" } } });
  /** Scripts the SIE approved; the only ones the headset may play (docs/EVENTS.md ordering). */
  const approvedScripts = new Set<string>();

  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && deps.allowedOrigins?.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-headers", "authorization, content-type");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("vary", "origin");
    }
    if (req.method === "OPTIONS") return reply.code(204).send();
    req.principal = auth.resolve(req.headers.authorization);
  });

  /** Returns false (and replies) if the caller may not use this route. */
  function allow(req: FastifyRequest, reply: FastifyReply, ...needs: Need[]): boolean {
    const p = req.principal;
    const ok =
      p !== undefined &&
      needs.some((n) => n === "any" || (n === "human" ? p.kind === "human" : p.kind === "service" && p.service === n));
    if (!ok) void reply.code(p ? 403 : 401).send({ ok: false, error: p ? "forbidden" : "unauthenticated" });
    return ok;
  }

  function bad(reply: FastifyReply, error: unknown, code = 400) {
    return reply.code(code).send({ ok: false, error });
  }

  function human(req: FastifyRequest) {
    const p = req.principal;
    return p?.kind === "human" ? p : undefined;
  }

  app.get("/health", async () => ({ ok: true, service: "api" }));

  // --- Sessions -------------------------------------------------------------------------------
  app.post("/sessions", async (req, reply) => {
    const body = z.object({ pairingCode: z.string(), userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return bad(reply, body.error.issues);
    const s = auth.openSession(body.data.pairingCode, body.data.userId);
    if (!s) return bad(reply, "invalid pairing code", 401);
    return reply.code(201).send({ ok: true, value: s });
  });

  // --- Observations ---------------------------------------------------------------------------
  app.post("/observations", async (req, reply) => {
    if (!allow(req, reply, "human")) return;
    const h = human(req);
    if (!h) return;
    const now = new Date().toISOString();
    const parsed = observation.safeParse({
      ...(isObject(req.body) ? req.body : {}),
      id: newId("OBS"),
      createdBy: h.userId,
      createdAt: now,
    });
    if (!parsed.success) return bad(reply, parsed.error.issues);
    await store.createObservation(parsed.data);
    bus.emit("observation.created", h.sessionId, parsed.data.id, { observation: parsed.data });
    return reply.code(201).send({ ok: true, value: parsed.data });
  });

  app.get<{ Params: { id: string } }>("/observations/:id", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    const o = await store.getObservation(req.params.id);
    return o ? { ok: true, value: o } : bad(reply, "not found", 404);
  });

  app.get<{ Params: { id: string } }>("/observations/:id/field-notes", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    return { ok: true, value: await store.listFieldNotes(req.params.id) };
  });

  app.get<{ Params: { siteId: string } }>("/evidence/:siteId", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    const { siteId } = req.params;
    return {
      ok: true,
      value: {
        items: evidence.items.filter((i) => i.siteId === siteId),
        measurements: evidence.measurements.filter((m) => m.siteId === siteId),
      },
    };
  });

  // --- Utterances -----------------------------------------------------------------------------
  app.post("/utterances", async (req, reply) => {
    if (!allow(req, reply, "human", "voice-gateway")) return;
    const parsed = voiceUtterance.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error.issues);
    const u = parsed.data;
    const h = human(req);
    if (h) {
      // A headset session can only record the scientist's own incoming speech, in its own session.
      if (u.direction !== "in" || u.speaker !== "scientist" || u.sessionId !== h.sessionId) return bad(reply, "humans record their own speech only", 403);
    } else if (u.direction === "out") {
      // AGENTS.md rule 2: outgoing speech needs an approving SIE decision or a fixed system phrase.
      const phraseOk = u.systemPhraseId !== undefined && isSystemPhrase(u.transcript) &&
        systemPhrases[u.systemPhraseId as keyof typeof systemPhrases] === u.transcript;
      const decision = u.sieDecisionId ? await store.getSieDecision(u.sieDecisionId) : undefined;
      if (!phraseOk && decision?.outcome !== "SPEAK_AS_APPROVED") return bad(reply, "outgoing speech lacks an SIE approval", 422);
    }
    await store.createUtterance(u);
    return reply.code(201).send({ ok: true, value: u });
  });

  // --- Field notes ----------------------------------------------------------------------------
  app.post("/field-notes", async (req, reply) => {
    if (!allow(req, reply, "human")) return;
    const h = human(req);
    if (!h) return;
    const parsed = fieldNote.safeParse({
      ...(isObject(req.body) ? req.body : {}),
      id: newId("FN"),
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) return bad(reply, parsed.error.issues);
    const note = parsed.data;
    const obs = await store.getObservation(note.observationId);
    if (!obs) return bad(reply, "observation not found", 404);
    const vr1 = validateReference(note);
    if (!vr1.ok) return reply.code(422).send({ ok: false, error: "clarification_required", issues: vr1.error });
    const utt = await store.getUtterance(note.utteranceId);
    if (!utt || utt.sessionId !== h.sessionId) return bad(reply, "utterance not found", 404);
    const va1 = validateAttribution(note, utt);
    if (!va1.ok) return reply.code(422).send({ ok: false, error: "attribution", issues: va1.error });
    await store.createFieldNote(note);
    bus.emit("fieldnote.created", h.sessionId, note.observationId, { fieldNote: note });
    return reply.code(201).send({ ok: true, value: note });
  });

  // --- Research results → SIE → finding --------------------------------------------------------
  const researchBody = z.object({
    sessionId: z.string().min(1),
    agentOutputs: z.array(z.unknown()),
    synthesis: z.unknown(),
    impact: z.enum(["normal", "high"]).optional(),
    briefingRewriteAttempted: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>("/observations/:id/research", async (req, reply) => {
    if (!allow(req, reply, "orchestrator")) return;
    const body = researchBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error.issues);
    const obs = await store.getObservation(req.params.id);
    if (!obs) return bad(reply, "observation not found", 404);
    // V9 applies to the synthesis output as well: it may not pre-set a decision or status.
    const v9 = validateNoSelfApproval(body.data.synthesis);
    const synthesis = synthesisOutput.safeParse(body.data.synthesis);
    if (!v9.ok || !synthesis.success) {
      return reply.code(422).send({ ok: false, error: "synthesis rejected", issues: v9.ok ? synthesis.error?.issues : v9.error });
    }

    const ctx = evidence.contextFor(obs.siteId);
    const now = new Date().toISOString();
    const evaluation = await evaluateFinding(
      { observation: obs, agentOutputs: body.data.agentOutputs, draft: synthesis.data.findingDraft, impact: body.data.impact },
      ctx,
      deps.decisions,
      now,
    );
    const findingId = newId("FND");
    const voice = evaluateScript(
      {
        scriptId: `${findingId}-briefing`,
        ...synthesis.data.spokenBriefingDraft,
        claims: evaluation.claims,
        uncertainty: synthesis.data.findingDraft.uncertainty.level,
        rewriteAttempted: body.data.briefingRewriteAttempted,
      },
      ctx,
      now,
    );
    const finding = buildFinding({ id: findingId, observation: obs, synthesis: synthesis.data, evaluation, voice, evidence, now });
    await store.appendSieDecision(evaluation.audit);
    await store.appendSieDecision(voice.audit);
    await store.saveFinding(finding);
    publishFinding(body.data.sessionId, finding, evaluation.audit.id);
    publishScript(body.data.sessionId, finding.observationId, `${findingId}-briefing`, voice.decision, voice.audit.id, body.data.briefingRewriteAttempted);
    return reply.code(201).send({
      ok: true,
      value: { finding, sieDecisionId: evaluation.audit.id, voiceDecisionId: voice.audit.id, rejectedOutputs: evaluation.rejectedOutputs },
    });
  });

  function publishFinding(sessionId: string, f: ScientificFinding, sieDecisionId: string) {
    bus.emit("finding.validation.completed", sessionId, f.observationId, { findingId: f.id, decision: f.decision, sieDecisionId });
    // docs/EVENTS.md: review only after ACCEPT_FOR_REVIEW or ESCALATE_TO_SCIENTIST.
    if (f.status === "ready_for_review") {
      bus.emit("finding.review.required", sessionId, f.observationId, { findingId: f.id });
      bus.emit("spatial.annotation.created", sessionId, f.observationId, { findingId: f.id, anchor: f.spatialAnchor });
    }
  }

  function publishScript(sessionId: string, correlationId: string, scriptId: string, decision: string, sieDecisionId: string, rewritten?: boolean) {
    if (decision === "SPEAK_AS_APPROVED") approvedScripts.add(scriptId);
    if (rewritten) bus.emit("speech.script.rewritten", sessionId, correlationId, { scriptId, attempt: 1 });
    bus.emit("speech.script.validated", sessionId, correlationId, { scriptId, voiceDecision: decision, sieDecisionId });
  }

  // --- Scripts (briefing rewrites, grounded Q&A answers) ---------------------------------------
  const scriptBody = z.object({
    sessionId: z.string().min(1),
    scriptId: z.string().min(1),
    findingId: z.string().min(1),
    script: z.string().min(1),
    sentenceEvidence: z.array(z.array(z.string())),
    speakerAgentId: z.string().min(1).optional(),
    userRequestedSpeculation: z.boolean().optional(),
    rewriteAttempted: z.boolean().optional(),
    /** True when this script replaces the finding's stored briefing. */
    isBriefing: z.boolean().optional(),
  });

  app.post("/scripts/validate", async (req, reply) => {
    if (!allow(req, reply, "voice-gateway", "orchestrator")) return;
    const body = scriptBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error.issues);
    const b = body.data;
    const finding = await store.getFinding(b.findingId);
    if (!finding || !renderable(finding)) return bad(reply, "finding not found", 404);
    const obs = await store.getObservation(finding.observationId);
    if (!obs) return bad(reply, "observation not found", 404);
    const v = evaluateScript(
      {
        scriptId: b.scriptId,
        script: b.script,
        sentenceEvidence: b.sentenceEvidence,
        claims: finding.claims,
        uncertainty: finding.uncertainty.level,
        userRequestedSpeculation: b.userRequestedSpeculation,
        rewriteAttempted: b.rewriteAttempted,
      },
      evidence.contextFor(obs.siteId),
    );
    await store.appendSieDecision(v.audit);
    if (b.isBriefing && finding.status !== "reviewed") {
      await store.saveFinding({
        ...finding,
        spokenBriefing: {
          script: b.script,
          sentenceEvidence: b.sentenceEvidence,
          voiceDecision: v.decision,
          speakerAgentId: b.speakerAgentId ?? finding.spokenBriefing?.speakerAgentId ?? "narrator",
        },
        updatedAt: new Date().toISOString(),
      });
    }
    publishScript(b.sessionId, finding.observationId, b.scriptId, v.decision, v.audit.id, b.rewriteAttempted);
    return { ok: true, value: { decision: v.decision, sieDecisionId: v.audit.id, speechRate: v.speechRate, issues: v.issues } };
  });

  // --- Findings -------------------------------------------------------------------------------
  app.get<{ Querystring: { observationId?: string } }>("/findings", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    const all = await store.listFindings({ observationId: req.query.observationId });
    return { ok: true, value: req.principal?.kind === "human" ? all.filter(renderable) : all };
  });

  app.get<{ Params: { id: string } }>("/findings/:id", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    const f = await store.getFinding(req.params.id);
    if (!f || (req.principal?.kind === "human" && !renderable(f))) return bad(reply, "not found", 404);
    return { ok: true, value: f };
  });

  // --- Review (human only, AGENTS.md rule 8) ---------------------------------------------------
  const reviewBody = z.object({
    decision: reviewDecision,
    rationaleText: z.string().min(1).optional(),
    rationaleUtteranceId: z.string().min(1).optional(),
  });

  app.post<{ Params: { id: string } }>("/findings/:id/review", async (req, reply) => {
    if (!allow(req, reply, "human")) return;
    const h = human(req);
    if (!h) return;
    const body = reviewBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error.issues);
    const { decision, rationaleText, rationaleUtteranceId } = body.data;
    if (rationaleUtteranceId) {
      // VA1: a spoken rationale must be the scientist's own words, verbatim, from this session.
      const utt = await store.getUtterance(rationaleUtteranceId);
      if (!utt || utt.sessionId !== h.sessionId || utt.speaker !== "scientist") return bad(reply, "rationale utterance not found", 404);
      if (rationaleText !== undefined && !utt.transcript.includes(rationaleText)) return bad(reply, "rationale is not verbatim", 422);
    }
    const updated = await store.applyReview({
      findingId: req.params.id,
      decision,
      rationaleText,
      rationaleUtteranceId,
      reviewerId: h.userId,
      sessionId: h.sessionId,
      reviewedAt: new Date().toISOString(),
    });
    if (!updated) return bad(reply, "finding is not awaiting review", 409);
    const type: EventType = decision === "approved" ? "finding.approved" : decision === "rejected" ? "finding.rejected" : "finding.inconclusive";
    bus.emit(type, h.sessionId, updated.observationId, { findingId: updated.id, reviewerId: h.userId });
    if (rationaleText || rationaleUtteranceId) {
      bus.emit("review.rationale.recorded", h.sessionId, updated.observationId, { findingId: updated.id, utteranceId: rationaleUtteranceId });
    }
    return { ok: true, value: updated };
  });

  app.get("/logbook", async (req, reply) => {
    if (!allow(req, reply, "human")) return;
    const h = human(req);
    if (!h) return;
    const reviews = await store.listReviews(h.sessionId);
    const entries = [];
    for (const r of reviews) entries.push({ review: r, finding: await store.getFinding(r.findingId) });
    return { ok: true, value: entries };
  });

  // --- Events ---------------------------------------------------------------------------------
  const relayBody = z.object({
    type: eventType,
    sessionId: z.string().min(1).optional(),
    correlationId: z.string().min(1),
    payload: z.unknown(),
  });

  app.post("/events", async (req, reply) => {
    if (!allow(req, reply, "any")) return;
    const body = relayBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error.issues);
    const p = req.principal;
    if (!p) return;
    const allowed = p.kind === "human" ? XR_EVENTS : RELAYABLE[p.service];
    if (!allowed.includes(body.data.type)) return bad(reply, `${body.data.type} cannot be emitted by this caller`, 403);
    const sessionId = p.kind === "human" ? p.sessionId : body.data.sessionId;
    if (!sessionId) return bad(reply, "sessionId required");
    if (body.data.type === "speech.playback.started") {
      const pl = isObject(body.data.payload) ? body.data.payload : {};
      const scriptOk = typeof pl.scriptId === "string" && approvedScripts.has(pl.scriptId);
      const phraseOk = typeof pl.systemPhraseId === "string" && pl.systemPhraseId in systemPhrases;
      if (!scriptOk && !phraseOk) return bad(reply, "script was not approved by the SIE", 422);
    }
    const e = bus.emit(body.data.type, sessionId, body.data.correlationId, body.data.payload);
    return reply.code(201).send({ ok: true, value: { id: e.id } });
  });

  void app.register(websocket);
  void app.register(async (scope) => {
    scope.get("/events", { websocket: true }, (socket) => {
      let unsubscribe: (() => void) | undefined;
      // Browsers cannot set headers on a WebSocket, so the first message authenticates.
      socket.once("message", (data: Buffer) => {
        const msg = z.object({ type: z.literal("auth"), token: z.string(), after: z.string().optional() }).safeParse(safeJson(data.toString()));
        const p = msg.success ? auth.resolve(msg.data.token) : undefined;
        if (!msg.success || !p) {
          socket.close(4401, "unauthenticated");
          return;
        }
        const send = (e: NexusEvent) => socket.send(JSON.stringify(anyNexusEvent.parse(e)));
        const sees = (e: NexusEvent) => p.kind === "service" || e.sessionId === p.sessionId;
        if (p.kind === "human") for (const e of bus.since(p.sessionId, msg.data.after)) send(e);
        unsubscribe = bus.subscribe((e) => {
          if (sees(e)) send(e);
        });
        socket.send(JSON.stringify({ type: "auth.ok" }));
      });
      socket.on("close", () => unsubscribe?.());
    });
  });

  return app;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
