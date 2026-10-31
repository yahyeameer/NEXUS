// Renderer, camera and lights. NEXUS is an AR application: there is no virtual room, floor or sky. In AR the
// camera passthrough is the background; in the 3D viewer the page's plain graphite backdrop shows through the
// transparent canvas (src/web/style.css), which never pretends to be a camera feed.
import { AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from "three";

export interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export function createWorld(container: HTMLElement): World {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  // Fixed foveation keeps fill-rate inside the 72 fps budget on Quest (AGENTS.md §6).
  renderer.xr.setFoveation(1);
  container.append(renderer.domElement);

  const scene = new Scene();
  scene.background = null;
  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  // Seated eye height; the XR session replaces this pose with the headset's or phone's.
  camera.position.set(0, 1.2, 0);
  camera.lookAt(0, 0.85, -0.7);

  // Soft sky/ground fill so the model sits in a real room's light, plus a low sun from the west, like the long
  // shadows in the LROC orthophoto, so relief reads on the terrain.
  scene.add(new HemisphereLight(0xdfe8f5, 0x2a2622, 0.5));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 1.4, -0.4);
  scene.add(sun);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return { renderer, scene, camera };
}
