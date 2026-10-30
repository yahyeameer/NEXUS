import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const API = process.env.API_URL ?? "http://localhost:4000";
const VOICE = process.env.VOICE_GATEWAY_URL ?? "http://localhost:4100";

// WebXR on Quest Browser needs HTTPS, so dev serves over TLS on the LAN (ARCHITECTURE.md, port 5173).
// The services sit behind the same origin, so a headset on the LAN needs only this one address.
export default defineConfig({
  plugins: [basicSsl()],
  // Terrain tiles, textures and features are served from the repo's data/ folder (data/terrain/<SITE_ID>).
  publicDir: "../../data",
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API, ws: true, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/voice": { target: VOICE, ws: true, changeOrigin: true },
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
});
