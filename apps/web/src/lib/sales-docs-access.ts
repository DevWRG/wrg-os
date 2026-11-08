// Sales Docs (A6) — body yang diteruskan BFF ke apps/api.
// Identitas pelaku (approver_id; field identitas lain ikut dibuang)
// SELALU dari sesi: field kiriman klien dibuang lalu diisi actorName(me).
// x-user-id juga diteruskan ke apps/api (jejak pelaku sesi).

export const FIELD_IDENTITAS = ["approver_id", "reviewer_id", "confirmed_by", "created_by"] as const;
export type FieldIdentitas = (typeof FIELD_IDENTITAS)[number];

export function bodyDenganPelaku(
  body: unknown,
  field: FieldIdentitas | null,
  actor: string,
): Record<string, unknown> {
  const src = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!(FIELD_IDENTITAS as readonly string[]).includes(k)) out[k] = v;
  }
  if (field) out[field] = actor;
  return out;
}
