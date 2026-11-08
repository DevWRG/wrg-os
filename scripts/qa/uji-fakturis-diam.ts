// Uji F10 bagian 1 — alarm fakturis diam (#2095, migrasi 289) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-fakturis-diam.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture faktur ber-id 9_289_xxx; tabel fakturis_diam &
// fakturis_akun dikosongkan (data uji saja — JANGAN jalankan di DB yang alarm-nya sudah dipakai).
// Hari uji = hari kerja (Sen–Jum) terakhir ≤ hari ini, jadi hasilnya tak bergantung hari dijalankan.
// WA_SEND_URL dikosongkan → gateway mode stub (tak ada yang terkirim, sent dihitung false).
//
// Yang dibuktikan:
//   1. Faktur 09:30, cek 12:00 (150 mnt) → normal; cek 12:31 (≥ 3 jam) → alarm, satu kejadian terbuka.
//   2. Cek berikutnya selama masih diam → tidak membuka kejadian kedua.
//   3. Faktur baru 13:10 → pulih, durasi 220 mnt, kejadian ditutup dengan nomor faktur baru.
//   4. Faktur kemarin saja → hitung dari 08:00 hari uji (cek 10:00 normal, 11:00 alarm).
//   5. Label fakturis_akun dipakai di teks; tanpa label → “akun Accurate <id>”.
//   6. F10_SPOF_JAM=1 → ambang ikut env.
//   7. Rekap mingguan: hitung per akun minggu lalu saja, dry-run tak menulis notif_state.
//   8. Layar: statusFakturis (status, akun 60 hari, riwayat) + simpanLabelAkun (simpan, hapus, tolak input salah).

import { db } from "../../apps/api/src/db.js";
import { runCekFakturisDiam, runRekapFakturis, simpanLabelAkun, statusFakturis } from "../../apps/api/src/repo/fakturis-diam.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}
delete process.env.WA_SEND_URL;
delete process.env.F10_SPOF_JAM;
delete process.env.F10_JAM_KERJA;

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};

const B = 9_289_000;
const wib = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+07:00`);
const tambahHari = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const createDate = (ymd: string, hm: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)} ${hm}:00`;

// Hari kerja terakhir ≤ hari ini (WIB), dan hari kerja sebelumnya.
let D = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const kerja = (ymd: string) => ![0, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());
while (!kerja(D)) D = tambahHari(D, -1);
let K = tambahHari(D, -1);
while (!kerja(K)) K = tambahHari(K, -1);

async function bersih() {
  await sql`DELETE FROM accurate_invoice WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM fakturis_diam`;
  await sql`DELETE FROM fakturis_akun`;
  await sql`DELETE FROM notif_state WHERE key LIKE 'f10-fakturis-rekap:%'`;
}

async function faktur(n: number, ymd: string, hm: string, akun: string) {
  const raw = { createDate: createDate(ymd, hm), createdBy: akun };
  await sql`INSERT INTO accurate_invoice (id, number, tanggal, status, raw) VALUES (${B + n}, ${`UJI/289-${n}`}, ${ymd}, 'OPEN', ${sql.json(raw)})`;
}

