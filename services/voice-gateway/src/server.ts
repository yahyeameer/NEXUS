import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { voiceClientMessage } from "@nexus/schemas";
import type { ReasoningAdapter } from "./adapters/reasoningAdapter.js";
import type { SpeechToTextAdapter, TextToSpeechAdapter } from "./adapters/speechAdapter.js";
import { FakeSpeechToText, SilentTextToSpeech } from "./adapters/speechAdapter.js";
import type { Api } from "./apiClient.js";
import { VoiceSession } from "./voiceSession.js";

export interface GatewayDeps {
  api?: Api;
  stt: SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
  reasoning?: ReasoningAdapter;
  /** Dev and emulator only: each socket gets its own scripted STT fed by `ptt.simulated_transcript`. */
  simulatedSpeech?: boolean;
}

/** Max audio frame size; anything larger is dropped rather than buffered. */
const MAX_FRAME_BYTES = 64 * 1024;

export function buildServer(deps: GatewayDeps = { stt: new FakeSpeechToText(), tts: new SilentTextToSpeech() }) {
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { base: { service: "voice-gateway" } } });
  app.get("/health", async () => ({ ok: true, service: "voice-gateway" }));

  void app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });
  void app.register(async (scope) => {
    scope.get("/voice", { websocket: true }, (socket, req) => {
      const api = deps.api;
      if (!api) {
        socket.close(1011, "api not configured");
        return;
      }
      const simulated = deps.simulatedSpeech ? new FakeSpeechToText() : undefined;
      const session = new VoiceSession({
        api,
        stt: simulated ?? deps.stt,
        tts: deps.tts,
        reasoning: deps.reasoning,
        send: (m) => socket.send(JSON.stringify(m)),
      });
      // Handle messages in order so ptt.end never overtakes its audio frames.
      let queue = Promise.resolve();
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        queue = queue.then(async () => {
          if (isBinary) {
            if (session.authenticated) session.audio(new Uint8Array(data));
            return;
          }
          let raw: unknown;
          try {
            raw = JSON.parse(data.toString());
          } catch {
            raw = undefined;
          }
          const msg = voiceClientMessage.safeParse(raw);
          if (!msg.success) return socket.send(JSON.stringify({ type: "error", message: "invalid message" }));
          if (msg.data.type === "ptt.simulated_transcript") {
            if (!simulated || !session.authenticated) return socket.send(JSON.stringify({ type: "error", message: "simulated speech is disabled" }));
            simulated.say(msg.data.text);
            return;
          }
          try {
            await session.handle(msg.data);
          } catch (e) {
            // Structured log without transcript or audio content.
            req.log.error({ err: e instanceof Error ? e.message : "unknown" }, "voice session error");
            socket.send(JSON.stringify({ type: "error", message: "internal error" }));
          }
        });
      });
    });
  });
  return app;
}
