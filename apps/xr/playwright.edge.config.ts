import { defineConfig } from "@playwright/test";

// The standalone build with its Cloudflare function, against a running deployment or `wrangler pages dev`:
//   EDGE_BASE_URL=https://<preview>.nexus-91f.pages.dev pnpm --filter @nexus/xr test:e2e:edge
// No local stack: this checks what the headset gets from Cloudflare.
export default defineConfig({
  testDir: "e2e",
  testMatch: /ask\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.EDGE_BASE_URL ?? "http://localhost:8788",
    ignoreHTTPSErrors: true,
    viewport: { width: 800, height: 500 },
    trace: "off",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
});
