// Renderer, lights and a seated room. On Quest the session prefers passthrough (immersive-ar) so the diorama sits on
// the real desk; in VR and in the emulator a dim room and desk stand in.
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { Object3D } from "three";
import { DEFAULT_TABLE } from "./tabletop.js";

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Hidden in passthrough. */
  room: Object3D[];
}

export function createWorld(container: HTMLElement): World {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  // Fixed foveation keeps fill-rate inside the 72 fps budget on Quest (AGENTS.md §6).
  renderer.xr.setFoveation(1);
  container.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x060912);
  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  // Seated eye height; the XR session replaces this pose with the headset's.
  camera.position.set(0, 1.2, 0);
  camera.lookAt(0, 0.85, -0.7);

  scene.add(new AmbientLight(0xffffff, 0.55));
  // Low sun from the west, like the long shadows in the LROC orthophoto, so relief reads on the diorama.
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 1.4, -0.4);
  scene.add(sun);

  const t = DEFAULT_TABLE;
  // A dark plinth with a lit cyan edge, floating in a field of stars: the terrain is the brightest thing in the room.
  const plinthGeometry = new BoxGeometry(0.94, 0.04, 0.94);
  const plinth = new Mesh(plinthGeometry, new MeshStandardMaterial({ color: 0x141b2e, roughness: 0.35, metalness: 0.6 }));
  plinth.position.set(t.center.x, t.center.y - 0.03, t.center.z);
  const edge = new LineSegments(new EdgesGeometry(plinthGeometry), new LineBasicMaterial({ color: 0x37d6ff }));
  edge.position.copy(plinth.position);
  const floor = new Mesh(new CircleGeometry(6, 64), new MeshBasicMaterial({ map: floorGlow(), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  const stars = starField(1400);
  scene.add(plinth, edge, floor, stars);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return { renderer, scene, camera, room: [plinth, edge, floor, stars] };
}

/** A soft blue pool of light on the floor under the plinth, fading to nothing so the floor has no visible edge. */
function floorGlow(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(55, 160, 255, 0.38)");
    g.addColorStop(0.35, "rgba(40, 80, 170, 0.14)");
    g.addColorStop(1, "rgba(10, 16, 40, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Deterministic stars (a fixed LCG), so screenshots and tests do not shimmer between runs. */
function starField(count: number): Points {
  const pos = new Float32Array(count * 3);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 6;
    const q = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(a) * q * r;
    pos[i * 3 + 1] = Math.abs(u) * r + 1;
    pos[i * 3 + 2] = Math.sin(a) * q * r;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  return new Points(g, new PointsMaterial({ color: 0xcfe2ff, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
}
