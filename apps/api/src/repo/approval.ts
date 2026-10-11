// SUBSET `repo/approval.ts` milik branch dev — hanya resolveApprover(), yang
// dibutuhkan #APPROVE/#REJECT OT-xxxx (pengajuan lembur, #OVERTIME). Engine
// approval F11 (APR-xxxx, chain 5 tahap) BELUM ada di main (tersangkut #1071).
// Saat F11 dipromosikan, ganti berkas ini dengan versi dev apa adanya — isi
// resolveApprover di sana identik.

import { db } from "../db.js";
import { normalizeWa } from "./master.js";

// Identitas approver dari nomor WA pengirim — BEDA dari resolveSender()
// (master.ts, roster AM) krn approver itu HoD/Direktur = akun dashboard
// (app_user), bukan AM. Pola sama (normalize+match), sumber tabel beda.
export interface ResolvedApprover {
  userId: string;
  name: string;
  hodKey: string | null;
  role: string;
}

export async function resolveApprover(senderJid: string | null | undefined): Promise<ResolvedApprover | null> {
  if (!senderJid) return null;
  // Pesan grup: sender_jid = group_jid (lihat inbound) — itu identitas GRUP,
  // bukan orang. Tanpa penolakan ini, akun yang wa_number-nya kebetulan berisi
  // id grup membuat SIAPA PUN di grup itu terbaca sebagai approver
  // (ketemu saat uji #OVERTIME di dev, 2026-10-11).
  if (String(senderJid).endsWith("@g.us")) return null;
  const num = String(senderJid).split("@")[0].split(":")[0];
  const norm = normalizeWa(num);
  if (!norm) return null;
  const sql = db();
  const rows = await sql`
    SELECT id, name, hod_key, role FROM app_user
    WHERE active = true AND regexp_replace(COALESCE(wa_number, ''), '[^0-9]', '', 'g') = ${norm}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { userId: String(r.id), name: r.name ? String(r.name) : "-", hodKey: r.hod_key ? String(r.hod_key) : null, role: String(r.role) };
}
