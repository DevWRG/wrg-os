// Uji F61 Tutup Buku Countdown (#1774, migrasi 295) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   env -u WA_SEND_URL DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-tutup-buku.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture ber-id 9_292_xxx (cabang UJI292-E/W,
// AM 9292001/9292002, SO, DO) — dihapus di awal & akhir. Gateway WA = stub (WA_SEND_URL kosong).
//
// Yang dibuktikan:
//   1. Ringkasan per region: SO "Menunggu diproses" + DO belum difaktur per AM, nilai netto;
//      SO "Sebagian diproses"/"Terproses" & DO Difaktur tak ikut; DO KSO tak ikut.
//   2. Tanggal tutup buku bawaan = hari kerja terakhir bulan; geser → dipakai; kosongkan → kembali.
//      Tanggal di luar bulan ditolak.
//   3. Pratinjau (paksaSisa) memuat AM & nilai per region; H-1 menambah eskalasi.
//   4. Job di luar H-7/H-3/H-1 diam; tujuan grup kosong → dilewati; stub gateway → tak ditandai terkirim.

import { db } from "../../apps/api/src/db.js";
import { geserTutupBuku, hariIniWib, ringkasPerRegion, runTutupBukuCountdown, tanggalTutupBuku } from "../../apps/api/src/repo/tutup-buku.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};
const B = 9_292_000;
const bulan = hariIniWib().slice(0, 7);

async function bersih() {
  await sql`DELETE FROM accurate_delivery_order_item WHERE delivery_id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_delivery_order WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_sales_order_item WHERE order_id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_sales_order WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_salesman WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM master_user WHERE am_id IN ('9292001','9292002')`;
  await sql`DELETE FROM hod_territory WHERE cabang IN ('UJI292-E','UJI292-W')`;
  await sql`DELETE FROM tutup_buku_bulan WHERE bulan = ${bulan}`;
  await sql`DELETE FROM notif_state WHERE key LIKE ${"tutup-buku:" + bulan + ":%"}`;
}

