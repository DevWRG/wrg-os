// Uji F10 bagian 3 — register cek keluar (#2095, migrasi 293) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-cek-keluar.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Memakai rekening seed 169 'MDR 038'; fixture rekening koran
// tanggal 2099-01-xx (tak mungkin bentrok data nyata) dan cek ber-seri 'UJI291 …' — semuanya dihapus di awal & akhir.
// WA_SEND_URL dikosongkan → gateway mode stub.
//
// Yang dibuktikan:
//   1. Validasi input (rekening, seri tanpa angka, jatuh tempo < terbit, nominal 0) → ditolak; seri ganda → 409.
//   2. Draft → ubah data → ajukan; draft lain → batal tanpa alasan ditolak, dengan alasan lolos.
//   3. Maker-checker: pembuat tak bisa menyetujui; orang lain bisa. Tolak tanpa alasan ditolak.
//   4. Saldo dari rekening koran terakhir (bukan perlu_review); peringatan saat beredar + cek > saldo.
//   5. Seri loncat ditandai.
//   6. Serahkan → cair otomatis dari mutasi debit (nominal + seri di deskripsi); mutasi nominal sama tanpa seri
//      tidak dicocokkan; satu mutasi tak dipakai dua cek.
//   7. Pengingat H-3/H: pratinjau memuat cek diserahkan yang jatuh tempo ≤ 3 hari, tidak yang jauh.
//   8. Log append-only lengkap per cek; transisi dari status final ditolak.

import { db } from "../../apps/api/src/db.js";
import { buatCek, cocokkanCair, daftarCek, runCekHarian, ubahDraft, ubahStatus } from "../../apps/api/src/repo/cek-keluar.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}
delete process.env.WA_SEND_URL;

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};
const tolak = async (f: () => Promise<unknown>, pola: RegExp) => {
  try { await f(); return false; } catch (e) { return pola.test((e as Error).message); }
};