async function main() {
  // Sembunyikan faktur asli supaya “faktur terakhir” = fixture: uji di DB bersih/dev, bukan data hidup.
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM accurate_invoice WHERE tanggal >= current_date - 12 AND id NOT BETWEEN ${B} AND ${B + 999}`;
  if (n > 0) { console.error(`Ada ${n} faktur asli 12 hari terakhir — jalankan di DB uji bersih.`); process.exit(2); }

  await bersih();
  console.log(`Hari uji ${D} (kemarin kerja ${K})`);

  console.log("1–3. diam → alarm → pulih");
  await faktur(1, D, "09:30", "829215");
  let r = await runCekFakturisDiam({ sekarang: wib(D, "12:00") });
  cek("12:00 normal (150 mnt)", r.aksi === "normal" && r.menit === 150, r);
  r = await runCekFakturisDiam({ sekarang: wib(D, "12:31") });
  cek("12:31 alarm", r.aksi === "alarm" && r.menit === 181, r);
  let [{ buka }] = await sql<{ buka: number }[]>`SELECT count(*)::int buka FROM fakturis_diam WHERE pulih_at IS NULL`;
  cek("satu kejadian terbuka", buka === 1);
  r = await runCekFakturisDiam({ sekarang: wib(D, "14:00") });
  cek("14:00 masih diam, tanpa kejadian kedua", r.aksi === "masih-diam" && r.menit === 270, r);
  const [{ semua }] = await sql<{ semua: number }[]>`SELECT count(*)::int semua FROM fakturis_diam`;
  cek("total kejadian tetap 1", semua === 1);
  await faktur(2, D, "13:10", "836342");
  r = await runCekFakturisDiam({ sekarang: wib(D, "14:00"), dryRun: true });
  cek("pratinjau pulih tak menulis DB", r.aksi === "pulih" && /UJI\/289-2/.test(r.payload ?? ""), r);
  [{ buka }] = await sql<{ buka: number }[]>`SELECT count(*)::int buka FROM fakturis_diam WHERE pulih_at IS NULL`;
  cek("…kejadian masih terbuka sesudah dry-run", buka === 1);
  r = await runCekFakturisDiam({ sekarang: wib(D, "14:00") });
  cek("pulih 220 mnt", r.aksi === "pulih" && r.menit === 220, r);
  const [k] = await sql<{ pulih_faktur: string; pulih_at: Date }[]>`SELECT pulih_faktur, pulih_at FROM fakturis_diam`;
  cek("kejadian ditutup dengan faktur baru", k.pulih_faktur === "UJI/289-2" && new Date(k.pulih_at).getTime() === wib(D, "13:10").getTime(), k);
  r = await runCekFakturisDiam({ sekarang: wib(D, "15:00") });
  cek("sesudah pulih → normal", r.aksi === "normal", r);

  console.log("4–5. faktur kemarin saja + label");
  await bersih();
  await faktur(3, K, "16:45", "829215");
  r = await runCekFakturisDiam({ sekarang: wib(D, "10:00") });
  cek("10:00 normal (dihitung dari 08:00)", r.aksi === "normal" && r.menit === 120, r);
  r = await runCekFakturisDiam({ sekarang: wib(D, "11:00"), dryRun: true });
  cek("11:00 alarm, teks pakai id akun", r.aksi === "alarm" && /akun Accurate 829215/.test(r.payload ?? ""), r.payload);
  await sql`INSERT INTO fakturis_akun (created_by, label) VALUES ('829215', 'Fakturis Pusat')`;
  r = await runCekFakturisDiam({ sekarang: wib(D, "11:00"), dryRun: true });
  cek("label dipakai", /Fakturis Pusat/.test(r.payload ?? "") && !/akun Accurate/.test(r.payload ?? ""), r.payload);

  console.log("6. ambang dari env");
  process.env.F10_SPOF_JAM = "1";
  r = await runCekFakturisDiam({ sekarang: wib(D, "09:05"), dryRun: true });
  cek("F10_SPOF_JAM=1 → alarm 09:05", r.aksi === "alarm" && r.ambang_jam === 1, r);
  delete process.env.F10_SPOF_JAM;

  console.log("7. rekap mingguan");
  await bersih();
  const dow = (new Date(`${D}T00:00:00Z`).getUTCDay() + 6) % 7;
  const seninLalu = tambahHari(D, -dow - 7);
  await faktur(10, seninLalu, "09:00", "829215");
  await faktur(11, tambahHari(seninLalu, 1), "10:00", "829215");
  await faktur(12, tambahHari(seninLalu, 2), "11:00", "829215");
  await faktur(13, tambahHari(seninLalu, 4), "15:00", "836342");
  await faktur(14, tambahHari(seninLalu, 7), "09:00", "836342"); // minggu ini → tak dihitung
  const rk = await runRekapFakturis({ sekarang: wib(D, "08:15"), dryRun: true });
  cek("rekap: 4 faktur minggu lalu, 75% satu akun", /4 faktur oleh 2 akun/.test(rk.payload ?? "") && /829215: 3 \(75%\)/.test(rk.payload ?? "") && /memegang 75%/.test(rk.payload ?? ""), rk.payload);
  const [{ ns }] = await sql<{ ns: number }[]>`SELECT count(*)::int ns FROM notif_state WHERE key LIKE 'f10-fakturis-rekap:%'`;
  cek("dry-run tak menulis notif_state", ns === 0);
  const rk2 = await runRekapFakturis({ sekarang: wib(D, "08:15") });
  cek("kirim stub → tidak ditandai terkirim", rk2.sent === false, rk2);

  console.log("8. layar status + label akun");
  await sql`INSERT INTO fakturis_diam (sejak_at, pulih_at, pulih_faktur, faktur_terakhir) VALUES (${wib(D, "09:00")}, ${wib(D, "13:00")}, 'UJI/289-B', 'UJI/289-A')`;
  let st = await statusFakturis(wib(D, "08:30"));
  cek("status: 2 akun, urut terbanyak", st.akun.length === 2 && st.akun[0].created_by === "829215" && st.akun[0].faktur_60h === 3, st.akun);
  cek("status: riwayat 1 kejadian 240 mnt", st.kejadian.length === 1 && st.kejadian[0].menit === 240, st.kejadian);
  await simpanLabelAkun({ created_by: "836342", label: "  Fakturis B  ", oleh: "uji" });
  st = await statusFakturis(wib(D, "08:30"));
  cek("label tersimpan & di-trim", st.akun.find((a) => a.created_by === "836342")?.label === "Fakturis B");
  await simpanLabelAkun({ created_by: "836342", label: "" });
  st = await statusFakturis(wib(D, "08:30"));
  cek("label kosong = hapus", st.akun.find((a) => a.created_by === "836342")?.label === null);
  let tolak = 0;
  for (const bad of [{ created_by: "abc", label: "x" }, { created_by: "1", label: "x".repeat(81) }]) {
    try { await simpanLabelAkun(bad); } catch { tolak++; }
  }
  cek("input salah ditolak", tolak === 2);

  await bersih();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  await sql.end();
  process.exit(gagal ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await bersih().catch(() => {}); process.exit(1); });
