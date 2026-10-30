import { defineConfig } from "@playwright/test";

// XR flows run against the IWER emulator once IWSDK is wired in (docs/TESTING.md).
export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    // Point at a preinstalled Chromium instead of `playwright install` when needed.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
  webServer: {
    command: "pnpm dev",
    url: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
  },
});
