// Uji insentif bulanan (F67) sebagai konsumen mesin approval F11 (migrasi 270) —
// MANUAL, butuh DB dev yang sudah sampai 270. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" WA_SEND_URL= npx tsx scripts/qa/uji-insentif-kanonik.ts
//
// WA_SEND_URL kosong = gateway STUB. Menolak jalan bila DATABASE_URL menyebut prod.
// Fixture (akun, grup, AM, rekap) memakai id/email ber-penanda `uji270` dan dihapus
// di akhir; grup akses & baris feature yang belum ada dibuat dan dibiarkan. Izin
// baca `insentif-tim` diberikan lewat grup uji `uji270-insentif` — izin grup asli
// (finance-hod/komite/hrd) TIDAK diubah, di DB dev izinnya bisa saja mati.
//
// Yang dibuktikan:
//   1. Ajukan oleh AM → status submitted + approval engine (atomik), tahap 2 =
//      HoD wilayah AM; AM tanpa HoD wilayah ditolak dengan pesan, status tetap draft.
//   2. Superuser yang bukan pemegang tahap ditolak (tanpa bypass); HoD wilayah lain
//      ditolak; klik basi (step salah) ditolak.
//   3. Tiap tahap yang lolos memajukan insentif_bulanan.status + menulis jejak log.
//   4. Satu orang tak bisa memutus dua tahap (anggota dua grup).
//   5. Tolak tanpa alasan ditolak; tolak beralasan → rejected; buka kembali →
//      putaran baru, request baru, kuota satu-orang-satu-tahap ter-reset.
//   6. Semua tahap setuju → direktur_approve; inbox Direktur tak dobel.
//   7. Bayar: superuser non-HRD ditolak, HRD tak bisa menolak, pemutus tahap
//      sebelumnya (anggota hrd) ditolak pagar 183, HRD lain → paid.
//   8. Rekap hasil backfill 270 (bila ada) bisa diteruskan.

import { db } from "../../apps/api/src/db.js";
import { resolveScope } from "../../apps/api/src/repo/access-scope.js";
import { decideFromDashboard } from "../../apps/api/src/repo/approval.js";
import { actApproval, getApproval } from "../../apps/api/src/repo/insentif-approval.js";
import { listDirekturInbox } from "../../apps/api/src/repo/direktur-inbox.js";

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

const U = (n: string) => `00000000-0000-0000-0270-${n.padStart(12, "0")}`;
const AKUN = {
  amA: U("a1"), amB: U("a2"), hodX: U("b1"), hodY: U("b2"), fin1: U("c1"), fin2: U("c2"),
  kom1: U("d1"), dir: U("e1"), hrd1: U("f1"), hrd2: U("f3"), adm: U("f2"),
};
const AM_A = "UJI270A";
const AM_B = "UJI270B";
const PERIODE = "2099-01";

