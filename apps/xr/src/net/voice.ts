// Headset ↔ services/voice-gateway (VOICE.md §2). JSON control messages plus binary PCM frames during push-to-talk.
import { voiceServerMessage } from "@nexus/schemas";
import type { VoiceClientMessage, VoiceServerMessage } from "@nexus/schemas";
import { VOICE_URL, wsUrl } from "../config.js";

export class VoiceClient {
  private socket?: WebSocket;
  private ready = false;
  private lastContext?: VoiceClientMessage;

  constructor(private readonly onMessage: (m: VoiceServerMessage) => void) {}

  get connected(): boolean {
    return this.ready;
  }

  connect(token: string, sessionId: string): void {
    const socket = new WebSocket(wsUrl(VOICE_URL));
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token, sessionId }));
    socket.onmessage = (m) => {
      const parsed = voiceServerMessage.safeParse(safeJson(String(m.data)));
      if (!parsed.success) return;
      if (parsed.data.type === "ready") {
        this.ready = true;
        if (this.lastContext) this.send(this.lastContext);
      }
      this.onMessage(parsed.data);
    };
    // Voice is optional (AGENTS.md rule 1): without the gateway the app keeps working by hand, so retry quietly.
    socket.onclose = () => {
      this.ready = false;
      if (this.socket === socket) setTimeout(() => this.connect(token, sessionId), 3000);
    };
  }

  send(m: VoiceClientMessage): void {
    if (m.type === "context") this.lastContext = m;
    if (this.ready) this.socket?.send(JSON.stringify(m));
  }

  audio(chunk: Uint8Array): void {
    if (this.ready) this.socket?.send(chunk);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
