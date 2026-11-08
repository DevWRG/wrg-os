// Uji F10 bagian 2 — faktur revisi + SLA (#2095, migrasi 290) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-revisi-faktur.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture faktur ber-id 9_290_xxx + libur ber-label 'uji290';
// tabel faktur_revisi dikosongkan (data uji saja). WA_SEND_URL dikosongkan → gateway mode stub.
//
// Yang dibuktikan:
//   1. Format salah (kosong / tanpa alasan) → balasan contoh, tak ada tiket.
//   2. Nomor tak ada → tak ada tiket; nomor ada di arsip hilang saja → tak ada tiket, balasan “sedang dihapus”.
//   3. #REVISI sah → tiket wa, batas SLA 8 jam kerja melewati Sabtu/Minggu + hari libur; nomor huruf kecil cocok.
//   4. #REVISI kedua untuk nomor sama → menyebut tiket yang ada, tak membuat baru.
//   5. Sync tanpa perubahan → tetap terbuka; optLock naik → selesai 'edit'.
//   6. Input ulang (id baru, nomor sama) → selesai 'input_ulang' dengan selesai_at = createDate faktur baru.
//   7. Deteksi input ulang tanpa #REVISI dari arsip hilang → tiket 'deteksi' tanpa SLA, tidak dobel di sync berikutnya.
//   8. Lewat SLA → stub tak menandai terlambat_dikirim (dicoba lagi sync berikutnya).
//   9. Tutup manual: catatan wajib, tiket selesai tak bisa ditutup lagi, status 'manual' di luar hitungan SLA;
//      daftarRevisi menghitung tepat SLA + lama proses jam kerja (lewat libur).

import { db } from "../../apps/api/src/db.js";
import { bukaRevisi, daftarRevisi, prosesRevisiSesudahSync, tutupManual } from "../../apps/api/src/repo/revisi-faktur.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}
delete process.env.WA_SEND_URL;
delete process.env.F10_REVISI_SLA_JAM_KERJA;
delete process.env.F10_JAM_KERJA;

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};

const B = 9_290_000;
const wib = (s: string) => new Date(`${s}+07:00`);
const LIBUR = "2026-11-10"; // Selasa — fixture libur (dihapus di akhir)

async function bersih() {
  await sql`DELETE FROM accurate_invoice WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_invoice_hilang WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM faktur_revisi`;
  await sql`DELETE FROM master_holiday WHERE tanggal = ${LIBUR} AND keterangan = 'uji290'`;
}

async function faktur(n: number, nomor: string, optLock: number, createDate: string) {
  await sql`INSERT INTO accurate_invoice (id, number, tanggal, status, raw)
            VALUES (${B + n}, ${nomor}, '2026-11-06', 'OPEN', ${sql.json({ optLock, createDate, customer: { name: "RSUD Uji" } })})
            ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw`;
}

