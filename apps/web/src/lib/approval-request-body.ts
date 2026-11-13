// F11 — isian form "Buat Permintaan" yang boleh diteruskan BFF ke API.
// Daftar putih: field internal engine (jenis, hodPengaju, jikaHodKosong,
// refTabel/refId, identitas pengaju) tak boleh diatur klien — jenis default
// ke alur bawaan, identitas pengaju diisi BFF dari sesi.
export const FIELD_FORM_APPROVAL = ["title", "description", "nominal", "wilayah", "kategori", "attachments"] as const;

export function pilihIsianFormApproval(body: unknown): Record<string, unknown> {
  const src = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of FIELD_FORM_APPROVAL) if (k in src) out[k] = src[k];
  return out;
}
