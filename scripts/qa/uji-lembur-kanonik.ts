// Uji #OVERTIME (lembur) sebagai konsumen mesin approval F11 (migrasi 251) —
// MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-lembur-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
//
// Yang dibuktikan:
//   1. Pengajuan ber-HoD lahir bersama approval alur 'lembur'; notify_status terisi.
//   2. #APPROVE OT-xxxx (WA) diteruskan ke approval-nya → approved + decided_by.
//   3. Admin tak lagi mewakili HoD pada pengajuan di engine; tolak dari
//      dashboard wajib alasan.
//   4. HoD belum diketahui → tanpa approval; admin menetapkan HoD → approval
//      dibuka + WA. Admin mengganti HoD → pemegang tahap pindah (HoD lama
//      tak berwenang lagi).
//   5. Pengajuan pindahan (backfill 251) bisa diputus.
//
// Baris uji (am_id "uji-ot-*") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import { resolveApproverByUserId } from "../../apps/api/src/repo/approval.js";
import { assignHod, decideOvertime, getOvertime, submitOvertime } from "../../apps/api/src/repo/overtime.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket : ""}`);
  if (!ok) gagal++;
};

async function bersihkan(semua: boolean) {
  const f = semua ? sql`am_id LIKE 'uji-ot-%'` : sql`am_id LIKE 'uji-ot-baru%'`;
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'overtime_request' AND ref_id IN (SELECT id::text FROM overtime_request WHERE ${f})`;
  await sql`DELETE FROM overtime_request WHERE ${f}`;
  if (semua) {
    await sql`DELETE FROM overtime_rule WHERE am_id LIKE 'uji-ot-%'`;
    await sql`DELETE FROM master_hod WHERE hod_key LIKE 'uji-ot-%'`;
    await sql`DELETE FROM app_user WHERE email LIKE 'uji-ot-%@dev.local'`;
  }
}

async function user(email: string, name: string, o: { role?: string; hodKey?: string | null; amId?: string | null; wa: string }) {
  const [u] = await sql`
    INSERT INTO app_user (email, password_hash, name, role, hod_key, am_id, wa_number)
    VALUES (${email}, 'x', ${name}, ${o.role ?? "user"}, ${o.hodKey ?? null}, ${o.amId ?? null}, ${o.wa})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id
  `;
  return String(u.id);
}

const profil = (am: string, hod: string | null) => ({ am_id: am, nama: `Uji ${am}`, dept: "UJI", posisi: null, hod_key: hod });

async function main() {
  const pindahan = await sql`SELECT id FROM overtime_request WHERE am_id = 'uji-ot-pindahan' AND approval_request_id IS NOT NULL`;
  await bersihkan(false);
  for (const k of ["uji-ot-hod-a", "uji-ot-hod-b"]) {
    await sql`INSERT INTO master_hod (hod_key, nama, panggilan, peran, aktif) VALUES (${k}, ${k}, ${k}, 'Uji', true) ON CONFLICT (hod_key) DO UPDATE SET aktif = true`;
  }
  await sql`INSERT INTO overtime_rule (am_id, aktif) VALUES ('uji-ot-baru-1', true), ('uji-ot-baru-2', true)`;
  const hodA = await user("uji-ot-hoda@dev.local", "Uji HoD A", { role: "hod", hodKey: "uji-ot-hod-a", wa: "6280000021001" });
  const hodB = await user("uji-ot-hodb@dev.local", "Uji HoD B", { role: "hod", hodKey: "uji-ot-hod-b", wa: "6280000021002" });
  const admin = await user("uji-ot-admin@dev.local", "Uji Admin OT", { role: "admin", wa: "6280000021003" });

  console.log("1. Pengajuan ber-HoD");
  const s1 = await submitOvertime({ profile: profil("uji-ot-baru-1", "uji-ot-hod-a"), menit: 120, uraian: "stok opname", group_jid: "uji-ot@g.us", wa_message_id: null });
  const r1 = s1.ok ? s1.row : null;
  cek("approval tertaut + notify terkirim", !!r1?.approval_request_id && s1.ok && s1.notify.ok && r1.notify_status === "terkirim", s1.ok ? s1.notify.error : "");

  console.log("2. #APPROVE OT- via WA");
  const viaAdmin = await decideOvertime({ id: r1!.id }, "approve", { name: "Uji Admin OT", hodKey: null, privileged: true, userId: admin });
  cek("admin tak mewakili HoD", !viaAdmin.ok, viaAdmin.ok ? "" : viaAdmin.error);
  const appr = await resolveApproverByUserId(hodA);
  const wa = await decideOvertime({ kode: r1!.kode }, "approve", { name: appr!.name, hodKey: appr!.hodKey, privileged: false, approver: appr! });
  const r1b = await getOvertime(r1!.id);
  cek("OT- diteruskan ke engine → approved oleh HoD", wa.ok && r1b?.status === "approved" && r1b.decided_by === "Uji HoD A", wa.ok ? "" : wa.error);

  console.log("3. Tolak dari dashboard");
  const s2 = await submitOvertime({ profile: profil("uji-ot-baru-1", "uji-ot-hod-a"), menit: 60, uraian: "rekap", group_jid: null, wa_message_id: null });
  const id2 = s2.ok ? s2.row.id : 0;
  const tanpa = await decideOvertime({ id: id2 }, "reject", { name: "Uji HoD A", hodKey: "uji-ot-hod-a", privileged: false, userId: hodA }, "");
  cek("tolak tanpa alasan ditolak", !tanpa.ok);
  const tolak = await decideOvertime({ id: id2 }, "reject", { name: "Uji HoD A", hodKey: "uji-ot-hod-a", privileged: false, userId: hodA }, "bukan prioritas");
  const r2 = await getOvertime(id2);
  cek("ditolak + catatan", tolak.ok && r2?.status === "rejected" && r2.decision_note === "bukan prioritas");

  console.log("4. HoD belum diketahui → tetapkan → ganti");
  const s3 = await submitOvertime({ profile: profil("uji-ot-baru-2", null), menit: 90, uraian: "servis", group_jid: null, wa_message_id: null });
  const id3 = s3.ok ? s3.row.id : 0;
  cek("tanpa HoD: tanpa approval, notify gagal tercatat", s3.ok && !s3.row.approval_request_id && !s3.notify.ok);
  const as1 = await assignHod(id3, "uji-ot-hod-a");
  const r3 = await getOvertime(id3);
  cek("tetapkan HoD → approval dibuka + WA", as1.ok && !!r3?.approval_request_id && as1.notify?.ok === true, as1.error ?? as1.notify?.error);
  const as2 = await assignHod(id3, "uji-ot-hod-b");
  cek("ganti HoD → ok + WA ke HoD baru", as2.ok && as2.notify?.ok === true, as2.error ?? as2.notify?.error);
  const lama = await decideOvertime({ id: id3 }, "approve", { name: "Uji HoD A", hodKey: "uji-ot-hod-a", privileged: false, userId: hodA });
  cek("HoD lama tak berwenang lagi", !lama.ok);
  const baru = await decideOvertime({ id: id3 }, "approve", { name: "Uji HoD B", hodKey: "uji-ot-hod-b", privileged: false, userId: hodB });
  cek("HoD baru menyetujui", baru.ok && (await getOvertime(id3))?.status === "approved", baru.ok ? "" : baru.error);
  const salahKey = await assignHod(id3, "bukan-hod");
  cek("hod_key di luar master_hod ditolak", !salahKey.ok);

  console.log("5. Pindahan (backfill 251)");
  if (pindahan.length === 0) console.log("  (lewati — tak ada fixture uji-ot-pindahan di DB ini)");
  for (const p of pindahan) {
    const o = await getOvertime(Number(p.id));
    const [st] = await sql`SELECT notified_at FROM approval_step WHERE request_id = ${o!.approval_request_id}`;
    cek("pindahan: punya approval; notified_at dari notify_status lama", !!o?.approval_kode && st?.notified_at != null);
    const r = await decideOvertime({ kode: o!.kode }, "approve", { name: appr!.name, hodKey: appr!.hodKey, privileged: false, approver: appr! });
    cek("pindahan: #APPROVE OT- → approved", r.ok && (await getOvertime(Number(p.id)))?.status === "approved", r.ok ? "" : r.error);
  }

  await bersihkan(true);
  console.log(gagal === 0 ? "\nSEMUA LOLOS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await bersihkan(true);
  } catch {
    /* abaikan */
  }
  await sql.end();
  process.exit(1);
});
