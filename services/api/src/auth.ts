// SECURITY_PRIVACY.md: all APIs authenticated; review endpoints need a human session, agent/service tokens are rejected.
import { randomBytes, timingSafeEqual } from "node:crypto";

export type Principal =
  | { kind: "human"; userId: string; sessionId: string }
  | { kind: "service"; service: "orchestrator" | "voice-gateway" };

export interface AuthConfig {
  /** Shown on the operator console; the headset enters it once to open a human session. */
  pairingCode: string;
  /** Static backend tokens, from env only. */
  serviceTokens: Partial<Record<"orchestrator" | "voice-gateway", string>>;
}

export class Auth {
  private sessions = new Map<string, Extract<Principal, { kind: "human" }>>();

  constructor(private readonly config: AuthConfig) {}

  /** Opens a human session. Returns undefined for a wrong pairing code. */
  openSession(pairingCode: string, userId: string): { token: string; sessionId: string } | undefined {
    if (!this.config.pairingCode || !safeEqual(pairingCode, this.config.pairingCode)) return undefined;
    const token = randomBytes(24).toString("base64url");
    const sessionId = `S-${randomBytes(6).toString("hex")}`;
    this.sessions.set(token, { kind: "human", userId, sessionId });
    return { token, sessionId };
  }

  resolve(header: string | undefined): Principal | undefined {
    const token = header?.startsWith("Bearer ") ? header.slice(7) : header;
    if (!token) return undefined;
    const human = this.sessions.get(token);
    if (human) return human;
    for (const [service, t] of Object.entries(this.config.serviceTokens)) {
      if (t && safeEqual(token, t)) return { kind: "service", service: service as "orchestrator" | "voice-gateway" };
    }
    return undefined;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
