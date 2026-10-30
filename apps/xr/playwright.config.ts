import { defineConfig } from "@playwright/test";

// XR flows run in the IWER emulator against the real local stack (docs/TESTING.md "XR emulated"): the tests move the
// emulated hands, so every flow here is completed hands-only unless the test is about the voice shortcut.
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    viewport: { width: 800, height: 500 },
    permissions: ["microphone"],
    trace: "retain-on-failure",
    launchOptions: {
      // A preinstalled Chromium can stand in for `playwright install` (e.g. PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium).
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      // Software WebGL for headless runs, and a fake mic so push-to-talk streams real audio frames.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    // The whole emulator stack (scripts/devXr.mjs) with in-memory state, so every run starts clean.
    command: "pnpm --dir ../.. dev:xr",
    url: "https://localhost:5173/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXUS_PAIRING_CODE: "1234" },
  },
});
