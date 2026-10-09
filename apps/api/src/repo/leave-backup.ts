import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { wibDate } from "./cashin.js";

// F55 — Backup PIC saat cuti. Pengganti (user_leave.backup_am_id) ditunjuk saat
// cuti direkam/di-approve (dashboard POST /leave, approve pending di dashboard,
// balasan WA "ya L<id> <nama>" di grup HRD). Setelah tersimpan, grup terdampak
// (LEAVE_BACKUP_NOTIFY_TARGET) + pengganti sendiri (DM) diberi tahu:
// "PIC X cuti s/d <tgl>, sementara ke Y". Anti-dobel via notif_state.

type Jenis = "sakit" | "cuti" | "ijin";

// Jenis yang wajib punya pengganti. Sakit/ijin sering mendadak → boleh kosong,
// bisa dilengkapi belakangan lewat edit di /leave.
export const BACKUP_REQUIRED_JENIS: readonly Jenis[] = ["cuti"];

// Grup yang diberi tahu. Sengaja dari env (kosong → tidak ada broadcast grup):
// target broadcast WA ditentukan user, bukan diinferensi sistem.
export const backupNotifyTargets = (): string[] =>
  (process.env.LEAVE_BACKUP_NOTIFY_TARGET || "").split(",").map((s) => s.trim()).filter(Boolean);

const stateKey = (leaveId: string) => `f55:leave:${leaveId}`;

// Sisa balasan approver setelah "ya L<id>" → nama pengganti. Buang kata
// pengantar ("pengganti:", "backup") dan "@" mention WA.
export const parseBackupName = (rest: string): string =>
  rest.replace(/^[\s:,-]*(?:(?:pengganti|backup)\b)?[\s:,-]*@?/i, "").trim();

export const rentang = (sd: string, ed: string): string => (sd === ed ? sd : `${sd} s/d ${ed}`);

// Wajib untuk jenis cuti. Saat APPROVE (dashboard/WA) tanpa pengecualian —
// requirement Issue #1443: "wajib diisi saat approve cuti" (dikonfirmasi
// Direktur 2026-10-09: hanya jenis cuti, sakit/ijin opsional). Di luar approve
// (tambah/edit di /leave) cuti yang sudah selesai dibebaskan: data lama
// sebelum F55 & input susulan tetap harus bisa diedit.
export const isBackupRequired = (
  jenis: string,
  endDate: string,
  opts: { approval?: boolean; today?: string } = {},
): boolean =>
  BACKUP_REQUIRED_JENIS.includes(jenis as Jenis) && (opts.approval === true || endDate >= (opts.today ?? wibDate()));

// Aturan yang tidak butuh DB — dipisah supaya bisa dites murni.
export function backupRuleError(
  opts: { am_id: string; jenis: string; end_date: string; backup_am_id: string | null; approval?: boolean },
  today: string,
): string | null {
  if (!opts.backup_am_id) {
    return isBackupRequired(opts.jenis, opts.end_date, { approval: opts.approval, today }) ? `pengganti (backup PIC) wajib diisi untuk ${opts.jenis}` : null;
  }
  if (opts.backup_am_id === opts.am_id) return "pengganti tidak boleh orang yang sama dengan yang cuti";
  return null;
}

// Validasi lengkap: aturan murni + pengganti harus karyawan aktif dan TIDAK
// sedang cuti di rentang yang beririsan (rantai pengganti putus).
// approval: true untuk jalur approve pending (lihat isBackupRequired).
export async function checkBackup(opts: {
  am_id: string;
  jenis: string;
  start_date: string;
  end_date: string;
  backup_am_id: string | null;
  approval?: boolean;
}): Promise<string | null> {
  const rule = backupRuleError(opts, wibDate());
  if (rule || !opts.backup_am_id) return rule;
  const sql = db();
  const [u] = await sql`SELECT COALESCE(panggilan, nama) AS name, aktif FROM master_user WHERE am_id = ${opts.backup_am_id}`;
  if (!u) return `pengganti ${opts.backup_am_id} tidak ada di roster`;
  if (!u.aktif) return `pengganti ${u.name} sudah tidak aktif`;
  const [lv] = await sql`
    SELECT start_date::text AS sd, end_date::text AS ed FROM user_leave
    WHERE am_id = ${opts.backup_am_id}
      AND daterange(start_date, end_date, '[]') && daterange(${opts.start_date}::date, ${opts.end_date}::date, '[]')
    ORDER BY start_date LIMIT 1
  `;
  if (lv) return `pengganti ${u.name} juga tidak masuk ${rentang(String(lv.sd), String(lv.ed))}`;
  return null;
}