async function setup() {
  await sql`
    INSERT INTO access_group (key, name) VALUES
      ('sales-hod','Sales HoD'),('finance-hod','Finance HoD'),('komite','Komite'),('hrd','HRD'),('uji270-insentif','Uji 270 Insentif Tim')
    ON CONFLICT (key) DO NOTHING`;
  await sql`
    INSERT INTO feature (key, name, section, path) VALUES ('insentif-tim','Insentif Tim','Sales','/insentif/tim')
    ON CONFLICT (key) DO NOTHING`;
  await sql`
    INSERT INTO access_permission (group_id, feature_key, active, can_view)
    SELECT id, 'insentif-tim', true, true FROM access_group WHERE key = 'uji270-insentif'
    ON CONFLICT (group_id, feature_key) DO UPDATE SET active = true, can_view = true`;
  const orang: [string, string, string, string | null, string | null][] = [
    [AKUN.amA, "AM Uji270 A", "user", AM_A, null],
    [AKUN.amB, "AM Uji270 B", "user", AM_B, null],
    [AKUN.hodX, "HoD Uji270 X", "user", null, "uji270x"],
    [AKUN.hodY, "HoD Uji270 Y", "user", null, "uji270y"],
    [AKUN.fin1, "Finance Uji270 1", "user", null, null],
    [AKUN.fin2, "Finance+Komite Uji270", "user", null, null],
    [AKUN.kom1, "Komite Uji270", "user", null, null],
    [AKUN.dir, "Direktur Uji270", "direktur", null, null],
    [AKUN.hrd1, "HRD Uji270 1", "user", null, null],
    [AKUN.hrd2, "HRD Uji270 2", "user", null, null],
    [AKUN.adm, "Admin Uji270", "admin", null, null],
  ];
  for (const [id, name, role, amId, hodKey] of orang) {
    await sql`
      INSERT INTO app_user (id, email, password_hash, name, role, am_id, hod_key, wa_number)
      VALUES (${id}, ${`${id}@uji270`}, 'x', ${name}, ${role}, ${amId}, ${hodKey}, ${`6299${id.slice(-6)}`})
      ON CONFLICT (id) DO NOTHING`;
  }
  const anggota: [string, string][] = [
    [AKUN.hodX, "sales-hod"], [AKUN.hodY, "sales-hod"], [AKUN.fin1, "finance-hod"], [AKUN.fin2, "finance-hod"],
    [AKUN.fin2, "komite"], [AKUN.kom1, "komite"], [AKUN.hrd1, "hrd"], [AKUN.hrd2, "hrd"], [AKUN.fin1, "hrd"],
    ...[AKUN.fin1, AKUN.fin2, AKUN.kom1, AKUN.dir, AKUN.hrd1, AKUN.hrd2].map((u) => [u, "uji270-insentif"] as [string, string]),
  ];
  for (const [uid, key] of anggota) {
    await sql`
      INSERT INTO app_user_group (user_id, group_id)
      SELECT ${uid}, id FROM access_group WHERE key = ${key} ON CONFLICT DO NOTHING`;
  }
  await sql`
    INSERT INTO master_user (am_id, nama, role, cabang) VALUES
      (${AM_A}, 'AM Uji270 A', 'AM', 'UJI270 KOTA'), (${AM_B}, 'AM Uji270 B', 'AM', 'UJI270 TANPA HOD')
    ON CONFLICT (am_id) DO NOTHING`;
  await sql`
    INSERT INTO hod_territory (hod_key, cabang) VALUES ('uji270x','UJI270 KOTA'), ('uji270y','UJI270 LAIN')
    ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO insentif_bulanan (am_id, periode, tier_ut, effort_score, cap_bulanan, status, total_insentif_am) VALUES
      (${AM_A}, ${PERIODE}, 'T1', 80, 1000000, 'draft', 750000),
      (${AM_B}, ${PERIODE}, 'T1', 80, 1000000, 'draft', 750000)
    ON CONFLICT (am_id, periode) DO NOTHING`;
}

async function bersihkan() {
  await sql`
    DELETE FROM approval_request WHERE ref_tabel = 'insentif_bulanan' AND ref_id IN (
      SELECT id::text FROM insentif_bulanan WHERE am_id IN (${AM_A}, ${AM_B}))`;
  await sql`DELETE FROM insentif_bulanan WHERE am_id IN (${AM_A}, ${AM_B})`;
  await sql`DELETE FROM hod_territory WHERE hod_key IN ('uji270x','uji270y')`;
  await sql`DELETE FROM master_user WHERE am_id IN (${AM_A}, ${AM_B})`;
  await sql`DELETE FROM app_user WHERE id IN ${sql(Object.values(AKUN))}`;
  await sql`DELETE FROM access_group WHERE key IN ('uji270-insentif', 'uji270-direksi')`;
}

const sebagai = async (uid: string) => resolveScope(uid);
async function aksi(uid: string, amId: string, a: "maju" | "tolak" | "buka", catatan: string | null = null, step?: number) {
  try {
    const r = await actApproval(await sebagai(uid), { amId, periode: PERIODE, aksi: a, catatan, step });
    return { ok: true as const, r, err: null as string | null };
  } catch (e) {
    return { ok: false as const, r: null, err: `${(e as { status?: number }).status ?? "?"} ${(e as Error).message}` };
  }
}
const lihat = async (uid: string, amId = AM_A) => getApproval(await sebagai(uid), amId, PERIODE);
async function rekap(amId = AM_A) {
  const [r] = await sql`
    SELECT b.id::text, b.status, b.siklus, b.approval_request_id::text AS apr, r.current_urutan, r.status AS apr_status
    FROM insentif_bulanan b LEFT JOIN approval_request r ON r.id = b.approval_request_id
    WHERE b.am_id = ${amId} AND b.periode = ${PERIODE}`;
  return r;
}

