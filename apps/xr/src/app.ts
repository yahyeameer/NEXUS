// The AR app: the scientist places NASA's Moon on a real surface, opens a surveyed region as a tabletop terrain
// model, and works it with a main panel (selection → research → finding card → review), a captions strip and a
// wrist menu. Every action is reachable by poke or ray + pinch; voice only shortcuts them
// (AGENTS.md rule 1, INTERACTION.md §1 parity table).
import type { EvidenceItem, MeasurementRecord, NexusEvent, ReviewDecision, ScientificFinding, TerrainFeature, VoiceServerMessage } from "@nexus/schemas";
import type { Command } from "@nexus/voice";
import { Vector3 } from "three";
import { PlacementController } from "./ar/placementController.js";
import type { PlacementStatus } from "./ar/placementController.js";
import type { SurfaceSource } from "./ar/surfaceDetection.js";
import { DEFAULT_STAGE, viewToWorld } from "./ar/stage.js";
import type { StagePose } from "./ar/stage.js";
import type { Vec3 } from "./scene/tabletop.js";
import { MOON_CREDIT, angularDistanceDeg, modelToLatLon } from "./planet/moonModel.js";
import { PlanetaryEnvironment } from "./planet/planetaryEnvironment.js";
import { MeasurementTool, measurementLines } from "./interaction/measurementTool.js";
import { ObservationCapture } from "./interaction/observationCapture.js";
import { SpatialFocus } from "./interaction/spatialFocus.js";
import { sampleElevation } from "@nexus/terrain";
import type { EnvironmentMode } from "./planet/planetaryEnvironment.js";
import { PushToTalkMic } from "./audio/mic.js";
import { Speaker } from "./audio/speaker.js";
import type { Utterance } from "./audio/speaker.js";
import { SITES } from "./config.js";
import { HandInput } from "./input/hands.js";
import { ApiClient } from "./net/api.js";
import type { LogbookEntry } from "./net/api.js";
import { VoiceClient } from "./net/voice.js";
import { zoomedScale } from "./input/manipulate.js";
import { pickFeature } from "./scene/featurePick.js";
import { AgentOrbs } from "./scene/orbs.js";
import { sceneToTile, tileToScene } from "./scene/tabletop.js";
import { loadSite } from "./scene/terrain.js";
import type { LoadedSite } from "./scene/terrain.js";
import type { World } from "./scene/world.js";
import { agentName, cardModel, comparisonLines, REASON_CHIPS } from "./ui/findingView.js";
import type { RingState } from "./ui/findingView.js";
import {
  AgentActivityPanel,
  EvidenceViewer,
  evidenceContent,
  findingContent,
  RockSelectionOutline,
  ScanningBeam,
  ScientificFindingPanel,
  SpatialGlassPanel,
} from "./ui/spatial/index.js";
import type { ButtonSpec, MarkerState, PanelContent, PanelLine } from "./ui/spatial/index.js";

type Screen = "pair" | "welcome" | "globe" | "idle" | "measure" | "mark" | "selected" | "researching" | "finding" | "reason" | "sources" | "evidence" | "compare" | "logbook" | "clarify";

export interface AppOptions {
  emulated: boolean;
  /** Mouse-and-keyboard emulator: the wrist menu stays docked, since there is no palm to turn up. */
  desktop?: boolean;
  /** Emulator only: what the desktop user typed as "speech" for the current push-to-talk. */
  simulatedTranscript?: () => string | undefined;
}

/** How the explorer is being shown: a real AR session, or the 3D viewer fallback (no camera, no AR). */
export type ExperienceMode = "ar" | "viewer";

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
  ar: PlacementStatus & { mode: ExperienceMode; environment: EnvironmentMode; regionMarked: boolean };
  /** Scientific tools: ruler step and result, saved spot observations, the feature in focus. */
  tools: { measure: string; measurement?: { horizontalM: number; heightDifferenceM: number; gradientDeg: number }; markPending: boolean; savedObservations: string[]; focus?: string };
  /** Terrain drawing: surface vertices in use (budget 256²) and whether tiles are still refining. */
  terrain?: { vertices: number; refining: boolean; lodSides: number[] };
}

