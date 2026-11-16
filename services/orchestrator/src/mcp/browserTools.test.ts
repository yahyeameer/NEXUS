import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { browserHostAllowed, buildBrowserToolServer, MAX_TEXT, type PageLoader } from "./browserTools.js";

// Fake loader: no network. URLs are only checked against the allow-list.
function connect(loader: PageLoader) {
  const server = buildBrowserToolServer(loader);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  return Promise.all([server.connect(a), client.connect(b)]).then(() => client);
}

const okLoader = (finalUrl?: string, text = "page text"): PageLoader => ({
  open: async (url) => ({ ok: true, value: { finalUrl: finalUrl ?? url, title: "T", text, links: [{ text: "in", href: "https://www.nasa.gov/x" }, { text: "out", href: "https://example.com/y" }] } }),
  screenshot: async (url) => ({ ok: true, value: { finalUrl: finalUrl ?? url, png: Buffer.from("png") } }),
});

describe("browser tools", () => {
  it("allows https science hosts only", () => {
    expect(browserHostAllowed("https://www.lroc.asu.edu/")).toBe(true);
    expect(browserHostAllowed("https://trek.nasa.gov/moon/")).toBe(true);
    expect(browserHostAllowed("http://www.nasa.gov/")).toBe(false);
    expect(browserHostAllowed("https://nasa.gov.evil.example/")).toBe(false);
    expect(browserHostAllowed("not a url")).toBe(false);
  });

  it("exposes only the two read-only tools", async () => {
    const client = await connect(okLoader());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["browser_open", "browser_screenshot"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("refuses hosts off the list without loading them", async () => {
    let loaded = false;
    const client = await connect({ ...okLoader(), open: async () => ((loaded = true), { ok: false, error: "x" }) });
    const res = await client.callTool({ name: "browser_open", arguments: { url: "https://example.com/" } });
    expect(res.isError).toBe(true);
    expect(loaded).toBe(false);
  });

  it("refuses a page that redirected off the list", async () => {
    const client = await connect(okLoader("https://example.com/landing"));
    const res = await client.callTool({ name: "browser_open", arguments: { url: "https://www.nasa.gov/" } });
    expect(res.isError).toBe(true);
  });

  it("truncates long text and drops links to other hosts", async () => {
    const client = await connect(okLoader(undefined, "a".repeat(MAX_TEXT + 10)));
    const res = await client.callTool({ name: "browser_open", arguments: { url: "https://www.nasa.gov/" } });
    const body = JSON.parse((res.content as { text: string }[])[0]?.text ?? "{}") as { text: string; links: { href: string }[] };
    expect(body.text.endsWith("[truncated]")).toBe(true);
    expect(body.links.map((l) => l.href)).toEqual(["https://www.nasa.gov/x"]);
  });

  it("returns screenshots as images", async () => {
    const client = await connect(okLoader());
    const res = await client.callTool({ name: "browser_screenshot", arguments: { url: "https://www.lroc.asu.edu/" } });
    expect((res.content as { type: string }[]).map((c) => c.type)).toEqual(["text", "image"]);
  });
});
