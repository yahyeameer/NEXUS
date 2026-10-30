import { FakeSpeechToText, SilentTextToSpeech } from "./adapters/speechAdapter.js";
import { HttpApi } from "./apiClient.js";
import { buildServer } from "./server.js";

const port = Number(process.env.VOICE_GATEWAY_PORT ?? 4100);
const host = process.env.HOST ?? "0.0.0.0";

// Real STT/TTS and reasoning adapters plug in here once providers are chosen (docs/TASKS.md Phase 1 bake-off).
// Until then the gateway runs with captions only, which the headset already handles (VOICE.md §11).
const app = buildServer({
  api: new HttpApi(process.env.API_URL ?? "http://localhost:4000", process.env.VOICE_GATEWAY_TOKEN ?? ""),
  stt: new FakeSpeechToText(),
  tts: new SilentTextToSpeech(),
  // `pnpm dev:xr` sets this so the desktop emulator can type what it would say (docs/TESTING.md).
  simulatedSpeech: process.env.NEXUS_SIMULATED_STT === "1",
});
app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
