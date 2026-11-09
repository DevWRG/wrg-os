// Gerbang keputusan siklus Sales Docs (A6) + SPH (F15) — fungsi murni, diuji unit.
// Query DB-nya di repo/salesdoc.ts & repo/sph.ts; di sini cuma logika ya/tidak.

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
// crm_contact.account_id = BIGINT. Non-numerik (mis. nama dari jalur WA #SPH)
// → tak ada kontak → kirim ditolak.
export function accountIdDariCustomer(customerId: string | null | undefined): string | null {
  const s = String(customerId ?? "").trim();
  return /^\d{1,18}$/.test(s) ? s : null;
}

// ── Identitas pembuat SPH ──
// sales_doc TAK punya kolom pembuat; sumbernya baris audit_log event
// 'sph.draft.create' (human_actor = nama pembuat; payload created_by_user_id
// untuk jalur web, created_by_am_id untuk jalur WA #SPH). Cocok bila SALAH SATU
// penanda sama — nama dibandingkan tanpa beda huruf besar/spasi.
export interface IdentitasPelaku {
  userId?: string | null;
  amId?: string | null;
  nama?: string | null;
}

const rapikan = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function samaOrang(a: IdentitasPelaku, b: IdentitasPelaku): boolean {
  if (a.userId && b.userId && a.userId === b.userId) return true;
  if (a.amId && b.amId && rapikan(a.amId) === rapikan(b.amId)) return true;
  const na = rapikan(a.nama);
  return na !== "" && na === rapikan(b.nama);
}

// ── Tahap 1 SPH: review HoD Business ──
export interface ReviewSphInput {
  hodPeran: string | null | undefined; // master_hod.peran milik hod_key user (null = bukan HoD / nonaktif)
  role: string | null | undefined; // app_user.role
  superuser: boolean;
  isCreator: boolean;
}

export type Putusan = { ok: true } | { ok: false; error: string };

export function hodBusiness(peran: string | null | undefined): boolean {
  return /^\s*business/i.test(String(peran ?? ""));
}

export function bolehReviewSph(i: ReviewSphInput): Putusan {
  if (i.isCreator) return { ok: false, error: "pembuat SPH tak boleh me-review SPH-nya sendiri" };
  // admin/superuser = anti-terkunci bila kursi HoD Business kosong/nonaktif.
  if (i.superuser || /^admin$/i.test(String(i.role ?? ""))) return { ok: true };
  if (hodBusiness(i.hodPeran)) return { ok: true };
  return { ok: false, error: "review tahap 1 SPH hanya untuk HoD Business aktif (master_hod)" };
}

// ── Tahap 2 SPH (finalisasi) & konfirmasi varian ──
// Izin menu (edit Sales Docs) dicek di BFF; di sini cuma larangan pembuat.
export function bolehFinalSph(i: { isCreator: boolean }): Putusan {
  if (i.isCreator) return { ok: false, error: "pembuat SPH tak boleh memfinalisasi/konfirmasi SPH-nya sendiri" };
  return { ok: true };
}
