import { describe, expect, it } from "vitest";
import { askAboutFinding, askAvailable } from "./askApi.js";

const respond = (body: unknown, init: ResponseInit = {}) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" }, ...init })) as unknown as typeof fetch;

describe("askApi", () => {
  it("is available only where the function answers in JSON", async () => {
    expect(await askAvailable(respond({ ok: true, value: { available: true, live: true } }))).toBe(true);
    // A static host serves its HTML page for unknown paths.
    expect(await askAvailable(respond("<!doctype html>"))).toBe(false);
    expect(await askAvailable(respond({ ok: false }, { status: 404 }))).toBe(false);
    expect(await askAvailable((async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch)).toBe(false);
  });

  it("accepts only answers that match the schema", async () => {
    const approved = { kind: "approved", script: "Overall uncertainty is low.", sentenceEvidence: [[]], sieDecisionId: "SIE-1", speechRate: 1, source: "live" };
    expect(await askAboutFinding("F", "summary", respond({ ok: true, value: approved }))).toEqual({ ok: true, value: approved });
    expect(await askAboutFinding("F", "summary", respond({ ok: true, value: { kind: "approved", script: "unchecked" } }))).toEqual({ ok: false, error: "unexpected answer" });
    expect(await askAboutFinding("F", "summary", respond({ ok: false, error: "x" }, { status: 503 }))).toEqual({ ok: false, error: "ask 503" });
  });
});
