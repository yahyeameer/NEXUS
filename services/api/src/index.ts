import { resolve } from "node:path";
import { Auth } from "./auth.js";
import { EventBus } from "./eventBus.js";
import { loadEvidenceStore } from "./evidenceStore.js";
import { PgStore } from "./pgStore.js";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store.js";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const dataDir = process.env.NEXUS_DATA_DIR ?? resolve(import.meta.dirname, "../../../data");

// Without DATABASE_URL the API runs in memory so the precomputed demo works with no database (AGENTS.md §6).
const store = process.env.DATABASE_URL ? await PgStore.connect(process.env.DATABASE_URL) : new MemoryStore();
const app = buildServer({
  store,
  evidence: await loadEvidenceStore(dataDir),
  auth: new Auth({
    pairingCode: process.env.NEXUS_PAIRING_CODE ?? "",
    serviceTokens: {
      orchestrator: process.env.ORCHESTRATOR_TOKEN,
      "voice-gateway": process.env.VOICE_GATEWAY_TOKEN,
    },
  }),
  bus: new EventBus(),
  allowedOrigins: (process.env.XR_ORIGIN ?? "").split(",").filter(Boolean),
});
app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
