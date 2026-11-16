import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { resolveSender } from "./master.js";

// Foto/lampiran yang GAGAL diunduh openclaw ("media materialization failed" / "fetch failed") tetap
// masuk sebagai pesan: caption + penanda `[whatsapp attachment unavailable]`, media_path NULL. Uji 16 Nov
// 2026: 29 dari 223 foto hari itu hilang begini di grup prod, tanpa ada yang tahu. Pengirimnya diberi
// tahu supaya mengirim ulang. Saklar default MATI: WA_LAMPIRAN_GAGAL_NOTIF_ENABLED=true.
export const PENANDA_LAMPIRAN_GAGAL = "[whatsapp attachment unavailable]";
export const JEDA_PERINGATAN_MENIT = 3;
// Hanya pesan SEGAR yang diperingatkan. Uji dev 16 Nov 2026 19:05: saklar baru nyala → dua foto gagal
// pukul 15:56 & 16:12 ikut tersapu dan dibalas 3 jam kemudian. Di prod, tanpa batas ini semua foto gagal
// lama (processed_at NULL) akan dibalas serentak begitu saklar dinyalakan.
export const UMUR_MAKS_MENIT = 15;

export function lampiranMasihSegar(receivedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!receivedAt) return false;
  const t = new Date(receivedAt).getTime();
  return Number.isFinite(t) && now.getTime() - t <= UMUR_MAKS_MENIT * 60_000;
}

export function lampiranGagalAktif(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.WA_LAMPIRAN_GAGAL_NOTIF_ENABLED?.trim() ?? "");
}

export function adaLampiranGagal(row: { body?: string | null; media_path?: string | null }): boolean {
  return !row.media_path && String(row.body ?? "").toLowerCase().includes(PENANDA_LAMPIRAN_GAGAL);
}

export function balasanLampiranGagal(nama: string | null | undefined): string {
  const sapa = nama?.trim() ? `${nama.trim()}, f` : "F";
  return `⚠️ ${sapa}oto/lampiran gagal terkirim ke sistem (jaringan WhatsApp). Kirim ulang fotonya ya — teks pesannya sudah tercatat.`;
}

type BarisWa = {
  id: string | number;
  group_jid: string;
  sender_jid?: string | null;
  sender_name?: string | null;
  body?: string | null;
  media_path?: string | null;
  received_at?: string | null;
};

// Dipanggil processUnprocessed SETELAH pesan diproses jalur biasanya (teks #REPORT dkk tetap tercatat).
// Hanya pengirim yang dikenali mode ketat; satu peringatan per pengirim per grup tiap JEDA_PERINGATAN_MENIT
// (10 foto gagal sekaligus = satu balasan).
export async function peringatkanLampiranGagal(row: BarisWa): Promise<Record<string, unknown> | null> {
  if (!lampiranGagalAktif() || !adaLampiranGagal(row)) return null;
  if (!lampiranMasihSegar(row.received_at)) return { lampiran_gagal: "basi" };
  const sql = db();
  const p = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
  if (!p) return { lampiran_gagal: "pengirim-tak-dikenal" };
  // Foto AM cuma diurus di grup AM (sama dengan jalur foto biasa) — di grup diskusi lain diam.
  const grupAm = process.env.COMPLIANCE_AM_GROUP || process.env.REMINDER_WA_TARGET || "";
  if (String(p.role ?? "").toUpperCase() === "AM" && grupAm && row.group_jid !== grupAm) {
    return { lampiran_gagal: "am-non-alliance" };
  }
  const [baru] = await sql`
    SELECT 1 FROM wa_message
    WHERE group_jid = ${row.group_jid} AND id <> ${row.id}
      AND coalesce(sender_name, '') = coalesce(${row.sender_name ?? null}, '')
      AND processed_result->>'lampiran_gagal_dikirim' = 'true'
      AND received_at > coalesce(${row.received_at ?? null}::timestamptz, now()) - make_interval(mins => ${JEDA_PERINGATAN_MENIT})
    LIMIT 1
  `;
  if (baru) return { lampiran_gagal: "sudah-diingatkan" };
  const reply: WaSendResult = await sendViaWaGateway(row.group_jid, balasanLampiranGagal(p.nama));
  return { lampiran_gagal_dikirim: reply.sent === true, lampiran_gagal_am_id: p.am_id, lampiran_gagal_reply: reply };
}