async function main() {
  try {
    await bersih();
    await sql`INSERT INTO hod_territory (hod_key, cabang, source) VALUES ('rocky','UJI292-E','uji292'), ('yogi','UJI292-W','uji292')`;
    await sql`INSERT INTO master_user (am_id, nama, cabang, aktif) VALUES ('9292001','AM Timur 292','UJI292-E',true), ('9292002','AM Barat 292','UJI292-W',true)`;
    await sql`INSERT INTO accurate_salesman (id, name, number, master_user_id) VALUES (${B + 1},'T292','AM Timur 292','9292001'), (${B + 2},'B292','AM Barat 292','9292002')`;
    const so = async (id: number, status: string, sid: number, baris: [string, number, number][]) => {
      await sql`INSERT INTO accurate_sales_order (id, number, trans_date, status) VALUES (${B + id}, ${"SO-U292-" + id}, ${hariIniWib()}, ${status})`;
      let n = 0;
      for (const [kat, qty, dpp] of baris) {
        n++;
        await sql`INSERT INTO accurate_sales_order_item (order_id, line_no, qty, line_id, raw) VALUES (${B + id}, ${n}, ${qty}, ${B * 10 + id * 10 + n},
          ${sql.json({ charField1: kat, salesman1Id: String(B + sid), dppAmount: dpp })})`;
      }
    };
    await so(1, "Menunggu diproses", 1, [["REGULAR", 2, 4_000_000]]);   // East: SO terbuka 4 jt
    await so(2, "Menunggu diproses", 2, [["REGULAR", 1, 1_500_000]]);   // West: SO terbuka 1,5 jt
    await so(3, "Sebagian diproses", 1, [["REGULAR", 5, 9_000_000]]);   // tak dihitung sebagai SO
    await so(4, "Terproses", 1, [["REGULAR", 1, 2_000_000], ["KSO", 1, 700_000]]);
    // DO East dari SO-4 baris 1 (REGULAR, belum difaktur) + DO KSO dari baris 2 (tak ikut)
    const dO = async (id: number, status: string, soLine: number, qty: number) => {
      await sql`INSERT INTO accurate_delivery_order (id, number, trans_date, status) VALUES (${B + id}, ${"DO-U292-" + id}, ${hariIniWib()}, ${status})`;
      await sql`INSERT INTO accurate_delivery_order_item (delivery_id, line_no, qty, sales_order_id, sales_order_detail_id, raw)
        VALUES (${B + id}, 1, ${qty}, ${B + 4}, ${B * 10 + 40 + soLine}, ${sql.json({ id: String(B * 100 + id) })})`;
    };
    await dO(10, "Dikirim", 1, 1);
    await dO(11, "Dikirim", 2, 1);
    await dO(12, "Difaktur", 1, 1);

    console.log("1. Ringkasan per region");
    const reg = await ringkasPerRegion();
    const e = reg.find((r) => r.region === "East"); const w = reg.find((r) => r.region === "West");
    const ae = e?.per_am.find((a) => a.am === "AM Timur 292"); const aw = w?.per_am.find((a) => a.am === "AM Barat 292");
    cek("East: AM Timur 1 SO (4 jt) + 1 DO (2 jt)", ae?.so === 1 && ae.so_nilai === 4_000_000 && ae.do_ === 1 && ae.do_nilai === 2_000_000, ae);
    cek("West: AM Barat 1 SO (1,5 jt), 0 DO", aw?.so === 1 && aw.so_nilai === 1_500_000 && aw.do_ === 0, aw);
    cek("SO Sebagian diproses/Terproses, DO Difaktur, DO KSO tak ikut", (ae?.so ?? 0) === 1 && (ae?.do_ ?? 0) === 1);

    console.log("2. Tanggal tutup buku");
    const bawaan = await tanggalTutupBuku(bulan);
    cek("bawaan = hari kerja terakhir, tak digeser", !bawaan.digeser && bawaan.tanggal.startsWith(bulan) && ![0, 6].includes(new Date(bawaan.tanggal + "T00:00:00Z").getUTCDay()), bawaan.tanggal);
    const gs = await geserTutupBuku(bulan, { tanggal: `${bulan}-25`, catatan: "uji 292" }, "Penguji 292");
    cek("geser ke tgl 25 dipakai", gs.tanggal === `${bulan}-25` && gs.digeser, gs);
    let tolak = false;
    try { await geserTutupBuku(bulan, { tanggal: "2000-01-01" }, null); } catch { tolak = true; }
    cek("tanggal di luar bulan ditolak", tolak);
    const kb = await geserTutupBuku(bulan, { tanggal: null }, null);
    cek("kosongkan → kembali ke bawaan", !kb.digeser && kb.tanggal === bawaan.tanggal, kb);

    console.log("3. Pratinjau");
    const p3 = await runTutupBukuCountdown({ dryRun: true, paksaSisa: 3 });
    const tE = p3.hasil.find((h) => h.tujuan === "Sales East")?.payload ?? "";
    cek("H-3 East memuat AM Timur & nilai", /3 hari kerja lagi/.test(tE) && /AM Timur 292 — 1 SO belum dikirim \(Rp4 jt\) · 1 DO belum difaktur \(Rp2 jt\)/.test(tE), tE.slice(0, 300));
    cek("H-3 tanpa eskalasi", !p3.hasil.some((h) => h.tujuan === "Eskalasi HoD"));
    const p1 = await runTutupBukuCountdown({ dryRun: true, paksaSisa: 1 });
    cek("H-1 ada eskalasi HoD + kata BESOK", /BESOK/.test(p1.hasil.find((h) => h.tujuan === "Eskalasi HoD")?.payload ?? ""), p1.hasil.map((h) => h.tujuan));

    console.log("4. Job");
    const tanpaPaksa = await runTutupBukuCountdown();
    const hariPengingat = [7, 3, 1].includes(tanpaPaksa.sisa_hari_kerja);
    cek("di luar H-7/H-3/H-1 → diam (atau hari ini memang hari pengingat)", hariPengingat || ("skipped" in tanpaPaksa && /bukan hari pengingat/.test(String(tanpaPaksa.skipped))), tanpaPaksa);
    const simpan = { ...process.env };
    delete process.env.TUTUP_BUKU_TARGET_EAST; delete process.env.TUTUP_BUKU_TARGET_WEST;
    const kos = await runTutupBukuCountdown({ paksaSisa: 3 });
    cek("tujuan grup kosong → dilewati", kos.hasil.every((h) => !h.sent && (h.skipped === "tujuan grup belum diatur" || h.skipped === "tak ada penjualan belum difaktur")), kos.hasil);
    process.env.TUTUP_BUKU_TARGET_EAST = "uji292@g.us";
    const stub = await runTutupBukuCountdown({ paksaSisa: 3, region: "East" });
    const [tanda] = await sql`SELECT count(*)::int AS n FROM notif_state WHERE key = ${`tutup-buku:${bulan}:H3:East`}`;
    cek("stub gateway → sent=false & tak ditandai", stub.hasil[0]?.sent === false && Number(tanda.n) === 0, { h: stub.hasil, n: tanda.n });
    process.env.TUTUP_BUKU_TARGET_EAST = simpan.TUTUP_BUKU_TARGET_EAST; if (simpan.TUTUP_BUKU_TARGET_EAST === undefined) delete process.env.TUTUP_BUKU_TARGET_EAST;
  } finally {
    await bersih();
    await sql.end();
  }
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

void main();
