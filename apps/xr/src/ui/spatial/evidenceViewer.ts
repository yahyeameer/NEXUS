// EvidenceViewer: the evidence window beside a finding card. It shows one evidence item or measurement exactly as the
// store has it, with credit, licence and archival label, and an evidence beam (SpatialConnector) to the rock it supports.
import type { EvidenceItem, MeasurementRecord } from "@nexus/schemas";
import type { Vector3 } from "three";
import { SpatialGlassPanel } from "./glassPanel.js";
import type { PanelContent, PanelLine } from "./glassPanel.js";
import { SpatialConnector } from "./spatialConnector.js";

/** What the window says about `id`. Pure: no claim is made here that the store does not hold (AGENTS.md rule 3). */
export function evidenceContent(id: string, items: readonly EvidenceItem[], measurements: readonly MeasurementRecord[], image?: PanelContent["image"]): PanelContent {
  const lines: PanelLine[] = [];
  const item = items.find((i) => i.id === id);
  const m = measurements.find((x) => x.id === id);
  if (item) {
    lines.push({ text: item.title, tone: "title", badge: item.id });
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
  return { lines, rows: [[{ id: "evwin:close", label: "Close" }]], image: item?.type === "image" ? image : undefined };
}

export class EvidenceViewer extends SpatialGlassPanel {
  /** Evidence beam from the window to the feature it supports. */
  readonly beam = new SpatialConnector("evidence-beam");
  private readonly corner = { x: 0, y: 0 };

  constructor() {
    super("evidence", 0.34, 0.4);
    this.setOpen(false);
    // Lower inner corner (towards the diorama), in panel-local metres from the centre.
    this.corner.x = this.widthM / 2 - 0.02;
    this.corner.y = -this.heightM / 2 + 0.02;
  }

  /** Ties the beam from the window's lower inner corner to `anchorWorld`; hides it when there is no anchor. */
  link(anchorWorld: Vector3 | undefined, scratch: Vector3): void {
    if (!anchorWorld || !this.isOpen) {
      if (this.beam.shown) this.beam.hide();
      return;
    }
    this.mesh.updateWorldMatrix(true, false);
    scratch.set(this.corner.x, this.corner.y, 0);
    this.mesh.localToWorld(scratch);
    this.beam.set(scratch, anchorWorld, 0.04);
    if (!this.beam.shown) this.beam.show();
  }
}
