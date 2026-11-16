// Cloudflare Pages Function: POST /api/ask for the standalone build (see src/edge/askHandler.ts for the rules).
// GEMINI_API_KEY is an encrypted Cloudflare secret; it never reaches the headset (AGENTS.md rule 6).
// GET /api/ask tells the headset whether asking is available, so the static-only build simply hides the button.
import { demoBundle, savedAnswers } from "@nexus/schemas";
import type { AskAnswer, DemoBundle, SavedAnswers } from "@nexus/schemas";
import { GeminiReasoning } from "../../../../services/voice-gateway/src/adapters/geminiReasoningAdapter.js";
import { answerAsk } from "../../src/edge/askHandler.js";
import { VOICE_PROMPTS } from "../../src/edge/prompts.generated.js";

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ASSETS: { fetch(input: Request | string | URL): Promise<Response> };
}
interface Context {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}

/** Edge cache for approved answers, so repeated demo questions are instant and spend no model quota. */
const CACHE_SECONDS = 3600;
const MAX_BODY_BYTES = 2048;

let bundleMemo: Promise<DemoBundle | undefined> | undefined;
let savedMemo: Promise<SavedAnswers | undefined> | undefined;

async function asset<T>(env: Env, request: Request, path: string, parse: (v: unknown) => T): Promise<T | undefined> {
  try {
    const res = await env.ASSETS.fetch(new URL(path, request.url));
    return res.ok ? parse(await res.json()) : undefined;
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
}

export const onRequestGet = ({ env }: Context): Response => json({ ok: true, value: { available: true, live: Boolean(env.GEMINI_API_KEY) } });

export const onRequestPost = async ({ request, env, waitUntil }: Context): Promise<Response> => {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ ok: false, error: "expected JSON" }, 415);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "request too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  bundleMemo ??= asset(env, request, "/demo/bundle.json", (v) => demoBundle.parse(v));
  savedMemo ??= asset(env, request, "/demo/answers.json", (v) => savedAnswers.parse(v));
  const bundle = await bundleMemo;
  if (!bundle) {
    bundleMemo = undefined;
    return json({ ok: false, error: "demo bundle unavailable" }, 503);
  }

  // Only approved answers are cached; the key is the finding and the fixed question, nothing the user typed.
  const b = body as { findingId?: unknown; questionId?: unknown };
  const cacheKey = typeof b.findingId === "string" && typeof b.questionId === "string" ? new Request(new URL(`/__ask-cache/${encodeURIComponent(b.findingId)}/${encodeURIComponent(b.questionId)}`, request.url)) : undefined;
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) return json(await hit.json(), 200, { "x-nexus-ask": "cache" });
  }

  const reasoning = env.GEMINI_API_KEY ? new GeminiReasoning({ prompts: VOICE_PROMPTS, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined }) : undefined;
  const out = await answerAsk(body, { bundle, reasoning, saved: await savedMemo });
  console.log(JSON.stringify({ msg: "ask.answered", ...out.log }));

  const value = out.body.ok ? (out.body.value as AskAnswer) : undefined;
  if (cache && cacheKey && value?.kind === "approved") {
    waitUntil(cache.put(cacheKey, new Response(JSON.stringify(out.body), { headers: { "content-type": "application/json", "cache-control": `max-age=${CACHE_SECONDS}` } })));
  }
  return json(out.body, out.status, { "x-nexus-ask": out.log.result });
};
