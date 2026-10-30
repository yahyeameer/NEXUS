import { buildServer } from "./server.js";

const port = Number(process.env.VOICE_GATEWAY_PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildServer();
app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
