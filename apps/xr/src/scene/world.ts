// Renderer, lights and a seated room. On Quest the session prefers passthrough (immersive-ar) so the diorama sits on
// the real desk; in VR and in the emulator a dim room and desk stand in.
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
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
  scene.background = new Color(0x101216);
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
  const desk = new Mesh(new BoxGeometry(1.3, 0.04, 0.8), new MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.9 }));
  desk.position.set(t.center.x, t.center.y - 0.03, t.center.z);
  const floor = new Mesh(new BoxGeometry(8, 0.01, 8), new MeshStandardMaterial({ color: 0x15171c }));
  floor.position.y = -0.005;
  const grid = new GridHelper(8, 16, 0x2a2e36, 0x1f2229);
  scene.add(desk, floor, grid);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return { renderer, scene, camera, room: [desk, floor, grid] };
}
