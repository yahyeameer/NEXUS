// The headset app: one tabletop site at a time, a main panel (selection → research → finding card → review),
// a captions strip and a wrist menu. Every action is reachable by poke or ray + pinch; voice only shortcuts them
// (AGENTS.md rule 1, INTERACTION.md §1 parity table).
import type { EvidenceItem, MeasurementRecord, NexusEvent, ReviewDecision, ScientificFinding, TerrainFeature, VoiceServerMessage } from "@nexus/schemas";
import type { Command } from "@nexus/voice";
import { Vector3 } from "three";
import { PushToTalkMic } from "./audio/mic.js";
import { Speaker } from "./audio/speaker.js";
import type { Utterance } from "./audio/speaker.js";
import { SITES } from "./config.js";
import { HandInput } from "./input/hands.js";
import { ApiClient } from "./net/api.js";
import type { LogbookEntry } from "./net/api.js";
import { VoiceClient } from "./net/voice.js";
import { zoomedScale } from "./input/manipulate.js";
import { Diorama } from "./scene/diorama.js";
import { pickFeature } from "./scene/featurePick.js";
import { AgentOrbs } from "./scene/orbs.js";
import { sceneToTile } from "./scene/tabletop.js";
import { loadSite, RING_COLORS } from "./scene/terrain.js";
import type { LoadedSite } from "./scene/terrain.js";
import type { World } from "./scene/world.js";
import { agentName, cardModel, REASON_CHIPS } from "./ui/findingView.js";
import type { RingState } from "./ui/findingView.js";
import type { ButtonSpec, PanelContent, PanelLine } from "./ui/panel.js";
import { Panel } from "./ui/panel.js";

type Screen = "pair" | "welcome" | "idle" | "selected" | "researching" | "finding" | "reason" | "sources" | "evidence" | "logbook" | "clarify";

export interface AppOptions {
  emulated: boolean;
  /** Mouse-and-keyboard emulator: the wrist menu stays docked, since there is no palm to turn up. */
  desktop?: boolean;
  /** Emulator only: what the desktop user typed as "speech" for the current push-to-talk. */
  simulatedTranscript?: () => string | undefined;
}

/** Snapshot for the emulator's test hooks and the desktop status line. */
export interface AppState {
  screen: Screen;
  siteId?: string;
  selectedFeatureId?: string;
  paired: boolean;
  pttActive: boolean;
  micOpen: boolean;
  voiceConnected: boolean;
  findings: Record<string, { id: string; status: string }>;
  captions: string[];
  lastCommand?: string;
  view: { yaw: number; scale: number };
  descriptors: string[];
  evidenceOpen?: string;
  orbs: number;
}

/** Ray hits within this many tile metres of a feature footprint select it. */
const PICK_TOLERANCE_M = 120;
const POINTER_INTERVAL_MS = 33;
const USER_ID = "scientist";

/** Hands-only descriptor chips per feature kind (INTERACTION.md "Record observation"). Plain observational words. */
const DESCRIPTOR_CHIPS: Record<TerrainFeature["kind"], string[]> = {
  rille: ["Sinuous", "Steep walls", "Boulders on walls", "Flat floor"],
  crater: ["Raised rim", "Boulders on rim", "Smooth floor", "Subdued rim"],
  slope: ["Boulders", "Smooth surface", "Layering", "Tracks or trails"],
  point: ["Boulder", "Bright patch", "Dark patch", "Small crater"],
};

export class NexusApp {
  readonly main = new Panel("main", 0.4, 0.42);
  readonly captions = new Panel("captions", 0.4, 0.07);
  readonly wrist = new Panel("wrist", 0.18, 0.31);
  /** Evidence window, opened from a finding card (INTERACTION.md "Open evidence: poke evidence chip"). */
  readonly evidence = new Panel("evidence", 0.34, 0.4);
  readonly diorama = new Diorama();
  private readonly orbs = new AgentOrbs();
  readonly api = new ApiClient();
  readonly input: HandInput;
  private readonly voice: VoiceClient;
  private readonly speaker: Speaker;
  private readonly mic = new PushToTalkMic();

