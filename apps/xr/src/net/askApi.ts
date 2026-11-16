// Client for POST /api/ask (apps/xr/functions/api/ask.ts): fixed questions about the selected finding, answered on
// the server and approved by the SIE before they come back. No key and no model call here (AGENTS.md rule 6).
import { askAnswer } from "@nexus/schemas";
import type { AskAnswer, AskQuestionId, Result } from "@nexus/schemas";

/** Short chip labels for the four fixed questions (packages/schemas ASK_QUESTIONS), in panel order. */
export const ASK_CHIPS: readonly { id: AskQuestionId; label: string }[] = [
  { id: "summary", label: "What it shows" },
  { id: "measurements", label: "Measurements" },
  { id: "image", label: "The image" },
  { id: "certainty", label: "How certain?" },
];

const ASK_URL = "/api/ask";
const TIMEOUT_MS = 20_000;

/** True only where the edge function is deployed; a plain static host answers with its own page or a 404. */
export async function askAvailable(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(ASK_URL, { headers: { accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return false;
    const body = (await res.json()) as { ok?: unknown; value?: { available?: unknown } };
    return body.ok === true && body.value?.available === true;
  } catch {
    return false;
  }
}

export async function askAboutFinding(findingId: string, questionId: AskQuestionId, fetchFn: typeof fetch = fetch): Promise<Result<AskAnswer>> {
  try {
    const res = await fetchFn(ASK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId, questionId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json()) as { ok?: unknown; value?: unknown };
    if (body.ok !== true) return { ok: false, error: `ask ${res.status}` };
    const parsed = askAnswer.safeParse(body.value);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "unexpected answer" };
  } catch {
    return { ok: false, error: "ask unreachable" };
  }
}
