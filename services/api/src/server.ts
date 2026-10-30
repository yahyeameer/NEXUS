import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { base: { service: "api" } } });
  app.get("/health", async () => ({ ok: true, service: "api" }));
  return app;
}
