import Fastify from "fastify";
import type { Dispatcher } from "./dispatcher.js";

export function buildServer(dispatcher?: Dispatcher) {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { base: { service: "orchestrator" } } });
  app.get("/health", async () => ({ ok: true, service: "orchestrator" }));
  // Ids and counts only: no outputs, prompts or transcripts.
  app.get("/status", async () => ({ ok: true, value: dispatcher?.state ?? { queued: [], completed: 0, failed: 0 } }));
  return app;
}
