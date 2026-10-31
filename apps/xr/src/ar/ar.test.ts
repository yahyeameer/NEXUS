import { describe, expect, it } from "vitest";
import { angularDistanceDeg, latLonToModel, modelToLatLon, yawToFace } from "../planet/moonModel.js";
import { normalizeLon, regionCentre, siteLocation } from "../planet/regions.js";
import { DEFAULT_TABLE } from "../scene/tabletop.js";
import { grantedFeatures, launchOptions } from "./capabilities.js";
import { isDrag, twoFinger } from "./gestures.js";
import { DEFAULT_STAGE, stageFromPlacement, surfaceToWorld, viewToWorld, yawFacing } from "./stage.js";
import { isHorizontal } from "./surfaceDetection.js";
import type { AppState } from "../app.js";
import { sessionStatusText } from "../web/toolbar.js";

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

describe("stage placement", () => {
  it("the default stage leaves the seated layout exactly where it was", () => {
    const p = { x: 0.38, y: 1.0, z: -0.42 };
    close(viewToWorld(DEFAULT_STAGE, p), p);
    close(surfaceToWorld(DEFAULT_STAGE, DEFAULT_TABLE.center), DEFAULT_TABLE.center);
  });

  it("faces the placed object toward the viewer", () => {
    expect(yawFacing({ x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: 0 })).toBeCloseTo(0);
    expect(yawFacing({ x: 0, y: 0, z: 0 }, { x: 1, y: 1.6, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it("rests the table centre on the tapped point and keeps panels between the viewer and the object", () => {
    // Viewer standing at the origin, Moon placed on the floor two metres to their right.
    const stage = stageFromPlacement({ x: 2, y: 0, z: 0 }, { x: 0, y: 1.6, z: 0 });
    close(surfaceToWorld(stage, DEFAULT_TABLE.center), { x: 2, y: 0, z: 0 });
    const card = viewToWorld(stage, { x: 0, y: 1.0, z: -0.42 });
    // 42 cm toward the object, at the same drop below the eyes as in the seated layout.
    close(card, { x: 0.42, y: 1.4, z: 0 });
  });
});

describe("capabilities", () => {
  it("offers AR only when immersive-ar is supported, and always offers the 3D viewer", () => {
    expect(launchOptions({ webxr: true, immersiveAr: true, secureContext: true }).ar.enabled).toBe(true);
    const noAr = launchOptions({ webxr: true, immersiveAr: false, secureContext: true });
    expect(noAr.ar.enabled).toBe(false);
    expect(noAr.ar.reason).toMatch(/3D/);
    expect(noAr.viewer3d.enabled).toBe(true);
    expect(launchOptions({ webxr: false, immersiveAr: false, secureContext: true }).ar.reason).toMatch(/WebXR/);
    expect(launchOptions({ webxr: true, immersiveAr: true, secureContext: false }).ar.enabled).toBe(false);
  });

  it("reads granted features without assuming optional ones", () => {
    expect(grantedFeatures(["hit-test", "anchors", "local-floor"])).toMatchObject({ hitTest: true, anchors: true, localFloor: true, domOverlay: false });
    expect(grantedFeatures(undefined)).toMatchObject({ hitTest: true, anchors: false, domOverlay: false });
    expect(grantedFeatures(undefined, [])).toMatchObject({ hitTest: false });
  });
});

describe("touch gestures", () => {
  it("measures pinch scale and twist between two fingers", () => {
    const g = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(g.scale).toBeCloseTo(2);
    expect(g.rotation).toBeCloseTo(0);
    // Screen y grows downward: the second finger moving down is a clockwise twist, a negative world yaw.
    const t = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
    expect(t.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it("separates taps from drags", () => {
    expect(isDrag(3, 4)).toBe(false);
    expect(isDrag(8, 8)).toBe(true);
  });
});

describe("surfaces", () => {
  it("accepts tables and floors, not walls", () => {
    expect(isHorizontal(1)).toBe(true);
    expect(isHorizontal(0.85)).toBe(true);
    expect(isHorizontal(0.2)).toBe(false);
  });
});

describe("moon globe frame", () => {
  it("puts the near side on -Z, east on -X and north on +Y (provenance.json orientation)", () => {
    close(latLonToModel(0, 0), { x: 0, y: 0, z: -1 });
    close(latLonToModel(0, 90), { x: -1, y: 0, z: 0 });
    close(latLonToModel(90, 0), { x: 0, y: 1, z: 0 });
  });

  it("round-trips lat/lon and turns a longitude to face the viewer", () => {
    const back = modelToLatLon(latLonToModel(26.1, 3.6));
    expect(back.lat).toBeCloseTo(26.1, 6);
    expect(back.lon).toBeCloseTo(3.6, 6);
    // Turning by yawToFace(lon) brings that longitude round to +Z.
    const d = latLonToModel(0, 40);
    const yaw = yawToFace(40);
    expect(-Math.sin(yaw) * d.x + Math.cos(yaw) * d.z).toBeCloseTo(1, 6);
    expect(angularDistanceDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90, 6);
  });
});

describe("site locations from evidence", () => {
  const pack = {
    siteId: "HADLEY_RILLE",
    version: 1,
    items: [
      { id: "EV-HADLEY_RILLE-003", siteId: "HADLEY_RILLE", type: "text" as const, title: "t", spokenLabel: "s", sourceUrl: "https://example.org/a", credit: "c", license: "l" },
      {
        id: "EV-HADLEY_RILLE-001",
        siteId: "HADLEY_RILLE",
        type: "dataset" as const,
        title: "t",
        spokenLabel: "s",
        sourceUrl: "https://example.org/b",
        credit: "c",
        license: "l",
        region: { bbox: [-356.47, 26.04, -356.37, 26.14] as [number, number, number, number], crs: "planetocentric longitude/latitude, degrees (west, south, east, north)" },
      },
    ],
  };

  it("takes the bbox centre of the first item that has one, folding longitudes into ±180°", () => {
    const loc = siteLocation(pack);
    expect(loc?.evidenceId).toBe("EV-HADLEY_RILLE-001");
    expect(loc?.lat).toBeCloseTo(26.09, 6);
    expect(loc?.lon).toBeCloseTo(3.58, 6);
    expect(normalizeLon(-356.42)).toBeCloseTo(3.58, 6);
    expect(normalizeLon(190)).toBeCloseTo(-170, 6);
  });

  it("marks nearby sites as one region", () => {
    expect(regionCentre([])).toBeUndefined();
    expect(regionCentre([{ siteId: "A", lat: 26, lon: 3.5, evidenceId: "x" }, { siteId: "B", lat: 26.2, lon: 3.7, evidenceId: "y" }])).toEqual({ lat: 26.1, lon: 3.6 });
  });
});

describe("session status line", () => {
  const base = { mode: "ar", phase: "placed", surface: "xr-hit-test", surfaceFound: false, anchor: "fixed", tracking: true, environment: "globe", regionMarked: true };
  const status = (ar: Partial<typeof base>) => sessionStatusText({ ar: { ...base, ...ar } } as unknown as AppState);

  it("never calls the 3D viewer AR, and says when placement had no surface to find", () => {
    expect(status({ mode: "viewer" })).toBe("3D viewer · not AR");
    expect(status({ phase: "placing" })).toMatch(/finding a surface/);
    expect(status({ phase: "placing", surfaceFound: true })).toMatch(/tap to place/);
    expect(status({ anchor: "xr-anchor" })).toBe("AR · anchored");
    expect(status({ tracking: false, anchor: "xr-anchor" })).toMatch(/tracking lost/);
    expect(status({ surface: "none" })).toMatch(/no surface detection/);
  });
});