/** Default seated layout (INTERACTION.md §3); ar/stage.ts moves it to wherever the explorer is placed. */
const LAYOUT = {
  face: { x: 0, y: 1.2, z: 0 },
  main: { x: 0.38, y: 1.02, z: -0.42 },
  captions: { x: 0.38, y: 0.7, z: -0.42 },
  evidence: { x: -0.4, y: 1.1, z: -0.46 },
  wristDock: { x: -0.42, y: 0.76, z: -0.22 },
  /** Placement guide: ahead and a little below eye level, out of the way of the surface being searched. */
  guide: { x: 0, y: 1.02, z: -0.55 },
} as const;
/** A pinch within this angle of the globe's region marker opens the region. */
const GLOBE_PICK_DEG = 9;

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
  /** Main card, docked to the front right, about 60 cm away, top edge below eye level, turned to the seated user (INTERACTION.md §3). */
  readonly main = new ScientificFindingPanel(v(LAYOUT.main), v(LAYOUT.face));
  readonly captions = new SpatialGlassPanel("captions", 0.4, 0.07, false);
  readonly wrist = new SpatialGlassPanel("wrist", 0.18, 0.37);
  /** Placement guide while searching for a surface: what to do, and what the device found. Display only. */
  readonly guide = new SpatialGlassPanel("guide", 0.32, 0.17, false);
  /** Evidence window, opened from a finding card (INTERACTION.md "Open evidence: poke evidence chip"). */
  readonly evidence = new EvidenceViewer();
  /** Which agents are at work, floating over the feature under investigation. */
  private readonly agents = new AgentActivityPanel();
  private readonly outline = new RockSelectionOutline();
  private readonly beam = new ScanningBeam();
  private readonly scratch = new Vector3();
  private readonly scratchB = new Vector3();
  private lastFrame = 0;
  /** Globe or region on the placed surface; the Diorama inside it carries placement, turn and zoom. */
  readonly env = new PlanetaryEnvironment();
  readonly diorama = this.env.diorama;
  readonly placement: PlacementController;
  private readonly measure = new MeasurementTool();
  private readonly capture = new ObservationCapture();
  private readonly spatialFocus = new SpatialFocus(this.diorama);
  private experience: ExperienceMode = "viewer";
  private stage: StagePose = DEFAULT_STAGE;
  private hoverMarker = false;
  private readonly toWorld = (layout: Vector3, out: Vector3): Vector3 => this.diorama.toWorldInto(layout, out);
  private guidePlaced = false;
  /** Phone touch gestures: a drag or pinch on the overlay must not also count as a tap. */
  private selectGuard?: () => boolean;
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
  private desktop = false;

  constructor(
    private readonly world: World,
    private readonly opts: AppOptions,
  ) {
    const { scene } = world;
    scene.add(this.main.mesh, this.captions.mesh, this.wrist.mesh, this.evidence.mesh, this.agents.mesh, this.guide.mesh, this.diorama.pivot);
    scene.add(this.main.connector.object, this.evidence.beam.object);
    this.guide.close();
    this.applyStage(DEFAULT_STAGE);
    this.placement = new PlacementController(world.renderer, scene, {
      placed: (stage) => this.applyStage(stage),
      changed: () => this.onPlacementChanged(),
      allowSelect: () => !(this.selectGuard?.() ?? false),
    });

    this.input = new HandInput(world.renderer, scene, {
      panels: () => this.interactivePanels(),
      terrain: () => (this.placing ? undefined : this.env.pickable(this.site?.terrain)),
      button: (panel, id, edge, via) => this.onButton(panel, id, edge, via),
      terrainSelect: (p) => {
        if (this.selectGuard?.()) return;
        if (this.env.mode === "globe") this.onGlobeSelect(p);
        else this.onTerrainSelect(p);
      },
      pivot: () => this.diorama.pivotPoint,
      manipulate: (m) => {
        // A mouse drag moves the emulated hand less than a real arm would, so desktop mode turns the terrain faster.
        if (m.yaw !== undefined) this.diorama.rotateBy(m.yaw * (this.desktop ? 1.6 : 1));
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
    this.desktop = opts.desktop === true;
    this.input.setDesktop(this.desktop);
    this.render();
    this.renderCaptions();
    this.renderWrist();
  }

  /** Mouse and keyboard shortcuts press the same buttons a hand would, so nothing is desktop-only. */
  press(id: string, edge: "press" | "release" = "press"): boolean {
    for (const panel of [this.main, this.captions, this.wrist, this.evidence]) {
      if (!panel.interactive || !panel.buttons.some((b) => b.id === id)) continue;
      this.onButton(panel, id, edge, "ray");
      return true;
    }
    return false;
  }

  /** Toolbar and keyboard: run a button's action whether or not its panel is open (same ids as the panels). */
  act(id: string): void {
    this.onButton(this.wrist, id, "press", "ray");
  }

  /** Touch twist and drag on a phone. */
  rotateBy(radians: number): void {
    this.diorama.rotateBy(radians);
    this.changed();
  }

  /** The 3D viewer drives the emulated hand with a mouse: hide hand models, dock the wrist menu. */
  setDesktop(desktop: boolean): void {
    this.desktop = desktop;
    this.input.setDesktop(desktop);
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
      ar: { ...this.placement.status(), mode: this.experience, environment: this.env.mode, regionMarked: this.env.regionMark !== undefined },
      tools: {
        measure: this.measure.state.step,
        measurement: this.measure.state.step === "done" ? { horizontalM: this.measure.state.result.horizontalM, heightDifferenceM: this.measure.state.result.heightDifferenceM, gradientDeg: this.measure.state.result.gradientDeg } : undefined,
        markPending: this.capture.pendingMark !== undefined,
        savedObservations: this.capture.savedIds,
        focus: this.spatialFocus.target,
      },
      terrain: this.site ? { vertices: this.site.tiles.vertexCount, refining: this.site.tiles.refining, lodSides: this.site.tiles.lodSides() } : undefined,
    };
  }

  // --- AR placement and the environment -----------------------------------------------------------

  private get placing(): boolean {
    return this.placement.phase === "placing";
  }

  /**
   * Starts the explorer in a session. `surface` is the hit-test source (undefined: none). The 3D viewer and devices
   * without hit-test place at once; AR with hit-test waits for the scientist to tap a surface.
   */
  beginSession(session: XRSession, mode: ExperienceMode, surface: SurfaceSource | undefined, anchors: boolean, fixedAt?: Vec3): void {
    this.experience = mode;
    this.placement.attach(session, surface, anchors);
    this.placement.setFootprint(this.env.footprintM());
    // A fixed spot is the seated default layout, so the stage is known before the first frame.
    if (fixedAt) this.placement.placeFixed(v(fixedAt), { ...DEFAULT_STAGE, surface: { ...fixedAt } });
    else this.startPlacing();
    session.addEventListener("end", () => {
      this.placement.detach();
      this.onPlacementChanged();
    });
  }

  /** Touch gestures report here, so the select at the end of a drag is not taken as a tap. */
  guardSelect(fn: () => boolean): void {
    this.selectGuard = fn;
  }

  private startPlacing(): void {
    this.guidePlaced = false;
    this.placement.reposition();
    this.onPlacementChanged();
  }

  /** Guide placed once in front of the viewer (world-anchored, not head-locked) once their pose is known. */
  private placeGuide(): void {
    this.guidePlaced = true;
    const cam = this.world.renderer.xr.getCamera();
    cam.getWorldPosition(this.head);
    cam.getWorldDirection(this.headDir);
    const yaw = Math.atan2(-this.headDir.x, -this.headDir.z);
    const viewStage: StagePose = { surface: DEFAULT_STAGE.surface, yaw, head: { x: this.head.x, y: this.head.y, z: this.head.z } };
    this.guide.place(v(viewToWorld(viewStage, LAYOUT.guide)), this.head.clone());
    this.guide.open();
  }

  /** Re-dock everything for a new placement: the model on the surface, the panels in the viewer's frame. */
  private applyStage(stage: StagePose): void {
    this.stage = stage;
    this.diorama.placeAt(stage.surface, stage.yaw);
    const face = v(stage.head);
    this.main.setDock(v(viewToWorld(stage, LAYOUT.main)), face);
    this.captions.place(v(viewToWorld(stage, LAYOUT.captions)), face);
    // Evidence opens to the front left, mirroring the card, so both can be read side by side.
    this.evidence.place(v(viewToWorld(stage, LAYOUT.evidence)), face);
    if (this.site && this.selected) this.syncSelection();
  }

  private onPlacementChanged(): void {
    const placing = this.placing;
    this.diorama.pivot.visible = !placing;
    for (const p of [this.main, this.captions]) p.setOpen(!placing);
    if (placing) {
      this.evidence.close();
      this.agents.close();
      this.renderGuide();
      if (this.guidePlaced) this.guide.open();
    } else this.guide.close();
    this.renderWrist();
    this.changed();
  }

  private renderGuide(): void {
    const s = this.placement.status();
    const what = this.env.mode === "globe" ? "the Moon" : "the terrain model";
    const lines: PanelLine[] = [{ text: `Place ${what}`, tone: "title" }];
    if (s.surfaceFound) lines.push({ text: "Surface found. Pinch, or tap the screen, to place it on the ring.", tone: "body" });
    else lines.push({ text: "Look at a table or the floor and move slowly while NEXUS finds a surface.", tone: "body" });
    if (s.surface === "emulated-plane") lines.push({ text: "Emulator: a flat test surface stands in for the room.", tone: "muted" });
    this.guide.set({ lines, rows: [] });
  }

  private interactivePanels(): SpatialGlassPanel[] {
    return this.placing ? [] : [this.main, this.captions, this.wrist, this.evidence];
  }

  /** Show NASA's globe on the placed surface, with the surveyed region marked. */
  showGlobe(): void {
    this.selected = undefined;
    this.descriptors.clear();
    this.closeEvidence();
    this.outline.hide();
    this.beam.stop();
    this.main.attach(undefined, undefined);
    this.env.showGlobe();
    this.placement.setFootprint(this.env.footprintM());
    if (this.screen !== "pair" && this.screen !== "welcome") this.go("globe");
    this.renderWrist();
    this.changed();
  }

  /** Open a site's terrain on the same anchor as the globe. */
  async openRegion(siteId: string): Promise<void> {
    if (this.site?.siteId !== siteId) await this.loadSite(siteId);
    this.env.showRegion(this.site?.group);
    this.placement.setFootprint(this.env.footprintM());
    if (this.screen !== "pair" && this.screen !== "welcome") this.go("idle");
    this.renderWrist();
    this.changed();
  }

  private onGlobeSelect(point: Vector3): void {
    if (this.screen === "pair" || this.screen === "welcome") return;
    const mark = this.env.regionMark;
    if (mark && angularDistanceDeg(modelToLatLon(this.env.globeLatLon(point)), mark) <= GLOBE_PICK_DEG) {
      void this.openRegion(this.site?.siteId ?? SITES[0].siteId);
      return;
    }
    this.notice = "No NEXUS survey terrain there yet. The marked region holds the three demo sites.";
    this.render();
  }

  /** Every visible button, in world space: the emulator's target resolver and e2e tests drive the hands to these. */
  targets(): { name: string; position: Vector3; normal: Vector3; size: Vector3 }[] {
    const out: { name: string; position: Vector3; normal: Vector3; size: Vector3 }[] = [];
    for (const panel of this.interactivePanels()) {
      if (!panel.mesh.visible) continue;
      for (const b of panel.buttons) {
        const w = panel.buttonWorld(b.id);
        if (w) out.push({ name: `${panel.name}/${b.id}`, ...w });
      }
    }
    if (this.placing) {
      // Emulator tests aim the hand at the default table spot to find the emulated surface.
      if (this.placement.status().surface === "emulated-plane") out.push({ name: "surface/table", position: v(DEFAULT_STAGE.surface), normal: new Vector3(0, 1, 0), size: new Vector3(0.2, 0.01, 0.2) });
      return out;
    }
    if (this.env.mode === "globe") {
      const m = this.env.markerWorld(new Vector3());
      if (m) out.push({ name: "globe/region", position: m, normal: new Vector3(0, 1, 0), size: new Vector3(0.02, 0.02, 0.02) });
      return out;
    }
    for (const [id, a] of this.site?.anchors ?? []) out.push({ name: `feature/${id}`, position: this.diorama.toWorld(a), normal: new Vector3(0, 1, 0), size: new Vector3(0.05, 0.01, 0.05) });
    // Measure and mark take any terrain point; four named spots let hand-driven tests aim at open ground.
    if ((this.screen === "measure" || this.screen === "mark") && this.site) {
      const site = this.site;
      const quarter: [string, number, number][] = [["nw", 0.3, 0.3], ["ne", 0.7, 0.3], ["sw", 0.3, 0.7], ["se", 0.7, 0.7]];
      for (const [name, fx, fz] of quarter) {
        const t = { x: site.frame.widthM * fx, z: site.frame.depthM * fz };
        const e = sampleElevation(site.grid, t);
        if (e === undefined) continue;
        const layout = tileToScene(site.frame, { x: t.x, y: e, z: t.z });
        out.push({ name: `terrain/${name}`, position: this.diorama.toWorld(layout), normal: new Vector3(0, 1, 0), size: new Vector3(0.03, 0.01, 0.03) });
      }
    }
    return out;
  }

  async loadSite(siteId: string): Promise<void> {
    const next = await loadSite(siteId);
    this.env.setSite(next.group, this.site?.group);
    this.site?.tiles.dispose();
    next.group.add(this.orbs.group, this.outline.mesh, this.beam.group, this.measure.group, this.capture.group);
    this.measure.reset();
    this.capture.clear();
    this.spatialFocus.clear();
    this.diorama.setFocus(0, 0);
    this.orbs.clear();
    this.agents.close();
    this.beam.stop();
    this.outline.hide();
    this.site = next;
    this.selected = undefined;
    this.descriptors.clear();
    this.closeEvidence();
    for (const f of next.features) this.paintRing(f.id);
    if (this.screen !== "pair" && this.screen !== "welcome" && this.env.mode === "region") this.go("idle");
    this.sendContext();
    this.renderWrist();
    this.changed();
  }

  /** Per-frame update from the render loop. */
  frame(now: number): void {
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.placement.update(now);
    this.spatialFocus.update(now);
    if (this.placing && !this.guidePlaced && this.placement.viewerReady) this.placeGuide();
    this.input.update();
    this.placeWristMenu();
    for (const p of [this.main, this.captions, this.wrist, this.evidence, this.agents, this.guide]) p.update(now);
    this.orbs.update(now);
    if (this.ptt && now - this.ptt.lastSample >= POINTER_INTERVAL_MS) {
      this.ptt.lastSample = now;
      this.samplePointer(now);
    }
    if (now - this.hoverCheckedAt >= 100) {
      this.hoverCheckedAt = now;
      this.hoverFeature = this.featureUnderRay();
      this.hoverMarker = this.markerUnderRay();
    }
    this.env.update(now, this.hoverMarker);
    if (this.env.mode === "globe" || this.placing) return;
    const site = this.site;
    if (!site) return;
    const cam = this.world.renderer.xr.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera;
    cam.getWorldPosition(this.head);
    site.tiles.update(now, this.head, this.toWorld, this.diorama.scale);
    for (const [id, marker] of site.markers) {
      marker.setHover(id === this.hoverFeature);
      marker.update(now, this.head, this.diorama.scale);
    }
    this.outline.update(now, dt);
    this.beam.update(now, dt);
    // Panels and beams tied to the selected feature follow it as the diorama turns and zooms.
    const anchor = this.selected ? site.anchors.get(this.selected) : undefined;
    const anchorWorld = anchor ? this.diorama.toWorldInto(anchor, this.scratch) : undefined;
    this.main.link(anchorWorld);
    this.evidence.link(anchorWorld, this.scratchB);
    if (this.agents.mesh.visible && anchorWorld) this.agents.follow(this.scratchB.copy(anchorWorld), this.head);
    if (this.agents.isOpen && this.orbs.count === 0) this.agents.close();
    this.main.connector.update(now, dt);
    this.evidence.beam.update(now, dt);
  }

  // --- Buttons ------------------------------------------------------------------------------------

  private onButton(panel: SpatialGlassPanel, id: string, edge: "press" | "release", via: "poke" | "ray"): void {
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
        return this.go(this.env.mode === "globe" ? "globe" : "idle");
      case "sel":
        if (arg === "investigate") return void this.investigate();
        if (arg === "focus") return this.focusSelected();
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
        // From the globe, a site button opens its region; in region mode it swaps the terrain in place.
        return void this.openRegion(arg);
      case "tool":
        if (arg === "measure") {
          this.measure.reset();
          this.notice = undefined;
          return this.go("measure");
        }
        if (arg === "mark") {
          this.capture.cancel();
          this.descriptors.clear();
          this.notice = undefined;
          return this.go("mark");
        }
        if (arg === "measure_again") {
          this.measure.reset();
          return this.render();
        }
        if (arg === "save_mark") return void this.saveMark();
        if (arg === "done") {
          this.measure.reset();
          this.capture.cancel();
          this.notice = undefined;
          return this.go("idle");
        }
        return;
      case "env":
        if (arg === "globe") this.showGlobe();
        return;
      case "ar":
        if (arg === "reposition") this.startPlacing();
        return;
      case "wrist":
        if (arg === "logbook") return void this.showLogbook();
        if (arg === "stop") return this.speaker.stop();
        return;
      case "view":
        if (arg === "focus") return this.focusSelected();
        if (arg === "reset") {
          this.spatialFocus.clear();
          this.diorama.reset();
        }
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
        return this.go(this.selected && this.findings.has(this.selected) ? "finding" : this.env.mode === "globe" ? "globe" : "idle");
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
      case "compare":
        return this.go("compare");
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

  private markerUnderRay(): boolean {
    const point = this.env.mode === "globe" ? this.input.rayHit("right").point : undefined;
    const mark = this.env.regionMark;
    return point !== undefined && mark !== undefined && angularDistanceDeg(modelToLatLon(this.env.globeLatLon(point)), mark) <= GLOBE_PICK_DEG;
  }

  private featureUnderRay(): string | undefined {
    if (this.env.mode !== "region") return undefined;
    const site = this.site;
    const point = this.input.rayHit("right").point;
    if (!site || !point || this.screen === "pair" || this.screen === "welcome") return undefined;
    return pickFeature(site.features, sceneToTile(site.frame, this.diorama.toLayout(point)), PICK_TOLERANCE_M)?.id;
  }

  private onTerrainSelect(point: Vector3): void {
    const site = this.site;
    if (!site || this.screen === "pair" || this.screen === "welcome") return;
    const layout = this.diorama.toLayout(point);
    const tile = sceneToTile(site.frame, layout);
    if (this.screen === "measure") {
      this.measure.addPoint(site.grid, layout, { x: tile.x, z: tile.z });
      this.render();
      return this.changed();
    }
    if (this.screen === "mark") {
      this.capture.mark({ layout, tile: { x: tile.x, y: tile.y, z: tile.z } });
      this.render();
      return this.changed();
    }
    const f = pickFeature(site.features, tile, PICK_TOLERANCE_M);
    if (!f) return;
    this.selectFeature(f.id);
  }

  /** SpatialFocus on the selected feature: it glides to the middle of the model and is magnified. */
  private focusSelected(): void {
    const a = this.selected && this.env.mode === "region" ? this.site?.anchors.get(this.selected) : undefined;
    if (!this.selected || !a) {
      this.notice = "Select a feature first, then Focus brings it to the middle.";
      return this.render();
    }
    this.spatialFocus.focus(this.selected, a);
    this.changed();
  }

  /** Saves the marked spot as the scientist's observation, with their chips verbatim. Does not start research. */
  private async saveMark(): Promise<void> {
    const site = this.site;
    const m = this.capture.pendingMark;
    if (!site || !m) return;
    const description = this.descriptors.size ? `Scientist noted: ${[...this.descriptors].join(", ")}.` : undefined;
    const obs = await this.api.createObservation(site.siteId, undefined, { sceneLocal: { x: round(m.tile.x), y: round(m.tile.y), z: round(m.tile.z) } }, description);
    if (!obs.ok) {
      this.notice = "Could not save the observation. Please try again.";
      return this.render();
    }
    this.capture.commit(obs.value.id);
    this.descriptors.clear();
    this.notice = `Saved as ${obs.value.id}, in your words. It was not sent for research.`;
    this.render();
    this.changed();
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
    this.agents.show(this.orbs.states());
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
          this.agents.show(this.orbs.states());
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
      case "globe":
        lines.push({ text: "The Moon", tone: "title" });
        lines.push({ text: "Point at the marked region and pinch to open its terrain, or choose a site.", tone: "body" });
        lines.push({ text: MOON_CREDIT, tone: "muted" });
        rows.push(SITES.map((s) => ({ id: `site:${s.siteId}`, label: s.short, style: "chip" as const })));
        break;
      case "idle": {
        const site = SITES.find((s) => s.siteId === this.site?.siteId);
        lines.push({ text: site?.name ?? "Loading terrain…", tone: "title" });
        lines.push({ text: "Point at a glowing ring and pinch to select a feature.", tone: "body" });
        lines.push({ text: "Turn your left palm up for the menu: sites, logbook and the push-to-talk mic.", tone: "muted" });
        // AGENTS.md rule 7: archival imagery is never presented as live.
        lines.push({ text: "Terrain and imagery: archival LROC NAC products (NASA/GSFC/Arizona State University), not live data.", tone: "muted" });
        const h = this.site?.header;
        if (h) lines.push({ text: `Grid ${h.width} × ${h.height} posts at ${h.cellSizeM} m (${h.sourceEvidenceId}). ${h.coordinateReferenceSystem}.`, tone: "muted" });
        rows.push([
          { id: "tool:measure", label: "Measure" },
          { id: "tool:mark", label: "Mark a spot" },
        ]);
        break;
      }
      case "measure": {
        const m = this.measure.state;
        lines.push({ text: "Measure", tone: "title" });
        if (m.step === "first") lines.push({ text: "Point at the terrain and pinch the first point.", tone: "body" });
        if (m.step === "second") lines.push({ text: "Now pinch the second point.", tone: "body" });
        if (m.step === "error") lines.push({ text: `Cannot measure there: ${m.error}.`, tone: "warn" }, { text: "Pinch a new first point.", tone: "body" });
        if (m.step === "done") {
          for (const t of measurementLines(m.result)) lines.push({ text: t, tone: "body" });
          // A tool reading by code, not an agent claim: labelled with its method and source (AGENTS.md rule 4).
          lines.push({ text: `Computed by NEXUS code from ${m.result.sourceEvidenceId}: ${m.result.method}. A measurement, not a finding.`, tone: "muted" });
        }
        rows.push([{ id: "tool:done", label: "Done" }, { id: "tool:measure_again", label: "New measurement", style: "primary" }]);
        break;
      }
      case "mark": {
        const pending = this.capture.pendingMark;
        lines.push({ text: "Mark a spot", tone: "title" });
        if (!pending) lines.push({ text: "Point at the place you want to note and pinch.", tone: "body" });
        else {
          lines.push({ text: "Poke what you see, then Save. Your words are stored exactly as chosen.", tone: "body" });
          const e = this.site ? sampleElevation(this.site.grid, pending.tile) : undefined;
          if (e !== undefined) lines.push({ text: `Tile position ${Math.round(pending.tile.x)} m E, ${Math.round(pending.tile.z)} m S of the north-west corner; elevation ${e.toFixed(1)} m (DTM datum).`, tone: "muted" });
          lines.push({ text: "Saving does not start research. To research a feature, select it and Investigate.", tone: "muted" });
        }
        rows.push([{ id: "tool:done", label: "Done" }, ...(pending ? [{ id: "tool:save_mark", label: "Save", style: "primary" as const }] : [])]);
        if (pending) {
          const chips = DESCRIPTOR_CHIPS.point;
          rows.push(chips.slice(2).map((d) => this.chip(d)));
          rows.push(chips.slice(0, 2).map((d) => this.chip(d)));
        }
        break;
      }
      case "selected":
        lines.push({ text: feature?.label ?? "Feature", tone: "title" });
        lines.push({ text: `Selected ${feature?.kind ?? "feature"}. Investigate sends it to the research team; every claim is checked by the integrity engine before you see it.`, tone: "body" });
        lines.push({ text: "Optional: poke what you see. It is saved with the observation in your words.", tone: "muted" });
        rows.push([{ id: "sel:cancel", label: "Cancel" }, { id: "sel:focus", label: "Focus" }, { id: "sel:investigate", label: "Investigate", style: "primary" }]);
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
        const card = findingContent(finding, this.speaker.speaking);
        lines.push(...card.lines);
        rows.push(...card.rows);
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
      case "compare":
        lines.push(...(finding ? comparisonLines(finding) : []));
        rows.push([{ id: "back:finding", label: "Back" }, { id: "card:evidence", label: "Evidence", style: "chip" }]);
        break;
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
    const site = this.env.mode === "region" ? SITES.find((s) => s.siteId === this.site?.siteId) : undefined;
    this.wrist.set({
      lines: [{ text: site ? `NEXUS · ${site.name}` : "NEXUS · The Moon", tone: "muted" }],
      rows: [
        [
          { id: "wrist:logbook", label: "Logbook" },
          { id: "wrist:stop", label: "Stop" },
        ],
        [
          { id: "view:zoom_out", label: "−" },
          { id: "view:reset", label: "Reset" },
          { id: "view:zoom_in", label: "+" },
        ],
        [
          { id: "view:rotate_left", label: "↺" },
          { id: "view:focus", label: "Focus" },
          { id: "view:rotate_right", label: "↻" },
        ],
        SITES.map((s) => ({ id: `site:${s.siteId}`, label: s.short, style: s.siteId === site?.siteId && this.env.mode === "region" ? ("chip" as const) : ("secondary" as const) })),
        [
          { id: "env:globe", label: "Moon", style: this.env.mode === "globe" ? ("chip" as const) : ("secondary" as const) },
          // Reposition needs a surface to search; the 3D viewer has no room to put it in.
          ...(this.experience === "ar" ? [{ id: "ar:reposition", label: "Move" }] : []),
        ],
        [{ id: "wrist:ptt", label: talking ? "Listening… release to send" : "Hold to talk", style: talking ? "active" : "primary" }],
      ],
    });
    // Before pairing, and while placing, there is nothing the menu could do.
    if (!this.api.session || this.placing) this.wrist.setOpen(false);
  }

  private renderCaptions(): void {
    // Newest first: the strip shows one page, so the line being spoken is never the one cut off.
    const [latest, previous] = this.captionLog.slice(-2).reverse();
    const lines: PanelLine[] = latest ? [{ text: latest, tone: "body" }] : [{ text: "Captions appear here.", tone: "muted" }];
    if (previous) lines.push({ text: previous, tone: "muted" });
    this.captions.set({ lines, rows: [] });
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
    if (!this.api.session || this.placing) {
      if (mesh.visible) this.wrist.setOpen(false);
      return;
    }
    const cam = this.world.renderer.xr.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera;
    cam.getWorldPosition(this.head);
    if (!this.desktop && this.input.leftWrist(this.wristPose)) {
      const toHead = this.head.clone().sub(this.wristPose.position).normalize();
      const facing = Math.max(this.wristPose.palmNormal.dot(toHead), this.wristPose.palmNormal.y);
      const wasVisible = this.wrist.isOpen;
      // Hysteresis so the menu does not flicker at the threshold; a held mic keeps it open.
      const show = this.ptt !== undefined || facing > (wasVisible ? 0.35 : 0.55);
      if (!show) {
        this.wrist.close();
        return;
      }
      this.wrist.open();
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
      this.wrist.open();
      const dock = viewToWorld(this.stage, LAYOUT.wristDock);
      mesh.position.set(dock.x, dock.y, dock.z);
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
    this.evidence.open();
    if (this.screen === "evidence") this.render();
    this.changed();
  }

  private closeEvidence(): void {
    this.evidenceOpen = undefined;
    this.evidence.close();
    if (this.screen === "evidence") this.render();
    this.changed();
  }

  private renderEvidence(): void {
    const id = this.evidenceOpen;
    if (!id) return;
    const img = this.mediaFor(id);
    const image = img?.complete && img.naturalWidth > 0 ? { source: img, aspect: img.naturalWidth / img.naturalHeight } : undefined;
    this.evidence.set(evidenceContent(id, this.evidenceData?.items ?? [], this.evidenceData?.measurements ?? [], image));
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
    const marker = this.site?.markers.get(featureId);
    if (!marker) return;
    const state = this.ringState.get(featureId);
    const shown: MarkerState = featureId === this.selected && (!state || state === "observed") ? "selected" : (state ?? "idle");
    marker.setState(shown);
    if (featureId === this.selected) {
      const anchor = this.site?.anchors.get(featureId);
      if (anchor && this.isResearching(featureId)) this.beam.start(anchor, this.site?.radii.get(featureId) ?? 0.04);
      else this.beam.stop();
    }
  }

  private repaintRings(): void {
    for (const f of this.site?.features ?? []) this.paintRing(f.id);
    this.syncSelection();
  }

  /** Outline, card attachment and scanning beam follow the selection and its research state. */
  private syncSelection(): void {
    const site = this.site;
    const f = this.selected ? site?.features.find((x) => x.id === this.selected) : undefined;
    const anchor = f ? site?.anchors.get(f.id) : undefined;
    if (!site || !f || !anchor) {
      this.outline.hide();
      this.beam.stop();
      this.main.attach(undefined, undefined);
      return;
    }
    this.outline.show(f, site.grid, site.frame, site.minElevation);
    this.main.attach(f.id, this.diorama.toWorld(anchor));
    if (this.isResearching(f.id)) this.beam.start(anchor, site.radii.get(f.id) ?? 0.04);
    else this.beam.stop();
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

function v(p: Vec3): Vector3 {
  return new Vector3(p.x, p.y, p.z);
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