let REK = "";
async function bersih() {
  const ids = (await sql<{ id: string }[]>`SELECT id::text FROM cek_keluar WHERE no_seri LIKE 'UJI291%'`).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM cek_keluar_log WHERE cek_id IN ${sql(ids)}`;
    await sql`DELETE FROM notif_state WHERE key LIKE 'f10-cek:%'`;
    await sql`DELETE FROM cek_keluar WHERE id IN ${sql(ids)}`;
  }
  await sql`DELETE FROM bank_statement WHERE bank_account_id = ${REK} AND tanggal >= '2099-01-01'`;
}

async function statement(tanggal: string, saldo: number, status: string, mutasi: { debit: number; deskripsi: string }[] = []) {
  const [s] = await sql<{ id: string }[]>`
    INSERT INTO bank_statement (bank_account_id, tanggal, saldo_akhir, sumber, metode, status)
    VALUES (${REK}, ${tanggal}, ${saldo}, 'web', 'manual', ${status}) RETURNING id::text`;
  let urut = 1;
  for (const m of mutasi) await sql`INSERT INTO bank_statement_line (statement_id, urut, deskripsi, debit) VALUES (${s.id}, ${urut++}, ${m.deskripsi}, ${m.debit})`;
}

const dasar = (o: Record<string, unknown> = {}) => ({
  bank_account_id: REK, no_seri: "UJI291 100001", tanggal_terbit: "2099-01-05", jatuh_tempo: "2099-01-05",
  penerima: "PT Vendor Uji", nominal: 40_000_000, keperluan: "bayar PO uji", ...o,
});

async function main() {
  const [r] = await sql<{ id: string }[]>`SELECT id::text FROM bank_account WHERE label_file = 'MDR 038'`;
  if (!r) { console.error("Rekening seed MDR 038 tak ada — jalankan migrasi 169."); process.exit(2); }
  REK = r.id;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM bank_statement WHERE bank_account_id = ${REK} AND tanggal > '2099-01-10'`;
  if (n) { console.error("Ada rekening koran MDR 038 sesudah 2099-01-10 — data uji bentrok."); process.exit(2); }
  await bersih();

  console.log("1. validasi");
  cek("rekening kosong", await tolak(() => buatCek(dasar({ bank_account_id: "" }), "Kolis"), /rekening wajib/));
  cek("seri tanpa angka", await tolak(() => buatCek(dasar({ no_seri: "CEK ABC" }), "Kolis"), /harus memuat angka/));
  cek("jatuh tempo < terbit", await tolak(() => buatCek(dasar({ jatuh_tempo: "2099-01-01" }), "Kolis"), /jatuh tempo/));
  cek("nominal 0", await tolak(() => buatCek(dasar({ nominal: 0 }), "Kolis"), /nominal/));

  console.log("2. draft → ubah → ajukan; batal");
  const c1 = await buatCek(dasar(), "Kolis");
  cek("draft dibuat", c1.status === "draft");
  cek("seri ganda 409", await tolak(() => buatCek(dasar(), "Kolis"), /sudah tercatat/));
  await ubahDraft(c1.id, dasar({ nominal: "45.000.000" }), "Kolis");
  const [n1] = await sql<{ nominal: string }[]>`SELECT nominal::text FROM cek_keluar WHERE id = ${c1.id}`;
  cek("ubah draft (nominal ber-titik dibersihkan)", Number(n1.nominal) === 45_000_000, n1);
  await ubahStatus(c1.id, "ajukan", { oleh: "Kolis" });
  cek("draft yang sudah diajukan tak bisa diubah", await tolak(() => ubahDraft(c1.id, dasar(), "Kolis"), /hanya cek berstatus draft/));
  const c2 = await buatCek(dasar({ no_seri: "UJI291 100002" }), "Kolis");
  cek("batal tanpa alasan ditolak", await tolak(() => ubahStatus(c2.id, "batal", { oleh: "Kolis" }), /alasan wajib/));
  await ubahStatus(c2.id, "batal", { oleh: "Kolis", catatan: "salah tulis" });

  console.log("3. maker-checker");
  cek("pembuat tak bisa setujui", await tolak(() => ubahStatus(c1.id, "setujui", { oleh: "kolis" }), /sendiri/));
  cek("tolak tanpa alasan ditolak", await tolak(() => ubahStatus(c1.id, "tolak", { oleh: "Ika" }), /alasan wajib/));

  console.log("4. saldo + peringatan");
  await statement("2099-01-03", 50_000_000, "terverifikasi");
  await statement("2099-01-04", 1, "perlu_review"); // tak boleh dipakai
  let d = await daftarCek({ status: "aktif" });
  const rek = d.rekening.find((x) => x.bank_account_id === REK);
  cek("saldo = statement terverifikasi terakhir", rek?.saldo === 50_000_000 && rek.saldo_tanggal === "2099-01-03", rek);
  cek("cek 45 jt aman (beredar 0)", d.items.find((x) => x.id === c1.id)?.peringatan_saldo === null);
  const c3 = await buatCek(dasar({ no_seri: "UJI291 100003", nominal: 10_000_000, jatuh_tempo: "2099-01-20", ajukan: true }), "Kolis");
  await ubahStatus(c1.id, "setujui", { oleh: "Ika" });
  d = await daftarCek({ status: "aktif" });
  cek("cek ke-2: beredar 45 + 10 > 50 → peringatan", /melebihi saldo/.test(d.items.find((x) => x.id === c3.id)?.peringatan_saldo ?? ""), d.items.find((x) => x.id === c3.id));
  const [p1] = await sql<{ diputus_oleh: string }[]>`SELECT diputus_oleh FROM cek_keluar WHERE id = ${c1.id}`;
  cek("penyetuju tercatat", p1.diputus_oleh === "Ika");

  console.log("5. seri loncat");
  const c4 = await buatCek(dasar({ no_seri: "UJI291 100009", nominal: 1_000_000 }), "Kolis");
  d = await daftarCek({ status: "aktif" });
  cek("100009 sesudah 100003 → harapkan 100004", d.items.find((x) => x.id === c4.id)?.seri_loncat === "100004", d.items.find((x) => x.id === c4.id)?.seri_loncat);
  cek("100003 urut", d.items.find((x) => x.id === c3.id)?.seri_loncat === null);

  console.log("6. cair otomatis");
  await ubahStatus(c1.id, "serahkan", { oleh: "Kolis" });
  await ubahStatus(c3.id, "setujui", { oleh: "Ika" });
  await ubahStatus(c3.id, "serahkan", { oleh: "Kolis" });
  await statement("2099-01-06", 5_000_000, "terverifikasi", [
    { debit: 10_000_000, deskripsi: "TRANSFER KE PT LAIN" },        // nominal c3 tapi tanpa seri
    { debit: 45_000_000, deskripsi: "KLIRING CEK 0100001 PT VENDOR" }, // c1
  ]);
  let cair = await cocokkanCair();
  const st = Object.fromEntries((await sql<{ id: string; status: string }[]>`SELECT id::text, status FROM cek_keluar WHERE no_seri LIKE 'UJI291%'`).map((x) => [x.id, x.status]));
  cek("c1 cair otomatis, c3 tetap diserahkan", cair === 1 && st[String(c1.id)] === "cair" && st[String(c3.id)] === "diserahkan", { cair, st });
  cair = await cocokkanCair();
  cek("sapuan ulang tak mencairkan lagi", cair === 0);
  cek("cair dari status final ditolak", await tolak(() => ubahStatus(c1.id, "tolak_bank", { oleh: "Kolis", catatan: "x" }), /tidak bisa/));

  console.log("7. pengingat");
  const c5 = await buatCek(dasar({ no_seri: "UJI291 100010", nominal: 2_000_000, jatuh_tempo: "2099-01-08", ajukan: true }), "Kolis");
  await ubahStatus(c5.id, "setujui", { oleh: "Ika" });
  await ubahStatus(c5.id, "serahkan", { oleh: "Kolis" });
  const pr = await runCekHarian({ dryRun: true, hariIni: "2099-01-06" });
  cek("pratinjau: c5 (H-2) masuk, c3 (14 hari lagi) tidak", pr.pengingat === 1 && /C\d+ UJI291 100010/.test(pr.payload ?? "") && !/100003/.test(pr.payload ?? ""), pr);
  const nyata = await runCekHarian({ hariIni: "2099-01-06" });
  cek("stub → tidak ditandai terkirim", nyata.sent === false);

  console.log("8. log");
  d = await daftarCek({ hari: 3650 });
  const log1 = d.items.find((x) => x.id === c1.id)?.log.map((l) => l.ke).join(">");
  cek("riwayat c1 lengkap", log1 === "draft>draft>diajukan>disetujui>diserahkan>cair", log1);
  cek("cair otomatis bertanda", d.items.find((x) => x.id === c1.id)?.cair_otomatis === true);
  const logBatal = d.items.find((x) => x.id === c2.id)?.log.at(-1);
  cek("alasan batal tercatat", logBatal?.ke === "batal" && logBatal.catatan === "salah tulis", logBatal);

  await bersih();
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  await sql.end();
  process.exit(gagal ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await bersih().catch(() => {}); process.exit(1); });
