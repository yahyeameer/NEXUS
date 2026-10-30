import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { base: { service: "voice-gateway" } } });
  app.get("/health", async () => ({ ok: true, service: "voice-gateway" }));
  return app;
}