async function main() {
  await bersih();
  const [libAda] = await sql`SELECT 1 FROM master_holiday WHERE tanggal = ${LIBUR}`;
  if (!libAda) await sql`INSERT INTO master_holiday (tanggal, keterangan) VALUES (${LIBUR}, 'uji290')`;
  const p = { nama: "Uji AM" };

  console.log("1–2. format & nomor");
  let t = await bukaRevisi("", p);
  cek("kosong → contoh", /Contoh:/.test(t), t);
  t = await bukaRevisi("UJI/290-1,", p);
  cek("tanpa alasan → contoh", /Alasan revisi wajib/.test(t), t);
  t = await bukaRevisi("UJI/290-404 | salah", p);
  cek("nomor tak ada → tidak dicatat", /tidak ditemukan/.test(t), t);
  await sql`INSERT INTO accurate_invoice_hilang (id, number, ada_kembaran, baris) VALUES (${B + 900}, 'UJI/290-HAPUS', false, '{}'::jsonb)`;
  t = await bukaRevisi("UJI/290-HAPUS | salah", p);
  cek("hanya di arsip hilang → tidak dicatat", /sedang dihapus/.test(t), t);
  let [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM faktur_revisi`;
  cek("belum ada tiket", n === 0);

  console.log("3–4. buka tiket + SLA");
  await faktur(1, "UJI/290-1", 3, "06/11/2026 09:00:00");
  // Senin 9 Nov 16:00 + 8 jam kerja: Senin 1 jam, Selasa libur, Rabu 7 jam → Rabu 15:00
  t = await bukaRevisi("uji/290-1 | harga item ke-2 salah", p, undefined, wib("2026-11-09T16:00:00"));
  cek("tiket dibuat", /Revisi R\d+ tercatat — UJI\/290-1 \(RSUD Uji\)/.test(t), t);
  const [r1] = await sql<{ id: string; batas_sla: Date; opt_lock_awal: number; sumber: string; alasan: string }[]>`SELECT id::text, batas_sla, opt_lock_awal, sumber, alasan FROM faktur_revisi`;
  cek("batas SLA lewat libur = Rabu 15:00", new Date(r1.batas_sla).getTime() === wib("2026-11-11T15:00:00").getTime(), r1.batas_sla);
  cek("optLock awal & alasan tersimpan", r1.opt_lock_awal === 3 && r1.alasan === "harga item ke-2 salah" && r1.sumber === "wa", r1);
  t = await bukaRevisi("UJI/290-1 | lagi", p, undefined, wib("2026-11-09T16:30:00"));
  cek("permintaan kedua → tiket yang ada", new RegExp(`sudah tercatat sebagai R${r1.id}`).test(t), t);

  console.log("5–6. tutup otomatis");
  let s = await prosesRevisiSesudahSync(wib("2026-11-09T18:00:00"));
  cek("tanpa perubahan → tetap terbuka", s.ditutup === 0, s);
  await faktur(1, "UJI/290-1", 4, "06/11/2026 09:00:00");
  s = await prosesRevisiSesudahSync(wib("2026-11-11T10:00:00"));
  const [e1] = await sql<{ cara_selesai: string; selesai_at: Date }[]>`SELECT cara_selesai, selesai_at FROM faktur_revisi WHERE id = ${r1.id}`;
  cek("optLock naik → selesai edit", s.ditutup === 1 && e1.cara_selesai === "edit" && new Date(e1.selesai_at).getTime() === wib("2026-11-11T10:00:00").getTime(), e1);

  await faktur(2, "UJI/290-2", 1, "06/11/2026 10:00:00");
  await bukaRevisi("UJI/290-2 | alamat salah", p, undefined, wib("2026-11-11T09:00:00"));
  await sql`DELETE FROM accurate_invoice WHERE id = ${B + 2}`;
  await faktur(3, "UJI/290-2", 0, "11/11/2026 13:20:00");
  s = await prosesRevisiSesudahSync(wib("2026-11-11T14:00:00"));
  const [e2] = await sql<{ cara_selesai: string; selesai_at: Date; invoice_id_baru: string }[]>`SELECT cara_selesai, selesai_at, invoice_id_baru::text FROM faktur_revisi WHERE nomor = 'UJI/290-2'`;
  cek("input ulang → selesai di createDate baru", e2.cara_selesai === "input_ulang" && new Date(e2.selesai_at).getTime() === wib("2026-11-11T13:20:00").getTime() && e2.invoice_id_baru === String(B + 3), e2);

  console.log("7. deteksi tanpa #REVISI");
  await sql`INSERT INTO accurate_invoice_hilang (id, number, ada_kembaran, baris) VALUES (${B + 4}, 'UJI/290-5', true, '{}'::jsonb)`;
  await faktur(5, "UJI/290-5", 0, "10/11/2026 11:00:00");
  s = await prosesRevisiSesudahSync(wib("2026-11-11T14:00:00"));
  cek("deteksi 1", s.dideteksi === 1, s);
  s = await prosesRevisiSesudahSync(wib("2026-11-11T16:00:00"));
  cek("tidak dobel", s.dideteksi === 0, s);
  const [e5] = await sql<{ sumber: string; batas_sla: Date | null; diminta_at: Date | null }[]>`SELECT sumber, batas_sla, diminta_at FROM faktur_revisi WHERE nomor = 'UJI/290-5'`;
  cek("tanpa SLA", e5.sumber === "deteksi" && e5.batas_sla === null && e5.diminta_at === null, e5);

  console.log("8. lewat SLA");
  await faktur(6, "UJI/290-6", 1, "06/11/2026 10:00:00");
  await bukaRevisi("UJI/290-6 | NPWP salah", p, undefined, wib("2026-11-11T09:00:00"));
  s = await prosesRevisiSesudahSync(wib("2026-11-13T09:00:00"));
  const [e6] = await sql<{ terlambat_dikirim: boolean }[]>`SELECT terlambat_dikirim FROM faktur_revisi WHERE nomor = 'UJI/290-6'`;
  cek("stub → belum ditandai terkirim", s.terlambat_dikirim === 0 && e6.terlambat_dikirim === false, { s, e6 });

  console.log("9. tutup manual + ringkasan");
  const [r6] = await sql<{ id: string }[]>`SELECT id::text FROM faktur_revisi WHERE nomor = 'UJI/290-6'`;
  let tolak = false;
  try { await tutupManual(r6.id, { catatan: " " }); } catch { tolak = true; }
  cek("catatan kosong ditolak", tolak);
  await tutupManual(r6.id, { catatan: "tidak perlu revisi", oleh: "uji" });
  tolak = false;
  try { await tutupManual(r6.id, { catatan: "lagi" }); } catch { tolak = true; }
  cek("tiket selesai tak bisa ditutup lagi", tolak);
  const d = await daftarRevisi({ hari: 60 }, wib("2026-11-13T09:00:00"));
  const st = Object.fromEntries(d.items.map((x) => [x.nomor, x.status]));
  cek("status per tiket", st["UJI/290-1"] === "tepat" && st["UJI/290-2"] === "tepat" && st["UJI/290-5"] === "tanpa-sla" && st["UJI/290-6"] === "manual", st);
  cek("ringkasan", d.ringkasan.terbuka === 0 && d.ringkasan.tanpa_sla === 1 && d.ringkasan.selesai_sla === 2 && d.ringkasan.tepat_sla_pct === 100, d.ringkasan);
  const x1 = d.items.find((x) => x.nomor === "UJI/290-1");
  cek("lama proses lewat libur = 1 jam + 2 jam", x1?.menit_proses === 180, x1);

  ;[{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM faktur_revisi`;
  await bersih();
  console.log(`\n${lolos} lolos, ${gagal} gagal (${n} tiket uji)`);
  await sql.end();
  process.exit(gagal ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await bersih().catch(() => {}); process.exit(1); });
