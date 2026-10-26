// Uji F67 rantai persetujuan insentif di mesin approval F11 (migrasi 256) —
// MANUAL, butuh DB dev (migrasi 093/183 sudah jalan). Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-insentif-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
//
// Yang dibuktikan:
//   1. Ajukan (AM) → status submitted + jejak langkah 1 + approval engine.
//   2. Tiap tahap engine memajukan status insentif & menulis jejak (step k+1).
//   3. Bukan anggota grup ditolak; AM pengaju tak bisa menyetujui; satu akun
//      tak bisa dua tahap (anggota dua grup); klik basi ditolak.
//   4. Tahap terakhir (HRD) → paid.
//   5. Tolak → rejected; buka kembali → draft siklus 2; ajukan ulang → approval baru.
//   6. Rekap pindahan (backfill 256) di tengah rantai bisa diteruskan.
//
// Baris uji (am_id "uji-ins-*") dibersihkan di awal DAN di akhir.

import { db } from "../../apps/api/src/db.js";
import type { DataScope } from "../../apps/api/src/repo/access-scope.js";
import { actApproval, getApproval } from "../../apps/api/src/repo/insentif-approval.js";

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
const GRUP = ["sales-hod", "finance-hod", "komite", "direktur", "hrd"];
let grupDibuat: string[] = [];

async function bersihkan(semua: boolean) {
  const f = semua ? sql`am_id LIKE 'uji-ins-%'` : sql`am_id LIKE 'uji-ins-baru%'`;
  await sql`DELETE FROM approval_request WHERE ref_tabel = 'insentif_bulanan' AND ref_id IN (SELECT id::text FROM insentif_bulanan WHERE ${f})`;
  await sql`DELETE FROM insentif_approval_log WHERE bulanan_id IN (SELECT id FROM insentif_bulanan WHERE ${f})`;
  await sql`DELETE FROM insentif_bulanan WHERE ${f}`;
  if (semua) {
    await sql`DELETE FROM app_user WHERE email LIKE 'uji-ins-%@dev.local'`;
    await sql`DELETE FROM master_user WHERE am_id LIKE 'uji-ins-%'`;
    if (grupDibuat.length) await sql`DELETE FROM access_group WHERE key = ANY(${sql.array(grupDibuat)}::text[])`;
  }
}

