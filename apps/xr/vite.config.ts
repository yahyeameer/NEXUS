import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// WebXR on Quest Browser needs HTTPS, so dev serves over TLS on the LAN (ARCHITECTURE.md, port 5173).
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173, strictPort: true },
});
