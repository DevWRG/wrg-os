import type { EventEnvelope, RTier } from "@wrg/types";

const R_TIERS: readonly RTier[] = ["R0", "R1", "R2", "R3", "R4"];

/**
 * Runtime type guard untuk EventEnvelope (ADR-024).
 * Tipe @wrg/types murni compile-time (di-erase), jadi validasi runtime
 * harus eksplisit di sini.
 */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.event_id === "string" &&
    typeof e.correlation_id === "string" &&
    typeof e.causation_id === "string" &&
    typeof e.type === "string" &&
    typeof e.source === "string" &&
    typeof e.occurred_at === "string" &&
    typeof e.use_case_id === "string" &&
    typeof e.r_tier === "string" &&
    R_TIERS.includes(e.r_tier as RTier) &&
    typeof e.schema_version === "string" &&
    typeof e.input_hash === "string" &&
    "payload" in e
  );
}