async function user(nama: string, wa: string, amId: string | null = null) {
  const [u] = await sql`
    INSERT INTO app_user (email, password_hash, name, role, am_id, wa_number)
    VALUES (${`uji-ins-${nama}@dev.local`}, 'x', ${`Uji ${nama}`}, 'user', ${amId}, ${wa})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return String(u.id);
}

async function rekap(amId: string, periode: string, status = "draft") {
  await sql`INSERT INTO master_user (am_id, nama, aktif) VALUES (${amId}, ${`AM ${amId}`}, true) ON CONFLICT (am_id) DO NOTHING`;
  await sql`
    INSERT INTO insentif_bulanan (am_id, periode, tier_ut, effort_score, cap_bulanan, total_insentif_am, status)
    VALUES (${amId}, ${periode}, 'T1', 80, 5000000, 1250000, ${status})`;
}

const scopeAm = (userId: string, amId: string): DataScope => ({ userId, amOnly: true, amId, cabang: null, superuser: false });
// Approver: superuser di SCOPE hanya untuk visibilitas baris; wewenang tahap
// dihitung engine dari keanggotaan grup akun itu, bukan dari scope.
const scopeAll = (userId: string): DataScope => ({ userId, amOnly: false, amId: null, cabang: null, superuser: true });

async function status(amId: string, periode: string) {
  const [r] = await sql`SELECT status, siklus, approval_request_id FROM insentif_bulanan WHERE am_id = ${amId} AND periode = ${periode}`;
  return r as { status: string; siklus: number; approval_request_id: string | null } | undefined;
}

async function coba(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return `${(e as { status?: number }).status ?? "?"} ${(e as Error).message}`;
  }
}

async function main() {
  const pindahan = await sql`SELECT am_id, periode FROM insentif_bulanan WHERE am_id = 'uji-ins-pindahan' AND approval_request_id IS NOT NULL`;
  await bersihkan(false);
  const ids: Record<string, string> = {};
  for (const k of GRUP) {
    const [g] = await sql`SELECT id FROM access_group WHERE key = ${k}`;
    if (g) ids[k] = String(g.id);
    else {
      const [n] = await sql`INSERT INTO access_group (key, name) VALUES (${k}, ${`Uji ${k}`}) RETURNING id`;
      ids[k] = String(n.id);
      grupDibuat.push(k);
    }
  }
  const am = await user("am", "6280000023001", "uji-ins-baru-1");
  const pemutus: Record<string, string> = {};
  for (const [i, k] of GRUP.entries()) {
    pemutus[k] = await user(k, `628000002310${i}`);
    await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${pemutus[k]}, ${ids[k]}) ON CONFLICT DO NOTHING`;
  }
  const dobel = await user("dobel", "6280000023200");
  for (const k of ["sales-hod", "finance-hod"]) await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${dobel}, ${ids[k]}) ON CONFLICT DO NOTHING`;
  // AM yang juga anggota grup sales-hod (SoD: tetap tak boleh menyetujui sendiri).
  await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${am}, ${ids["sales-hod"]}) ON CONFLICT DO NOTHING`;

  const P = "2026-09";
  await rekap("uji-ins-baru-1", P);

  console.log("1. Ajukan");
  const aj = await coba(() => actApproval(scopeAm(am, "uji-ins-baru-1"), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
  const s1 = await status("uji-ins-baru-1", P);
  cek("submitted + approval terbuka", aj === null && s1?.status === "submitted" && !!s1.approval_request_id, aj ?? "");

  console.log("2. Wewenang");
  const viaAm = await coba(() => actApproval(scopeAll(am), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
  cek("AM pengaju (anggota sales-hod) tak bisa menyetujui", viaAm !== null, viaAm ?? "");
  const salah = await coba(() => actApproval(scopeAll(pemutus["finance-hod"]), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
  cek("Finance belum giliran ditolak", salah !== null, salah ?? "");
  const lihatHod = await getApproval(scopeAll(pemutus["sales-hod"]), "uji-ins-baru-1", P);
  cek("tampilan: HOD Sales boleh maju & tolak", lihatHod.boleh_maju && lihatHod.boleh_tolak);
  const t1 = await coba(() => actApproval(scopeAll(dobel), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
  const s2 = await status("uji-ins-baru-1", P);
  cek("tahap 1 (anggota dua grup) → hod_review", t1 === null && s2?.status === "hod_review", t1 ?? "");
  const t2dobel = await coba(() => actApproval(scopeAll(dobel), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
  cek("akun yang sama ditolak di tahap Finance", t2dobel !== null && /satu tahap/.test(t2dobel), t2dobel ?? "");
  const lihatDobel = await getApproval(scopeAll(dobel), "uji-ins-baru-1", P);
  cek("tampilan untuk akun itu: tombol mati + alasan", !lihatDobel.boleh_maju && /satu tahap/.test(lihatDobel.alasan ?? ""), lihatDobel.alasan ?? "");

  console.log("3. Rantai sampai dibayar");
  const urut = ["finance-hod", "komite", "direktur", "hrd"] as const;
  const harap = ["finance_verify", "corsec_compile", "direktur_approve", "paid"];
  for (const [i, k] of urut.entries()) {
    const e = await coba(() => actApproval(scopeAll(pemutus[k]), { amId: "uji-ins-baru-1", periode: P, aksi: "maju" }));
    const s = await status("uji-ins-baru-1", P);
    cek(`${k} → ${harap[i]}`, e === null && s?.status === harap[i], e ?? s?.status);
  }
  const log = await sql`
    SELECT step, status_to FROM insentif_approval_log l JOIN insentif_bulanan b ON b.id = l.bulanan_id
    WHERE b.am_id = 'uji-ins-baru-1' ORDER BY acted_at`;
  cek("jejak 183 lengkap step 1–6", log.map((l) => `${l.step}:${l.status_to}`).join(",") ===
    "1:submitted,2:hod_review,3:finance_verify,4:corsec_compile,5:direktur_approve,6:paid", log.map((l) => `${l.step}:${l.status_to}`).join(","));

  console.log("4. Tolak, buka kembali, ajukan ulang");
  const P2 = "2026-08";
  await rekap("uji-ins-baru-1", P2);
  await actApproval(scopeAm(am, "uji-ins-baru-1"), { amId: "uji-ins-baru-1", periode: P2, aksi: "maju" });
  const aprLama = (await status("uji-ins-baru-1", P2))?.approval_request_id;
  const tolakKosong = await coba(() => actApproval(scopeAll(pemutus["sales-hod"]), { amId: "uji-ins-baru-1", periode: P2, aksi: "tolak" }));
  cek("tolak tanpa catatan ditolak", tolakKosong !== null, tolakKosong ?? "");
  await actApproval(scopeAll(pemutus["sales-hod"]), { amId: "uji-ins-baru-1", periode: P2, aksi: "tolak", catatan: "flag KSO salah" });
  cek("ditolak → rejected", (await status("uji-ins-baru-1", P2))?.status === "rejected");
  await actApproval(scopeAll(pemutus["sales-hod"]), { amId: "uji-ins-baru-1", periode: P2, aksi: "buka" });
  const sb = await status("uji-ins-baru-1", P2);
  cek("buka kembali → draft siklus 2", sb?.status === "draft" && Number(sb.siklus) === 2);
  await actApproval(scopeAm(am, "uji-ins-baru-1"), { amId: "uji-ins-baru-1", periode: P2, aksi: "maju" });
  const sa = await status("uji-ins-baru-1", P2);
  cek("ajukan ulang → approval baru", sa?.status === "submitted" && !!sa.approval_request_id && sa.approval_request_id !== aprLama);
  const lagi = await coba(() => actApproval(scopeAll(pemutus["sales-hod"]), { amId: "uji-ins-baru-1", periode: P2, aksi: "maju" }));
  cek("HOD yang menolak di siklus 1 boleh mereview siklus 2", lagi === null, lagi ?? "");

  console.log("5. Rekap pindahan (backfill 256)");
  if (pindahan.length === 0) console.log("  (lewati — tak ada fixture uji-ins-pindahan di DB ini)");
  for (const p of pindahan) {
    const s = await status(String(p.am_id), String(p.periode));
    cek("pindahan: masih finance_verify", s?.status === "finance_verify", s?.status);
    const e = await coba(() => actApproval(scopeAll(pemutus["komite"]), { amId: String(p.am_id), periode: String(p.periode), aksi: "maju" }));
    cek("pindahan: Komite meneruskan → corsec_compile", e === null && (await status(String(p.am_id), String(p.periode)))?.status === "corsec_compile", e ?? "");
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
