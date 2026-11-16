// stdio entry for the read-only research browser. Started by docker-agent from `mcps.browser` in agents/nexus.yaml.
// stdout carries the MCP protocol, so nothing else may write to it.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, type Browser, type Page } from "playwright-core";
import type { Result } from "@nexus/schemas";
import { browserHostAllowed, buildBrowserToolServer, type PageLoader, type PageView } from "./browserTools.js";

const NAV_TIMEOUT_MS = 20_000;
let browser: Promise<Browser> | undefined;

function launch(): Promise<Browser> {
  // NEXUS_CHROMIUM_PATH points at the image's Chromium (infra/Dockerfile.agents); without it Playwright's own is used.
  browser ??= chromium.launch({ headless: true, executablePath: process.env.NEXUS_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  return browser;
}

async function withPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<Result<T>> {
  const context = await (await launch()).newContext({ acceptDownloads: false, javaScriptEnabled: true, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    // Read-only: no form posts or other writes, and no navigating (including frames) off the science hosts.
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.abort();
      if (req.isNavigationRequest() && !browserHostAllowed(req.url())) return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    return { ok: true, value: await fn(page) };
  } catch (e) {
    return { ok: false, error: `could not open page: ${e instanceof Error ? e.message.split("\n")[0] : "unknown error"}` };
  } finally {
    await context.close().catch(() => undefined);
  }
}

const loader: PageLoader = {
  open: (url) =>
    withPage<PageView>(url, async (page) => ({
      finalUrl: page.url(),
      title: await page.title(),
      text: await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
      // A string expression keeps DOM types out of this Node-only package.
      links: await page.evaluate<{ text: string; href: string }[]>(
        "Array.from(document.querySelectorAll('a[href]')).map((a) => ({ text: (a.textContent || '').trim().slice(0, 120), href: a.href })).filter((l) => l.text.length > 0)",
      ),
    })),
  screenshot: (url) => withPage(url, async (page) => ({ finalUrl: page.url(), png: await page.screenshot({ type: "png" }) })),
};

const server = buildBrowserToolServer(loader);
server.connect(new StdioServerTransport()).catch((err: unknown) => {
  process.stderr.write(`nexus-browser failed to start: ${String(err)}\n`);
  process.exit(1);
});
const close = () => void (browser ? browser.then((b) => b.close()) : Promise.resolve()).finally(() => process.exit(0));
process.on("SIGTERM", close);
process.stdin.on("close", close);
