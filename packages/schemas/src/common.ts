import { z } from "zod";

/** ISO-8601 UTC timestamp. */
export const isoTimestamp = z.string().datetime();

export const claimType = z.enum(["observation", "measurement", "interpretation", "hypothesis"]);
export type ClaimType = z.infer<typeof claimType>;

export const uncertainty = z.object({
  level: z.enum(["low", "medium", "high"]),
  explanation: z.string().min(1),
});
export type Uncertainty = z.infer<typeof uncertainty>;

/** Typed result across service boundaries (AGENTS.md §7). */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