  private screen: Screen = "pair";
  private site?: LoadedSite;
  private selected?: string;
  private code = "";
  private notice?: string;
  private readonly findings = new Map<string, ScientificFinding>();
  private readonly observationFeature = new Map<string, string>();
  private readonly ringState = new Map<string, RingState>();
  private progress: string[] = [];
  private logbookEntries: LogbookEntry[] = [];
  private clarify?: Extract<VoiceServerMessage, { type: "clarify" }>;
  private readonly captionLog: string[] = [];
  private ptt?: { startedAt: number; lastSample: number; samples: { tMs: number; rayFeatureId?: string; rayPoint?: { x: number; y: number; z: number }; onUi: boolean; headPosition: { x: number; y: number; z: number }; headDirection: { x: number; y: number; z: number } }[]; micOpen: boolean };
  private lastCommand?: string;
  /** Descriptor chips poked on the selection screen; recorded with the observation as the scientist's words. */
  private descriptors = new Set<string>();
  private evidenceData?: { siteId: string; items: EvidenceItem[]; measurements: MeasurementRecord[] };
  private evidenceOpen?: string;
  private readonly media = new Map<string, HTMLImageElement>();
  private wristFacingSet = false;
  private readonly wristPose = { position: new Vector3(), palmNormal: new Vector3() };
  private readonly head = new Vector3();
  private readonly headDir = new Vector3();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly world: World,
    private readonly opts: AppOptions,
  ) {
    const { scene } = world;
    // Main panel to the front right, about 60 cm away, top edge below eye level, turned toward the seated user (INTERACTION.md §3).
    this.main.mesh.position.set(0.38, 1.0, -0.42);
    this.main.mesh.lookAt(0, 1.2, 0);
    this.captions.mesh.position.set(0.38, 0.7, -0.42);
    this.captions.mesh.lookAt(0, 1.2, 0);
    // Evidence opens to the front left, mirroring the card, so both can be read side by side.
    this.evidence.mesh.position.set(-0.38, 1.04, -0.45);
    this.evidence.mesh.lookAt(0, 1.2, 0);
    this.evidence.mesh.visible = false;
    scene.add(this.main.mesh, this.captions.mesh, this.wrist.mesh, this.evidence.mesh, this.diorama.pivot);

    this.input = new HandInput(world.renderer, scene, {
      panels: () => [this.main, this.captions, this.wrist, this.evidence],
      terrain: () => this.site?.terrain,
      button: (panel, id, edge, via) => this.onButton(panel, id, edge, via),
      terrainSelect: (p) => this.onTerrainSelect(p),
      pivot: () => this.diorama.pivotPoint,
      manipulate: (m) => {
        // A mouse drag moves the emulated hand less than a real arm would, so desktop mode turns the terrain faster.
        if (m.yaw !== undefined) this.diorama.rotateBy(m.yaw * (opts.desktop ? 1.6 : 1));
        if (m.zoom) this.diorama.setScale(zoomedScale(this.diorama.scale, m.zoom.fromM, m.zoom.toM));
      },
    });
    this.voice = new VoiceClient((m) => this.onVoice(m));
    this.speaker = new Speaker({
      caption: (speaker, text) => this.caption(speaker, text),
      playback: (kind, u) => {
        this.orbs.speaker(kind === "started" ? u.speaker : undefined);
        this.reportPlayback(kind, u);
      },
    });
    this.input.setDesktop(opts.desktop === true);
    this.render();
    this.renderCaptions();
    this.renderWrist();
  }

  /** Mouse and keyboard shortcuts press the same buttons a hand would, so nothing is desktop-only. */
  press(id: string, edge: "press" | "release" = "press"): boolean {
    for (const panel of [this.main, this.captions, this.wrist, this.evidence]) {
      if (!panel.mesh.visible || !panel.buttons.some((b) => b.id === id)) continue;
      this.onButton(panel, id, edge, "ray");
      return true;
    }
    return false;
  }

  /** Smooth zoom for the mouse wheel; the wrist menu's Zoom buttons take fixed steps. */
  zoomBy(factor: number): void {
    this.diorama.setScale(this.diorama.scale * factor);
    this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  state(): AppState {
    return {
      screen: this.screen,
      siteId: this.site?.siteId,
      selectedFeatureId: this.selected,
      paired: this.api.session !== undefined,
      pttActive: this.ptt !== undefined,
      micOpen: this.ptt?.micOpen ?? false,
      voiceConnected: this.voice.connected,
      findings: Object.fromEntries([...this.findings].map(([k, f]) => [k, { id: f.id, status: f.status }])),
      captions: [...this.captionLog],
      lastCommand: this.lastCommand,
      view: { yaw: this.diorama.yaw, scale: this.diorama.scale },
      descriptors: [...this.descriptors],
      evidenceOpen: this.evidenceOpen,
      orbs: this.orbs.count,
    };
  }

  /** Every visible button, in world space: the emulator's target resolver and e2e tests drive the hands to these. */
  targets(): { name: string; position: Vector3; normal: Vector3; size: Vector3 }[] {
    const out: { name: string; position: Vector3; normal: Vector3; size: Vector3 }[] = [];
    for (const panel of [this.main, this.captions, this.wrist, this.evidence]) {
      if (!panel.mesh.visible) continue;
      for (const b of panel.buttons) {
        const w = panel.buttonWorld(b.id);
        if (w) out.push({ name: `${panel.name}/${b.id}`, ...w });
      }
    }
    for (const [id, a] of this.site?.anchors ?? []) out.push({ name: `feature/${id}`, position: this.diorama.toWorld(a), normal: new Vector3(0, 1, 0), size: new Vector3(0.05, 0.01, 0.05) });
    return out;
  }

  async loadSite(siteId: string): Promise<void> {
    const next = await loadSite(siteId);
    this.diorama.setContent(next.group, this.site?.group);
    next.group.add(this.orbs.group);
    this.orbs.clear();
    this.site = next;
    this.selected = undefined;
    this.descriptors.clear();
    this.closeEvidence();
    for (const f of next.features) this.paintRing(f.id);
    if (this.screen !== "pair" && this.screen !== "welcome") this.go("idle");
    this.sendContext();
    this.renderWrist();
    this.changed();
  }

  /** Per-frame update from the render loop. */
  frame(now: number): void {
    this.input.update();
    this.placeWristMenu();
    this.orbs.update(now);
    if (this.ptt && now - this.ptt.lastSample >= POINTER_INTERVAL_MS) {
      this.ptt.lastSample = now;
      this.samplePointer(now);
    }
    if (now - this.hoverCheckedAt >= 100) {
      this.hoverCheckedAt = now;
      this.hoverFeature = this.featureUnderRay();
    }
    // Researching rings pulse (INTERACTION.md §4); idle rings breathe gently and the hovered one swells so it is
    // clear what a pinch or click will pick.
    if (this.site) {
      for (const [id, ring] of this.site.markers) {
        const pulsing = this.ringState.get(id) === "researching";
        const hovered = id === this.hoverFeature;
        ring.material.opacity = pulsing ? 0.5 + 0.4 * Math.sin(now / 250) : hovered ? 1 : 0.72 + 0.16 * Math.sin(now / 600 + ring.id);
        const k = hovered ? 1.35 : 1;
        ring.scale.set(k, k, k);
      }
    }
  }

  // --- Buttons ------------------------------------------------------------------------------------

  private onButton(panel: Panel, id: string, edge: "press" | "release", via: "poke" | "ray"): void {
    if (id === "wrist:ptt") {
      if (edge === "press") void this.startTalking();
      else void this.stopTalking();
      return;
    }
    if (edge !== "press") return;
    tick(via);
    if (panel.handlePaging(id)) return;
    const [scope, arg = ""] = splitId(id);
    switch (scope) {
      case "pair":
        return void this.onKeypad(arg);
      case "onboard":
        if (arg === "start") {
          this.speaker.phrase("welcome");
          this.speaker.phrase("onboardingHint");
        }
        return this.go("idle");
      case "sel":
        if (arg === "investigate") return void this.investigate();
        this.selected = undefined;
        this.repaintRings();
        return this.go("idle");
      case "card":
        return void this.onCard(arg);
      case "reason":
        return void this.onReason(arg);
      case "clarify":
        return this.onClarify(arg);
      case "site":
        return void this.loadSite(arg);
      case "wrist":
        if (arg === "logbook") return void this.showLogbook();
        if (arg === "stop") return this.speaker.stop();
        return;
      case "view":
        if (arg === "reset") this.diorama.reset();
        else if (arg === "rotate_left" || arg === "rotate_right" || arg === "zoom_in" || arg === "zoom_out") this.diorama.step(arg);
        return this.changed();
      case "desc":
        if (this.descriptors.has(arg)) this.descriptors.delete(arg);
        else this.descriptors.add(arg);
        return this.render();
      case "ev":
        return void this.openEvidence(arg);
      case "evwin":
        return this.closeEvidence();
      case "back":
        return this.go(this.selected && this.findings.has(this.selected) ? "finding" : "idle");
    }
  }

  private async onKeypad(key: string): Promise<void> {
    if (key === "del") this.code = this.code.slice(0, -1);
    else if (key === "go") {
      const res = await this.api.pair(this.code, USER_ID);
      this.code = "";
      if (!res.ok) {
        this.notice = res.error === "api unreachable" ? "Cannot reach the NEXUS service." : "That pairing code did not work.";
        return this.render();
      }
      this.notice = undefined;
      this.voice.connect(res.value.token, res.value.sessionId);
      this.api.events((e) => void this.onEvent(e));
      await this.restoreFindings();
      return this.go("welcome");
    } else if (/^\d$/.test(key) && this.code.length < 8) this.code += key;
    this.render();
  }

  private async onCard(action: string): Promise<void> {
    const f = this.selected ? this.findings.get(this.selected) : undefined;
    if (!f) return;
    switch (action) {
      case "approve":
        return this.review(f, "approved");
      case "reject":
      case "inconclusive":
        this.pendingDecision = action === "reject" ? "rejected" : "inconclusive";
        return this.go("reason");
      case "hear":
        return this.speaker.speaking ? this.speaker.stop() : this.readBriefing(f);
      case "sources":
        return this.go("sources");
      case "evidence":
        return this.go("evidence");
      case "close":
        this.selected = undefined;
        this.repaintRings();
        return this.go("idle");
    }
  }

  private pendingDecision?: ReviewDecision;

  private async onReason(arg: string): Promise<void> {
    const f = this.selected ? this.findings.get(this.selected) : undefined;
    const decision = this.pendingDecision;
    if (arg === "back" || !f || !decision) return this.go("finding");
    const chip = arg === "none" ? undefined : REASON_CHIPS[Number(arg)];
    await this.review(f, decision, chip);
  }

  private async review(f: ScientificFinding, decision: ReviewDecision, rationale?: string): Promise<void> {
    this.pendingDecision = undefined;
    const res = await this.api.review(f.id, decision, rationale);
    if (!res.ok) {
      this.notice = "The review was not saved. Please try again.";
      return this.go("finding");
    }
    this.notice = undefined;
    this.storeFinding(res.value);
    this.go("finding");
  }

  private onClarify(featureId: string): void {
    if (featureId !== "cancel") this.voice.send({ type: "clarify.choose", featureId });
    this.clarify = undefined;
    this.go(this.selected && this.findings.has(this.selected) ? "finding" : "idle");
  }

  // --- Selection and research ---------------------------------------------------------------------

  private hoverFeature?: string;
  private hoverCheckedAt = 0;

  private featureUnderRay(): string | undefined {
    const site = this.site;
    const point = this.input.rayHit("right").point;
    if (!site || !point || this.screen === "pair" || this.screen === "welcome") return undefined;
    return pickFeature(site.features, sceneToTile(site.frame, this.diorama.toLayout(point)), PICK_TOLERANCE_M)?.id;
  }

  private onTerrainSelect(point: Vector3): void {
    const site = this.site;
    if (!site || this.screen === "pair" || this.screen === "welcome") return;
    const tile = sceneToTile(site.frame, this.diorama.toLayout(point));
    const f = pickFeature(site.features, tile, PICK_TOLERANCE_M);
    if (!f) return;
    this.selectFeature(f.id);
  }

  private selectFeature(featureId: string): void {
    if (this.selected !== featureId) this.descriptors.clear();
    this.selected = featureId;
    this.repaintRings();
    this.go(this.findings.has(featureId) ? "finding" : this.isResearching(featureId) ? "researching" : "selected");
    this.sendContext();
  }

  private async investigate(): Promise<void> {
    const site = this.site;
    const featureId = this.selected;
    const anchor = featureId ? site?.anchors.get(featureId) : undefined;
    if (!site || !featureId || !anchor) return;
    const local = sceneToTile(site.frame, anchor);
    // Chips are the scientist's own words, recorded as such; agents may not turn them into claims (SIE VA1 spirit).
    const description = this.descriptors.size ? `Scientist noted: ${[...this.descriptors].join(", ")}.` : undefined;
    const obs = await this.api.createObservation(
      site.siteId,
      featureId,
      { terrainFeatureId: featureId, sceneLocal: { x: round(local.x), y: round(local.y), z: round(local.z) } },
      description,
    );
    if (!obs.ok) {
      this.notice = "Could not start the investigation. Please try again.";
      return this.render();
    }
    this.observationFeature.set(obs.value.id, featureId);
    // Before the event goes out: research events can arrive over the socket before this call returns.
    this.orbs.begin(anchor);
    // A hand selection starts research only when the scientist pokes Investigate (services/orchestrator dispatcher).
    await this.api.emit("observation.selected", obs.value.id, { observationId: obs.value.id, action: "investigate", featureId });
    this.progress = ["Investigation requested. Waiting for the research team."];
    this.ringState.set(featureId, "researching");
    this.paintRing(featureId);
    this.go("researching");
  }

  private isResearching(featureId: string): boolean {
    return this.ringState.get(featureId) === "researching" || this.ringState.get(featureId) === "needs_evidence";
  }

  private async onEvent(e: NexusEvent): Promise<void> {
    const p = isObject(e.payload) ? e.payload : {};
    const featureId = await this.featureFor(e.correlationId);
    switch (e.type) {
      case "research.started":
        if (featureId) this.ringState.set(featureId, "researching");
        this.progress = ["The research team is working."];
        break;
      case "agent.task.dispatched":
      case "agent.task.completed":
      case "agent.task.failed": {
        if (typeof p.agentId === "string" && featureId === this.selected) {
          if (this.orbs.count === 0) {
            const a = featureId ? this.site?.anchors.get(featureId) : undefined;
            if (a) this.orbs.begin(a);
          }
          this.orbs.set(p.agentId, e.type.endsWith("dispatched") ? "working" : e.type.endsWith("completed") ? "done" : "failed");
        }
        const who = typeof p.agentId === "string" ? agentName(p.agentId) : "An agent";
        const what = e.type.endsWith("dispatched") ? "working" : e.type.endsWith("completed") ? "done" : "could not finish";
        this.progress = [...this.progress.filter((l) => !l.startsWith(`${who}:`)), `${who}: ${what}`];
        break;
      }
      case "finding.validation.completed": {
        const d = isObject(p.decision) ? p.decision : {};
        if (featureId && d.outcome === "REQUEST_MORE_EVIDENCE") {
          this.ringState.set(featureId, "needs_evidence");
          this.progress = [...this.progress, "The integrity check asked for more evidence before this can be shown."];
        }
        if (featureId && d.outcome === "REJECT") {
          this.ringState.set(featureId, "observed");
          this.progress = [...this.progress, "The integrity check found no claim it could show."];
        }
        break;
      }
      case "finding.review.required":
      case "finding.approved":
      case "finding.rejected":
      case "finding.inconclusive":
        if (typeof p.findingId === "string") {
          const res = await this.api.getFinding(p.findingId);
          if (res.ok) {
            const first = !this.findings.has(res.value.spatialAnchor.terrainFeatureId ?? "");
            this.storeFinding(res.value);
            const fid = res.value.spatialAnchor.terrainFeatureId;
            if (e.type === "finding.review.required") this.orbs.finish(performance.now());
            if (e.type === "finding.review.required" && first && fid === this.selected) {
              this.go("finding");
              this.readBriefing(res.value);
            }
          }
        }
        break;
      default:
        return;
    }
    if (featureId) this.paintRing(featureId);
    if (this.screen === "researching" || this.screen === "finding") this.render();
    this.changed();
  }

  private async featureFor(observationId: string): Promise<string | undefined> {
    const known = this.observationFeature.get(observationId);
    if (known || !observationId.startsWith("OBS-")) return known;
    const obs = await this.api.getObservation(observationId);
    const fid = obs.ok ? (obs.value.featureId ?? obs.value.spatialAnchor.terrainFeatureId) : undefined;
    if (fid) this.observationFeature.set(observationId, fid);
    return fid;
  }

  private storeFinding(f: ScientificFinding): void {
    const fid = f.spatialAnchor.terrainFeatureId;
    if (!fid) return;
    this.findings.set(fid, f);
    this.observationFeature.set(f.observationId, fid);
    this.ringState.set(fid, cardModel(f).ring);
    this.paintRing(fid);
    this.changed();
  }

  private async restoreFindings(): Promise<void> {
    const res = await this.api.listFindings();
    if (res.ok) for (const f of res.value) this.storeFinding(f);
  }

  private readBriefing(f: ScientificFinding): void {
    const b = f.spokenBriefing;
    // Only a briefing the SIE approved for speech is ever played (VOICE.md §5).
    if (!b || b.voiceDecision !== "SPEAK_AS_APPROVED") return;
    this.speaker.enqueue({ scriptId: `${f.id}-briefing`, text: b.script, speaker: b.speakerAgentId, rate: f.uncertainty.level === "high" ? 0.9 : 1 });
  }

  private async showLogbook(): Promise<void> {
    const res = await this.api.logbook();
    this.logbookEntries = res.ok ? res.value : [];
    this.go("logbook");
  }

  // --- Voice (optional shortcut) ------------------------------------------------------------------

  private async startTalking(): Promise<void> {
    if (this.ptt || !this.api.session) return;
    const now = performance.now();
    this.ptt = { startedAt: now, lastSample: 0, samples: [], micOpen: false };
    this.voice.send({ type: "ptt.start", sampleRateHz: 16000 });
    this.renderWrist();
    this.changed();
    const opened = await this.mic.start((pcm) => this.voice.audio(pcm));
    if (this.ptt) this.ptt.micOpen = opened;
    else this.mic.stop();
    if (!opened && !this.opts.emulated) this.caption("narrator", "Microphone unavailable. Use the panels by hand.");
    this.changed();
  }

  private async stopTalking(): Promise<void> {
    const ptt = this.ptt;
    if (!ptt) return;
    this.ptt = undefined;
    this.mic.stop();
    for (let i = 0; i < ptt.samples.length; i += 300) this.voice.send({ type: "pointer", samples: ptt.samples.slice(i, i + 300) });
    const typed = this.opts.emulated ? this.opts.simulatedTranscript?.()?.trim() : undefined;
    if (typed) this.voice.send({ type: "ptt.simulated_transcript", text: typed.slice(0, 500) });
    this.voice.send({ type: "ptt.end" });
    this.renderWrist();
    this.changed();
  }

  private samplePointer(now: number): void {
    const ptt = this.ptt;
    const site = this.site;
    if (!ptt || ptt.samples.length >= 3000) return;
    const cam = this.world.renderer.xr.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera;
    cam.getWorldPosition(this.head);
    cam.getWorldDirection(this.headDir);
    const hit = this.input.rayHit("right");
    const feature = hit.point && site ? pickFeature(site.features, sceneToTile(site.frame, this.diorama.toLayout(hit.point)), PICK_TOLERANCE_M) : undefined;
    ptt.samples.push({
      tMs: Math.round(now - ptt.startedAt),
      rayFeatureId: feature?.id,
      rayPoint: hit.point ? vec(hit.point) : undefined,
      onUi: hit.onUi,
      headPosition: vec(this.head),
      headDirection: vec(this.headDir),
    });
  }

  private onVoice(m: VoiceServerMessage): void {
    switch (m.type) {
      case "ready":
        this.sendContext();
        break;
      case "transcript":
        if (m.final) this.caption("you", m.text);
        break;
      case "low_confidence":
        this.caption("you", `${m.text} (not sure I heard that right; nothing was done)`);
        break;
      case "command":
        this.runCommand(m.command as Command);
        break;
      case "clarify":
        this.clarify = m;
        this.go("clarify");
        break;
      case "fieldnote.created":
        if (m.fieldNote.reference.targetFeatureId) this.observationFeature.set(m.observationId, m.fieldNote.reference.targetFeatureId);
        break;
      case "reviewed":
        void this.api.getFinding(m.findingId).then((r) => {
          if (r.ok) {
            this.storeFinding(r.value);
            if (this.screen === "finding") this.render();
          }
        });
        break;
      case "speak":
        this.speaker.fromGateway(m);
        break;
      default:
        break;
    }
    this.changed();
  }

  /** Voice commands call the same handlers as the buttons (INTERACTION.md §1). */
  private runCommand(c: Command): void {
    this.lastCommand = c.kind;
    const siteIndex = SITES.findIndex((s) => s.siteId === this.site?.siteId);
    switch (c.kind) {
      case "investigate":
        if (typeof c.target === "object") return void this.loadSite(c.target.siteId);
        if (this.selected && !this.findings.has(this.selected)) return void this.investigate();
        return;
      case "go_to":
        return void this.loadSite(c.siteId);
      case "next_site":
      case "previous_site": {
        const step = c.kind === "next_site" ? 1 : SITES.length - 1;
        const next = SITES[(Math.max(0, siteIndex) + step) % SITES.length];
        if (next) void this.loadSite(next.siteId);
        return;
      }
      case "read_it": {
        const f = this.selected ? this.findings.get(this.selected) : undefined;
        if (f) this.readBriefing(f);
        return;
      }
      case "stop":
        return this.speaker.stop();
      case "show":
      case "provenance":
        if (this.selected && this.findings.has(this.selected)) this.go("sources");
        return;
      case "hide_panel":
        this.selected = undefined;
        this.repaintRings();
        return this.go("idle");
      case "onboarding":
        if (this.screen === "welcome") this.onButton(this.main, `onboard:${c.action}`, "press", "ray");
        return;
      case "zoom":
        this.diorama.step(c.direction === "in" ? "zoom_in" : "zoom_out");
        return;
      case "rotate":
        this.diorama.step(c.direction === "left" ? "rotate_left" : "rotate_right");
        return;
      case "reset":
        this.diorama.reset();
        return;
      default:
        // Modes, whisper, pause and video marks land with later milestones (docs/TASKS.md Phase 2 and 5).
        this.caption("narrator", "That command is not available yet.");
    }
  }

  private sendContext(): void {
    const site = this.site;
    if (!site) return;
    this.voice.send({
      type: "context",
      siteId: site.siteId,
      sites: SITES.map((s) => ({ siteId: s.siteId, names: [...s.names] })),
      selectedFindingId: this.selected ? this.findings.get(this.selected)?.id : undefined,
      candidates: site.features.map((f) => {
        const a = site.anchors.get(f.id) ?? { x: 0, y: 0, z: 0 };
        return { id: f.id, spokenLabel: f.spokenLabel, aliases: f.aliases, position: vec(this.diorama.toWorld(a)) };
      }),
      language: "en",
    });
  }

  private reportPlayback(kind: "started" | "completed" | "interrupted", u: Utterance): void {
    if (!this.api.session) return;
    const payload = u.scriptId ? { scriptId: u.scriptId } : { systemPhraseId: u.systemPhraseId };
    void this.api.emit(`speech.playback.${kind}`, u.scriptId ?? `PHRASE-${u.systemPhraseId ?? "unknown"}`, payload);
  }

  // --- Rendering ----------------------------------------------------------------------------------

  private go(screen: Screen): void {
    this.screen = screen;
    this.render();
    this.changed();
  }

  private render(): void {
    this.main.set(this.content());
    this.renderWrist();
  }

  private content(): PanelContent {
    const lines: PanelLine[] = [];
    const rows: ButtonSpec[][] = [];
    const feature = this.selected ? this.site?.features.find((f) => f.id === this.selected) : undefined;
    const finding = this.selected ? this.findings.get(this.selected) : undefined;
    switch (this.screen) {
      case "pair": {
        lines.push({ text: "Pair this headset", tone: "title" }, { text: "Poke the pairing code shown by the NEXUS service.", tone: "muted" });
        lines.push({ text: this.code ? this.code.replace(/./g, "● ") : "—", tone: "title" });
        const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
        rows.push([{ id: "pair:del", label: "⌫" }, { id: "pair:0", label: "0" }, { id: "pair:go", label: "Pair", style: "primary" }]);
        for (let r = 2; r >= 0; r--) rows.push(digits.slice(r * 3, r * 3 + 3).map((d) => ({ id: `pair:${d}`, label: d })));
        break;
      }
      case "welcome":
        lines.push({ text: "Welcome to NEXUS.", tone: "title" }, { text: "Pinch to select. Palm up for the menu.", tone: "body" });
        lines.push({ text: "Point at a glowing ring on the terrain and pinch to select a feature. Poke buttons with your fingertip.", tone: "muted" });
        rows.push([{ id: "onboard:skip", label: "Skip" }, { id: "onboard:start", label: "Start", style: "primary" }]);
        break;
      case "idle": {
        const site = SITES.find((s) => s.siteId === this.site?.siteId);
        lines.push({ text: site?.name ?? "Loading terrain…", tone: "title" });
        lines.push({ text: "Point at a glowing ring and pinch to select a feature.", tone: "body" });
        lines.push({ text: "Turn your left palm up for the menu: sites, logbook and the push-to-talk mic.", tone: "muted" });
        // AGENTS.md rule 7: archival imagery is never presented as live.
        lines.push({ text: "Terrain and imagery: archival LROC NAC products (NASA/GSFC/Arizona State University), not live data.", tone: "muted" });
        break;
      }
      case "selected":
        lines.push({ text: feature?.label ?? "Feature", tone: "title" });
        lines.push({ text: `Selected ${feature?.kind ?? "feature"}. Investigate sends it to the research team; every claim is checked by the integrity engine before you see it.`, tone: "body" });
        lines.push({ text: "Optional: poke what you see. It is saved with the observation in your words.", tone: "muted" });
        rows.push([{ id: "sel:cancel", label: "Cancel" }, { id: "sel:investigate", label: "Investigate", style: "primary" }]);
        if (feature) {
          const chips = DESCRIPTOR_CHIPS[feature.kind];
          rows.push(chips.slice(2).map((d) => this.chip(d)));
          rows.push(chips.slice(0, 2).map((d) => this.chip(d)));
        }
        break;
      case "researching":
        lines.push({ text: feature?.label ?? "Investigation", tone: "title" }, { text: "Researching", tone: "muted" });
        for (const p of this.progress) lines.push({ text: p, tone: "body" });
        rows.push([{ id: "back:idle", label: "Back" }]);
        break;
      case "finding": {
        if (!finding) return this.screenFallback();
        const card = cardModel(finding);
        lines.push(...card.lines);
        if (card.reviewable) {
          rows.push([
            { id: "card:approve", label: "Approve", style: "primary" },
            { id: "card:reject", label: "Reject", style: "danger" },
            { id: "card:inconclusive", label: "Inconclusive" },
          ]);
        }
        rows.unshift([
          ...(card.speakable ? [{ id: "card:hear", label: this.speaker.speaking ? "Stop" : "Hear it", style: "chip" as const }] : []),
          { id: "card:evidence", label: "Evidence", style: "chip" },
          { id: "card:sources", label: "Sources", style: "chip" },
          { id: "card:close", label: "Close" },
        ]);
        break;
      }
      case "reason":
        lines.push({ text: this.pendingDecision === "rejected" ? "Reject: why? (optional)" : "Inconclusive: why? (optional)", tone: "title" });
        lines.push({ text: "Your choice is stored word for word with the review.", tone: "muted" });
        rows.push([{ id: "reason:back", label: "Back" }, { id: "reason:none", label: "No reason", style: "primary" }]);
        rows.push(REASON_CHIPS.slice(2).map((t, i) => ({ id: `reason:${i + 2}`, label: t, style: "chip" as const })));
        rows.push(REASON_CHIPS.slice(0, 2).map((t, i) => ({ id: `reason:${i}`, label: t, style: "chip" as const })));
        break;
      case "sources":
        lines.push({ text: "Where this comes from", tone: "title" });
        for (const s of finding?.sources ?? []) lines.push({ text: s.dataset, tone: "body", badge: s.evidenceId }, { text: s.sourceUrl, tone: "muted" });
        rows.push([{ id: "back:finding", label: "Back" }]);
        break;
      case "evidence": {
        lines.push({ text: "Evidence behind this finding", tone: "title" }, { text: "Poke one to open it beside the card.", tone: "muted" });
        const ids = finding ? citedIds(finding) : [];
        const label = (id: string) => this.evidenceLabel(id);
        for (let i = 0; i < Math.min(ids.length, 6); i += 2) rows.unshift(ids.slice(i, i + 2).map((id) => ({ id: `ev:${id}`, label: label(id), style: id === this.evidenceOpen ? ("active" as const) : ("chip" as const) })));
        rows.unshift([{ id: "back:finding", label: "Back" }]);
        if (!this.evidenceData || this.evidenceData.siteId !== this.site?.siteId) void this.loadEvidence();
        break;
      }
      case "logbook":
        lines.push({ text: "Logbook", tone: "title" });
        if (this.logbookEntries.length === 0) lines.push({ text: "No reviews yet.", tone: "muted" });
        for (const e of this.logbookEntries) {
          lines.push({ text: e.finding?.title ?? e.review.findingId, tone: "body", badge: e.review.decision });
          if (e.review.rationaleText) lines.push({ text: `Reason: ${e.review.rationaleText}`, tone: "muted" });
        }
        rows.push([{ id: "back:idle", label: "Back" }]);
        break;
      case "clarify": {
        const c = this.clarify;
        lines.push({ text: c?.prompt ?? "Which feature do you mean?", tone: "title" }, { text: "Poke the one you meant.", tone: "muted" });
        rows.push([{ id: "clarify:cancel", label: "Cancel" }]);
        rows.push((c?.candidates ?? []).slice(0, 3).map((x) => ({ id: `clarify:${x.featureId}`, label: x.label, style: "chip" as const })));
        break;
      }
    }
    if (this.notice) lines.splice(1, 0, { text: this.notice, tone: "warn" });
    return { lines, rows };
  }

  private screenFallback(): PanelContent {
    this.screen = "idle";
    return this.content();
  }

  private renderWrist(): void {
    const talking = this.ptt !== undefined;
    const site = SITES.find((s) => s.siteId === this.site?.siteId);
    this.wrist.set({
      lines: [{ text: site ? `NEXUS · ${site.name}` : "NEXUS", tone: "muted" }],
      rows: [
        [
          { id: "wrist:logbook", label: "Logbook" },
          { id: "wrist:stop", label: "Stop speech" },
        ],
        [
          { id: "view:zoom_out", label: "Zoom −" },
          { id: "view:reset", label: "Reset" },
          { id: "view:zoom_in", label: "Zoom +" },
        ],
        [
          { id: "view:rotate_left", label: "↺ Turn" },
          { id: "view:rotate_right", label: "Turn ↻" },
        ],
        SITES.map((s) => ({ id: `site:${s.siteId}`, label: s.short, style: s.siteId === site?.siteId ? ("chip" as const) : ("secondary" as const) })),
        [{ id: "wrist:ptt", label: talking ? "Listening… release to send" : "Hold to talk", style: talking ? "active" : "primary" }],
      ],
    });
    // Before pairing there is nothing the menu could do.
    this.wrist.mesh.visible = this.wrist.mesh.visible && this.api.session !== undefined;
  }

  private renderCaptions(): void {
    const last = this.captionLog.slice(-2);
    this.captions.set({ lines: last.length ? last.map((t) => ({ text: t, tone: "body" as const })) : [{ text: "Captions appear here.", tone: "muted" }], rows: [] });
  }

  private caption(speaker: string, text: string): void {
    this.captionLog.push(`${speaker === "you" ? "You" : agentName(speaker)}: ${text}`);
    if (this.captionLog.length > 50) this.captionLog.shift();
    this.renderCaptions();
    this.changed();
  }

  /** Palm toward the face or up shows the wrist menu; without a tracked left hand it stays at the left front. */
  private placeWristMenu(): void {
    const mesh = this.wrist.mesh;
    if (!this.api.session) {
      mesh.visible = false;
      return;
    }
    const cam = this.world.renderer.xr.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera;
    cam.getWorldPosition(this.head);
    if (!this.opts.desktop && this.input.leftWrist(this.wristPose)) {
      const toHead = this.head.clone().sub(this.wristPose.position).normalize();
      const facing = Math.max(this.wristPose.palmNormal.dot(toHead), this.wristPose.palmNormal.y);
      const wasVisible = mesh.visible;
      // Hysteresis so the menu does not flicker at the threshold; a held mic keeps it open.
      mesh.visible = this.ptt !== undefined || facing > (wasVisible ? 0.35 : 0.55);
      if (!mesh.visible) return;
      // Lift the menu so its lowest row clears the hand it floats over.
      mesh.position.copy(this.wristPose.position).addScaledVector(this.wristPose.palmNormal, 0.05);
      mesh.position.y += 0.06 + this.wrist.heightM / 2;
      // Face the user when it opens, then hold that heading: a menu that swivels while a finger
      // reaches for it moves its buttons out from under the fingertip.
      if (!wasVisible || !this.wristFacingSet) {
        mesh.lookAt(this.head);
        this.wristFacingSet = true;
      }
    } else {
      // Controllers and desktop mode: park the menu to the far left, clear of the evidence window.
      mesh.visible = true;
      mesh.position.set(-0.36, 0.86, -0.3);
      mesh.lookAt(this.head);
    }
  }

  private chip(d: string): ButtonSpec {
    return { id: `desc:${d}`, label: d, style: this.descriptors.has(d) ? "active" : "chip" };
  }

  private async loadEvidence(): Promise<void> {
    const site = this.site;
    if (!site) return;
    const res = await this.api.evidence(site.siteId);
    if (!res.ok || this.site !== site) return;
    this.evidenceData = { siteId: site.siteId, ...res.value };
    if (this.screen === "evidence") this.render();
  }

  private evidenceLabel(id: string): string {
    const item = this.evidenceData?.items.find((i) => i.id === id);
    if (item) return item.spokenLabel.replace(/^the /, "");
    const m = this.evidenceData?.measurements.find((x) => x.id === id);
    return m ? `${m.quantity} (computed)` : id;
  }

  private async openEvidence(id: string): Promise<void> {
    if (!this.evidenceData) await this.loadEvidence();
    this.evidenceOpen = id;
    this.renderEvidence();
    this.evidence.mesh.visible = true;
    if (this.screen === "evidence") this.render();
    this.changed();
  }

  private closeEvidence(): void {
    this.evidenceOpen = undefined;
    this.evidence.mesh.visible = false;
    if (this.screen === "evidence") this.render();
    this.changed();
  }

  private renderEvidence(): void {
    const id = this.evidenceOpen;
    if (!id) return;
    const lines: PanelLine[] = [];
    const item = this.evidenceData?.items.find((i) => i.id === id);
    const m = this.evidenceData?.measurements.find((x) => x.id === id);
    let image: PanelContent["image"];
    if (item) {
      lines.push({ text: item.title, tone: "title", badge: item.id });
      if (item.type === "image") {
        const img = this.mediaFor(item.id);
        if (img?.complete && img.naturalWidth > 0) image = { source: img, aspect: img.naturalWidth / img.naturalHeight };
      }
      if (item.dataset) lines.push({ text: `${item.dataset}${item.productId ? ` · ${item.productId}` : ""}`, tone: "body" });
      // AGENTS.md rule 7: archival products are never presented as live.
      if (item.acquiredAt) lines.push({ text: `Acquired ${item.acquiredAt.slice(0, 10)}. Archival data, not live.`, tone: "muted" });
      if (item.excerpt) lines.push({ text: `“${item.excerpt}”`, tone: "body" });
      lines.push({ text: `Credit: ${item.credit}`, tone: "muted" }, { text: item.license, tone: "muted" }, { text: item.sourceUrl, tone: "muted" });
    } else if (m) {
      // Numbers here come from packages/terrain, not a model (AGENTS.md rule 4).
      lines.push({ text: `${m.quantity}: ${m.value} ${m.unit}`, tone: "title", badge: m.id });
      lines.push({ text: "Computed by deterministic code from the terrain model, not by an AI model.", tone: "body" });
      lines.push({ text: m.method, tone: "muted" }, { text: `Source: ${m.sourceEvidenceId}`, tone: "muted" });
    } else {
      lines.push({ text: id, tone: "title" }, { text: "This evidence is not in the site's evidence store.", tone: "warn" });
    }
    this.evidence.set({ lines, rows: [[{ id: "evwin:close", label: "Close" }]], image });
  }

  /** Image evidence has a crop in data/evidence-packs/media, served next to the terrain tiles. */
  private mediaFor(id: string): HTMLImageElement | undefined {
    let img = this.media.get(id);
    if (!img) {
      img = new Image();
      img.onload = () => {
        if (this.evidenceOpen === id) this.renderEvidence();
      };
      img.src = `${import.meta.env.BASE_URL}evidence-packs/media/${encodeURIComponent(id)}.png`;
      this.media.set(id, img);
    }
    return img;
  }

  private paintRing(featureId: string): void {
    const ring = this.site?.markers.get(featureId);
    if (!ring) return;
    const state = this.ringState.get(featureId);
    ring.material.color.setHex(featureId === this.selected && (!state || state === "observed") ? RING_COLORS.selected : RING_COLORS[state ?? "idle"]);
  }

  private repaintRings(): void {
    for (const f of this.site?.features ?? []) this.paintRing(f.id);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Soft tick on every successful pinch-select or poke (INTERACTION.md §3). Never a "discovery" sound (§4). */
let audioCtx: AudioContext | undefined;
function tick(via: "poke" | "ray"): void {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = via === "poke" ? 1400 : 1000;
    g.gain.setValueAtTime(0.05, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.06);
  } catch {
    // Audio feedback is a nicety; never block input on it.
  }
}

function splitId(id: string): [string, string?] {
  const i = id.indexOf(":");
  return i < 0 ? [id] : [id.slice(0, i), id.slice(i + 1)];
}

/** Evidence and measurement ids the finding's claims cite, in order, without repeats. */
function citedIds(f: ScientificFinding): string[] {
  const ids = f.claims.flatMap((c) => [...(c.measurementIds ?? []), ...c.evidenceIds]);
  return [...new Set(ids)];
}

function vec(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
