// Gerbang keputusan siklus Sales Docs (A6) — fungsi murni, diuji unit.
// Query DB-nya di repo/salesdoc.ts; di sini cuma logika ya/tidak.

import { normalizeWa } from "../repo/master.js";

// ── Tujuan kirim dokumen ──
// Nomor tujuan WAJIB salah satu kontak WA customer di Accounts (crm_contact.hp_wa).
// Tanpa ini endpoint send = relay WA ke nomor mana pun atas nama perusahaan.
// JID personal (…@c.us / …@s.whatsapp.net) diterima sbg nomornya. JID grup
// (…@g.us) / JID lain DITOLAK: belum ada registry grup milik customer, jadi tak
// bisa dibuktikan grup itu milik customer dokumen ini.
export const PESAN_TUJUAN_DITOLAK = "nomor tujuan harus salah satu kontak WA customer di Accounts (CRM)";

export function nomorTujuan(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/@(c\.us|s\.whatsapp\.net)$/i, "");
  if (!s || s.includes("@")) return null;
  const n = normalizeWa(s);
  // Nomor Indonesia wajar: 62 + 8–13 digit. Sisanya bukan nomor WA personal.
  return /^62\d{8,13}$/.test(n) ? n : null;
}

export function tujuanDiizinkan(to: string | null | undefined, kontak: readonly (string | null | undefined)[]): boolean {
  const n = nomorTujuan(to);
  if (!n) return false;
  return kontak.some((k) => nomorTujuan(k) === n);
}

// sales_doc.customer_id = VARCHAR (id accurate_customer disimpan sbg teks),
// crm_contact.account_id = BIGINT. Non-numerik → tak ada kontak → kirim ditolak.
export function accountIdDariCustomer(customerId: string | null | undefined): string | null {
  const s = String(customerId ?? "").trim();
  return /^\d{1,18}$/.test(s) ? s : null;
}