export interface BackupNoticeInput {
  nama: string;
  cabang: string | null;
  jenis: string;
  start_date: string;
  end_date: string;
  backup_nama: string;
  backup_wa: string | null;
  updated: boolean;
}

export function buildGroupNotice(n: BackupNoticeInput): string {
  const siapa = n.cabang ? `*${n.nama}* (${n.cabang})` : `*${n.nama}*`;
  const kontak = n.backup_wa ? ` — ${n.backup_wa}` : "";
  return [
    `🔁 *Backup PIC${n.updated ? " (diperbarui)" : ""}*`,
    `${siapa} ${n.jenis} ${rentang(n.start_date, n.end_date)}.`,
    `Sementara urusan ${n.nama} ke *${n.backup_nama}*${kontak}.`,
  ].join("\n");
}

export function buildBackupDm(n: BackupNoticeInput): string {
  return `Halo ${n.backup_nama}, kamu ditunjuk sebagai *backup PIC* untuk *${n.nama}* selama ${n.jenis} ${rentang(n.start_date, n.end_date)}. Mohon bantu tangani urusan ${n.nama} selama periode ini. 🙏`;
}

export interface BackupNotifyResult {
  sent: number;
  skipped?: "no-leave" | "no-backup" | "past" | "unchanged" | "no-target";
  targets?: string[];
}

// Kirim pemberitahuan untuk satu baris user_leave. Idempoten: signature =
// pengganti + rentang; baru kirim lagi bila salah satunya berubah. Cuti yang
// sudah lewat tidak diumumkan. State ditandai hanya bila ada kiriman sungguhan
// (stub/dry-run juga balas sent:true — pola sama F91).
export async function notifyLeaveBackup(leaveId: string): Promise<BackupNotifyResult> {
  const sql = db();
  const [r] = await sql`
    SELECT ul.am_id, ul.jenis, ul.start_date::text AS start_date, ul.end_date::text AS end_date, ul.backup_am_id,
           COALESCE(mu.panggilan, mu.nama, ul.am_id) AS nama, mu.cabang,
           COALESCE(bu.panggilan, bu.nama, ul.backup_am_id) AS backup_nama, bu.wa_number AS backup_wa
    FROM user_leave ul
    LEFT JOIN master_user mu ON mu.am_id = ul.am_id
    LEFT JOIN master_user bu ON bu.am_id = ul.backup_am_id
    WHERE ul.id = ${leaveId}
  `;
  if (!r) return { sent: 0, skipped: "no-leave" };
  if (!r.backup_am_id) return { sent: 0, skipped: "no-backup" };
  const endDate = String(r.end_date);
  if (endDate < wibDate()) return { sent: 0, skipped: "past" };

  const sig = `${r.backup_am_id}|${r.start_date}|${endDate}`;
  const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${stateKey(leaveId)}`;
  if (prev && String(prev.signature) === sig) return { sent: 0, skipped: "unchanged" };

  const n: BackupNoticeInput = {
    nama: String(r.nama),
    cabang: r.cabang ? String(r.cabang) : null,
    jenis: String(r.jenis),
    start_date: String(r.start_date),
    end_date: endDate,
    backup_nama: String(r.backup_nama),
    backup_wa: r.backup_wa ? String(r.backup_wa) : null,
    updated: !!prev && String(prev.signature) !== "",
  };
  const sends: { to: string; body: string }[] = backupNotifyTargets().map((to) => ({ to, body: buildGroupNotice(n) }));
  if (n.backup_wa) sends.push({ to: n.backup_wa, body: buildBackupDm(n) });
  if (sends.length === 0) return { sent: 0, skipped: "no-target" };

  let sent = 0;
  let real = false;
  for (const s of sends) {
    const g = await sendViaWaGateway(s.to, s.body);
    if (g.sent) sent += 1;
    if (g.sent && !g.stub && !g.dryRun) real = true;
  }
  if (real) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${stateKey(leaveId)}, ${sig}, ${sent}, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${sig}, count = ${sent}, sent_at = now()
    `;
  }
  return { sent, targets: sends.map((s) => s.to) };
}

// Dipanggil dari route HTTP: kirim WA lewat openclaw bisa 13-60 dtk per tujuan
// (lihat CLAUDE.md), jadi jangan tahan respons dashboard.
export function notifyLeaveBackupInBackground(leaveId: string): void {
  void notifyLeaveBackup(leaveId).catch((e) => console.error(`[f55] notify backup ${leaveId} gagal:`, e));
}