async function main() {
  await bersihkan();
  await setup();

  console.log("1. Ajukan");
  const tanpaHod = await aksi(AKUN.amB, AM_B, "maju", null, 1);
  cek("AM tanpa HoD wilayah ditolak dengan pesan", !tanpaHod.ok && /HoD wilayah/.test(tanpaHod.err ?? ""), tanpaHod.err ?? "");
  cek("…status tetap draft tanpa approval", (await rekap(AM_B)).status === "draft" && (await rekap(AM_B)).apr == null);
  const aju = await aksi(AKUN.amA, AM_A, "maju", null, 1);
  cek("AM mengajukan", aju.ok, aju.err ?? "");
  let r = await rekap();
  cek("status submitted + approval di tahap 2", r.status === "submitted" && r.apr != null && Number(r.current_urutan) === 2);
  const [st2] = await sql`SELECT target_type, hod_key FROM approval_step WHERE request_id = ${r.apr} AND urutan = 2`;
  cek("tahap 2 = HoD wilayah AM", st2?.target_type === "hod_pengaju" && st2?.hod_key === "uji270x");
  const [req] = await sql`SELECT requested_by_user_id::text AS u, nominal FROM approval_request WHERE id = ${r.apr}`;
  cek("pengaju = akun AM, nominal tak ikut", req.u === AKUN.amA && req.nominal == null);
  const apr1 = r.apr as string;

  console.log("2. Wewenang");
  const adm = await aksi(AKUN.adm, AM_A, "maju", null, 2);
  cek("superuser bukan HoD wilayah ditolak", !adm.ok, adm.err ?? "");
  cek("…dan tombolnya mati di kartu", (await lihat(AKUN.adm)).boleh_maju === false);
  const hy = await decideFromDashboard(apr1, "approve", AKUN.hodY, null, undefined, { expectedUrutan: 2 });
  cek("HoD wilayah lain ditolak mesin", !hy.ok, hy.error ?? "");
  const am = await decideFromDashboard(apr1, "approve", AKUN.amA, null);
  cek("AM tak bisa memutus permintaannya sendiri", !am.ok, am.error ?? "");
  const basi = await aksi(AKUN.hodX, AM_A, "maju", null, 3);
  cek("klik basi (step 3 padahal 2) ditolak", !basi.ok && /berubah/.test(basi.err ?? ""), basi.err ?? "");
  cek("kartu HoD X: boleh maju & tolak", (await lihat(AKUN.hodX)).boleh_maju && (await lihat(AKUN.hodX)).boleh_tolak);

  console.log("3. Tahap maju");
  const h = await aksi(AKUN.hodX, AM_A, "maju", "ok HoD", 2);
  r = await rekap();
  cek("HoD X setuju → hod_review, tahap 3", h.ok && r.status === "hod_review" && Number(r.current_urutan) === 3, h.err ?? "");
  const f = await aksi(AKUN.fin2, AM_A, "maju", null, 3);
  r = await rekap();
  cek("Finance (fin2) → finance_verify, tahap 4", f.ok && r.status === "finance_verify" && Number(r.current_urutan) === 4, f.err ?? "");
  const [nLog] = await sql`SELECT count(*)::int AS n FROM insentif_approval_log WHERE bulanan_id = ${r.id}::bigint AND siklus = 1`;
  cek("jejak log ikut ditulis (ajukan + 2 tahap)", nLog.n === 3, `n=${nLog.n}`);

  console.log("4. Satu orang satu tahap");
  const dua = await aksi(AKUN.fin2, AM_A, "maju", null, 4);
  cek("fin2 (juga komite) tak boleh memutus tahap 4", !dua.ok, dua.err ?? "");
  const k = await aksi(AKUN.kom1, AM_A, "maju", null, 4);
  r = await rekap();
  cek("Komite → corsec_compile, tahap 5", k.ok && r.status === "corsec_compile" && Number(r.current_urutan) === 5, k.err ?? "");

  console.log("5. Tolak & buka kembali");
  const inbox1 = await listDirekturInbox();
  const muncul = inbox1.items.filter((i) => i.judul.includes("AM Uji270 A") || i.kode === `INS-${PERIODE}-${AM_A}`);
  cek("inbox Direktur memuatnya sekali (lewat approval)", muncul.length === 1 && muncul[0].jenis === "approval", `n=${muncul.length}`);
  const tanpaAlasan = await aksi(AKUN.dir, AM_A, "tolak", null, 5);
  cek("tolak tanpa alasan ditolak", !tanpaAlasan.ok, tanpaAlasan.err ?? "");
  const tolak = await aksi(AKUN.dir, AM_A, "tolak", "angka effort perlu dicek", 5);
  r = await rekap();
  cek("Direktur menolak → rejected, approval rejected", tolak.ok && r.status === "rejected" && r.apr_status === "rejected", tolak.err ?? "");
  const bukaFin = await aksi(AKUN.fin1, AM_A, "buka");
  cek("non sales-hod tak bisa membuka kembali", !bukaFin.ok, bukaFin.err ?? "");
  const buka = await aksi(AKUN.hodX, AM_A, "buka", "sudah dikoreksi");
  r = await rekap();
  cek("HoD X membuka kembali → draft putaran 2", buka.ok && r.status === "draft" && Number(r.siklus) === 2, buka.err ?? "");
  const aju2 = await aksi(AKUN.amA, AM_A, "maju", null, 1);
  r = await rekap();
  cek("ajukan ulang → request BARU", aju2.ok && r.apr != null && r.apr !== apr1, aju2.err ?? "");

  console.log("6. Putaran 2 sampai Direktur");
  for (const [uid, step, nama] of [[AKUN.hodX, 2, "HoD X"], [AKUN.fin2, 3, "fin2"], [AKUN.kom1, 4, "Komite"], [AKUN.dir, 5, "Direktur"]] as const) {
    const x = await aksi(uid, AM_A, "maju", null, step);
    cek(`${nama} setuju tahap ${step} (kuota putaran 1 tak terbawa)`, x.ok, x.err ?? "");
  }
  r = await rekap();
  cek("status direktur_approve, approval approved", r.status === "direktur_approve" && r.apr_status === "approved");
  const inbox2 = await listDirekturInbox();
  cek("inbox Direktur kosong untuk rekap ini", !inbox2.items.some((i) => i.judul.includes("AM Uji270 A")));

  console.log("7. Bayar (di luar mesin)");
  const bAdm = await aksi(AKUN.adm, AM_A, "maju", null, 6);
  cek("superuser non-HRD tak bisa menandai dibayar", !bAdm.ok, bAdm.err ?? "");
  const bTolak = await aksi(AKUN.hrd1, AM_A, "tolak", "x", 6);
  cek("HRD tak bisa menolak di langkah Bayar", !bTolak.ok, bTolak.err ?? "");
  // fin2 anggota finance-hod+komite, bukan hrd — fin1 (anggota hrd) belum tanda tangan
  // di putaran 2, jadi kita pakai fin2 yang sudah: tambahkan dulu ke hrd.
  await sql`INSERT INTO app_user_group (user_id, group_id) SELECT ${AKUN.fin2}, id FROM access_group WHERE key = 'hrd' ON CONFLICT DO NOTHING`;
  const bDobel = await aksi(AKUN.fin2, AM_A, "maju", null, 6);
  cek("pemutus tahap 3 (kini anggota hrd) ditolak pagar satu-akun", !bDobel.ok, bDobel.err ?? "");
  const bayar = await aksi(AKUN.hrd1, AM_A, "maju", "transfer 3 Nov", 6);
  r = await rekap();
  cek("HRD menandai dibayar → paid", bayar.ok && r.status === "paid", bayar.err ?? "");

  console.log("8. Rekap hasil backfill 270");
  const pindahan = await sql`
    SELECT b.am_id, b.status, r.kode, r.current_urutan, st.status AS step_status, ist.step AS step_dari_status
    FROM insentif_bulanan b
    JOIN approval_request r ON r.id = b.approval_request_id AND r.status = 'pending'
    JOIN approval_step st ON st.request_id = r.id AND st.urutan = r.current_urutan
    LEFT JOIN insentif_approval_step ist ON ist.status_dari = b.status
    WHERE b.am_id NOT IN (${AM_A}, ${AM_B})`;
  if (pindahan.length === 0) {
    console.log("  – tak ada rekap pindahan yang masih berjalan (dilewati)");
  }
  for (const p of pindahan) {
    cek(
      `${p.kode} (${p.am_id}, ${p.status}) tahap ${p.current_urutan} menunggu & sejalan dengan status`,
      p.step_status === "pending" && Number(p.step_dari_status) === Number(p.current_urutan),
    );
  }

  await bersihkan();
  console.log(gagal === 0 ? "\nSEMUA LOLOS" : `\n${gagal} GAGAL`);
  await sql.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await bersihkan(); } catch { /* biarkan */ }
  await sql.end();
  process.exit(1);
});
