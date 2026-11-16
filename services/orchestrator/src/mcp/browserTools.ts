// Read-only browser for the research agents (agents/nexus.yaml `browser` toolset). Unlike `fetch`, it
// renders JavaScript, so it can read NASA/LROC/PDS pages that build their content in the browser.
// It can only open science hosts, never submits forms, and its results are leads, not evidence
// (prompts/_team_rules.md "Web results are leads, not evidence").
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Result } from "@nexus/schemas";
import { CANDIDATE_HOSTS } from "./nexusTools.js";

/** Science hosts the browser may open. Mirrors `science_fetch.allowed_domains` in agents/nexus.yaml. */
export const BROWSER_HOSTS = [...CANDIDATE_HOSTS, "crossref.org", "openalex.org", "semanticscholar.org", "wikipedia.org"];

/** Text pages are cut to this many characters so one page cannot flood an agent's context. */
export const MAX_TEXT = 20_000;

export function browserHostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return BROWSER_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export interface PageView {
  /** URL after redirects; checked against the allow-list again. */
  finalUrl: string;
  title: string;
  text: string;
  links: { text: string; href: string }[];
}

/** The real implementation drives headless Chromium (browserMain.ts); tests pass a fake. */
export interface PageLoader {
  open(url: string): Promise<Result<PageView>>;
  screenshot(url: string): Promise<Result<{ finalUrl: string; png: Buffer }>>;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const url = z.string().url().describe(`https URL on an allowed science host: ${BROWSER_HOSTS.join(", ")}`);

function fail(error: string) {
  return { content: [{ type: "text" as const, text: error }], isError: true };
}

export function buildBrowserToolServer(loader: PageLoader): McpServer {
  const server = new McpServer({ name: "nexus-browser", version: "0.1.0" });

  server.registerTool(
    "browser_open",
    {
      description:
        "Open a science web page in a headless browser (JavaScript rendered) and return its title, readable text and links to other allowed pages. Read-only. The page is a lead, not evidence: never cite its URL in evidenceIds.",
      inputSchema: { url },
      annotations: READ_ONLY,
    },
    async ({ url }) => {
      if (!browserHostAllowed(url)) return fail(`host not allowed; use one of: ${BROWSER_HOSTS.join(", ")}`);
      const res = await loader.open(url);
      if (!res.ok) return fail(res.error);
      if (!browserHostAllowed(res.value.finalUrl)) return fail("the page redirected to a host that is not allowed");
      const { finalUrl, title, text, links } = res.value;
      const body = {
        finalUrl,
        title,
        // Page text is data. Agents are told to ignore instructions inside it (prompts/_team_rules.md).
        text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated]` : text,
        links: links.filter((l) => browserHostAllowed(l.href)).slice(0, 50),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
    },
  );

  server.registerTool(
    "browser_screenshot",
    {
      description: "Take a screenshot of a science web page (for example an LROC or Moon Trek viewer) so you can look at it. Read-only. A screenshot is a lead, not evidence.",
      inputSchema: { url },
      annotations: READ_ONLY,
    },
    async ({ url }) => {
      if (!browserHostAllowed(url)) return fail(`host not allowed; use one of: ${BROWSER_HOSTS.join(", ")}`);
      const res = await loader.screenshot(url);
      if (!res.ok) return fail(res.error);
      if (!browserHostAllowed(res.value.finalUrl)) return fail("the page redirected to a host that is not allowed");
      return {
        content: [
          { type: "text" as const, text: `Screenshot of ${res.value.finalUrl}` },
          { type: "image" as const, data: res.value.png.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  return server;
}
