// ScientificFindingPanel: the main glass card. It docks at a comfortable reading spot (INTERACTION.md §3) but belongs
// to the rock it is about: when a feature is selected it rises out of that feature and glides to its dock, and a
// SpatialConnector keeps it tied to the feature while it stays selected.
import type { ScientificFinding } from "@nexus/schemas";
import { Vector3 } from "three";
import { cardModel } from "../findingView.js";
import { decisionControls } from "./decisionControls.js";
import { SpatialGlassPanel } from "./glassPanel.js";
import type { PanelContent } from "./glassPanel.js";
import { SpatialConnector } from "./spatialConnector.js";

/** A finding card's lines and buttons. Pure apart from reading the finding. */
export function findingContent(f: ScientificFinding, speaking: boolean): PanelContent {
  const card = cardModel(f);
  return { lines: [...card.lines], rows: decisionControls(card, speaking) };
}

export class ScientificFindingPanel extends SpatialGlassPanel {
  readonly connector = new SpatialConnector("finding");
  private readonly dock = new Vector3();
  private readonly face = new Vector3();
  private readonly corner = new Vector3();
  private attachedTo?: string;

  constructor(dock: Vector3, face: Vector3) {
    super("main", 0.4, 0.42);
    this.dock.copy(dock);
    this.face.copy(face);
    this.place(dock, face);
  }

  /**
   * Attaches the card to `featureId` at `anchorWorld`. A new feature makes the card rise from it and glide back to
   * the dock; `undefined` detaches it and the connector fades.
   */
  attach(featureId: string | undefined, anchorWorld: Vector3 | undefined): void {
    if (featureId === this.attachedTo) return;
    this.attachedTo = featureId;
    if (!featureId || !anchorWorld) {
      this.connector.hide();
      return;
    }
    this.glideTo(this.dock, this.face, anchorWorld.clone().setY(anchorWorld.y + 0.12));
    this.connector.show();
  }

  get attachedFeature(): string | undefined {
    return this.attachedTo;
  }

  /** Per frame while attached: the connector runs from the card's lower inner corner to the feature. */
  link(anchorWorld: Vector3 | undefined): void {
    if (!this.attachedTo || !anchorWorld) return;
    this.mesh.updateWorldMatrix(true, false);
    this.corner.set(-this.widthM / 2 + 0.02, -this.heightM / 2 + 0.02, 0);
    this.mesh.localToWorld(this.corner);
    this.connector.set(this.corner, anchorWorld, 0.05);
  }
}
