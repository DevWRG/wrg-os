import type { EventEnvelope } from "@wrg/types";

import { db } from "../db.js";

// Persist EventEnvelope (ADR-024) ke audit_log sebagai Layer 2 (Input).
// audit_log append-only (rule no-update/no-delete di schema D6 Governance).
export async function insertAuditEvent(e: EventEnvelope): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO audit_log
      (use_case_id, session_id, correlation_id, layer, event_type, r_tier, input_hash, payload, occurred_at)
    VALUES
      (${e.use_case_id}, ${e.correlation_id}, ${e.correlation_id}, 2, ${e.type},
       ${e.r_tier}, ${e.input_hash.slice(0, 64)}, ${sql.json(e.payload as Parameters<typeof sql.json>[0])}, ${e.occurred_at})
    RETURNING id
  `;
  return rows[0].id as string;
}
