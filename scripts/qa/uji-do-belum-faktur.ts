// Uji F149 DO belum difaktur (#2052, migrasi 283) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-do-belum-faktur.ts
//
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture ber-id 9_283_xxx (customer,
// salesman, AM `9283001`, SO, DO, faktur) — dihapus di awal & akhir. Tanggal DO dihitung
// mundur dari hari ini dalam HARI KERJA (melewati Sabtu/Minggu + master_holiday), jadi
// hasilnya tak bergantung hari uji dijalankan.
//
// Yang dibuktikan:
//   1. Hanya status Dikirim / Difaktur Sebagian yang tampil; Difaktur & Draf tidak.
//   2. DO yang semua barisnya KSO → tab KSO, tak pernah terlambat; campuran KSO+REGULAR → tab Tagih.
//   3. Terlambat = lewat 3 hari kerja (hari libur di master_holiday ikut dilewati).
//   4. Difaktur Sebagian: nilai = sisa qty × netto per unit SO; baris yang sudah lunas difaktur tak dihitung.
//   5. AM & cabang dari salesman baris SO (joinAmFromSalesman).
//   6. DO tanpa item tersinkron tetap di tab Tagih dengan nilai kosong.
//   7. Ubah ambang → status terlambat ikut berubah; ambang tak sah ditolak.
//   8. Filter cari/cabang/hanya terlambat + total_rows server.
//   9. Rekap WA: pratinjau memuat DO terlambat saja (tanpa KSO); tanpa target → dilewati;
//      kiriman stub/dry-run gateway TIDAK menandai minggu ini terkirim.

import { db } from "../../apps/api/src/db.js";
import { listDoBelumFaktur, runRekapDoBelumFaktur, ubahAmbang } from "../../apps/api/src/repo/do-belum-faktur.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};

const B = 9_283_000;
const LIBUR = "uji283";

async function bersih() {
  await sql`DELETE FROM accurate_invoice_item WHERE invoice_id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_invoice WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_delivery_order_item WHERE delivery_id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_delivery_order WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_sales_order_item WHERE order_id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_sales_order WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_salesman WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM accurate_customer WHERE id BETWEEN ${B} AND ${B + 999}`;
  await sql`DELETE FROM master_user WHERE am_id = '9283001'`;
  await sql`DELETE FROM master_holiday WHERE keterangan = ${LIBUR}`;
  await sql`DELETE FROM do_belum_faktur_param WHERE kunci = 'ambang_hari_kerja'`;
  await sql`INSERT INTO do_belum_faktur_param (kunci, nilai) VALUES ('ambang_hari_kerja', 3)`;
}

/** Tanggal N hari kerja sebelum hari ini (WIB), Sabtu/Minggu + master_holiday dilewati. */
async function mundurHariKerja(n: number): Promise<string> {
  const [r] = await sql`
    SELECT d::date::text AS t FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 60, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') d
    WHERE produk_permintaan_hari_kerja(d::date, (now() AT TIME ZONE 'Asia/Jakarta')::date) = ${n}
    ORDER BY d DESC LIMIT 1`;
  return String(r.t);
}

async function main() {
  try {
    await bersih();
    // satu hari libur di tengah jendela 5 hari kerja terakhir → harus dilewati
    const libur = await mundurHariKerja(2);
    await sql`INSERT INTO master_holiday (tanggal, keterangan) VALUES (${libur}, ${LIBUR}) ON CONFLICT DO NOTHING`;

    await sql`INSERT INTO master_user (am_id, nama, cabang, aktif) VALUES ('9283001', 'AM Uji 283', 'MALANG', true)`;
    await sql`INSERT INTO accurate_salesman (id, name, number, master_user_id) VALUES (${B + 1}, 'U283', 'AM Uji 283', '9283001')`;
    await sql`INSERT INTO accurate_customer (id, no, name) VALUES (${B + 1}, 'C-U283-1', 'RS UJI 283 REGULAR'), (${B + 2}, 'C-U283-2', 'RS UJI 283 KSO')`;

    // SO: baris 1 REGULAR 10 × netto 1.000.000; baris 2 KSO 5 × 200.000; baris 3 REGULAR 4 × 250.000
    await sql`INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, customer_id) VALUES (${B + 1}, 'SO-U283', ${await mundurHariKerja(10)}, 'RS UJI 283 REGULAR', 'Terproses', ${B + 1})`;
    const so = (line: number, kat: string, qty: number, dpp: number) =>
      sql`INSERT INTO accurate_sales_order_item (order_id, line_no, qty, line_id, raw) VALUES (${B + 1}, ${line}, ${qty}, ${B * 10 + line},
        ${sql.json({ charField1: kat, salesman1Id: String(B + 1), dppAmount: dpp })})`;
    await so(1, "REGULAR", 10, 10_000_000); await so(2, "KSO", 5, 1_000_000); await so(3, "REGULAR", 4, 1_000_000);

    const dO = async (id: number, nomor: string, tgl: string, status: string, cust: number, baris: [number, number, number][]) => {
      await sql`INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, status, customer_id)
        VALUES (${B + id}, ${nomor}, ${tgl}, ${cust === 1 ? "RS UJI 283 REGULAR" : "RS UJI 283 KSO"}, ${status}, ${B + cust})`;
      for (const [line, soLine, qty] of baris) {
        await sql`INSERT INTO accurate_delivery_order_item (delivery_id, line_no, qty, sales_order_id, sales_order_detail_id, raw)
          VALUES (${B + id}, ${line}, ${qty}, ${B + 1}, ${B * 10 + soLine}, ${sql.json({ id: String(B * 100 + id * 10 + line) })})`;
      }
    };
    const hk2 = await mundurHariKerja(2), hk4 = await mundurHariKerja(4), hk6 = await mundurHariKerja(6), hk20 = await mundurHariKerja(20);
    await dO(10, "DO-U283-REG-BARU", hk2, "Dikirim", 1, [[1, 1, 3]]);            // 2 hk → belum terlambat, nilai 3 jt
    await dO(11, "DO-U283-REG-LAMA", hk4, "Dikirim", 1, [[1, 1, 2]]);            // 4 hk → terlambat, 2 jt
    await dO(12, "DO-U283-KSO", hk20, "Dikirim", 2, [[1, 2, 5]]);                // KSO murni → tab KSO
    await dO(13, "DO-U283-CAMPUR", hk6, "Dikirim", 2, [[1, 2, 1], [2, 3, 2]]);   // KSO+REGULAR → Tagih
    await dO(14, "DO-U283-SEBAGIAN", hk6, "Difaktur Sebagian", 1, [[1, 1, 4], [2, 3, 4]]);
    await dO(15, "DO-U283-SUDAH", hk6, "Difaktur", 1, [[1, 1, 1]]);
    await dO(16, "DO-U283-DRAF", hk2, "Draf", 1, [[1, 1, 1]]);
    await dO(17, "DO-U283-TANPA-ITEM", hk4, "Dikirim", 1, []);
    // faktur parsial DO-14: baris 1 difaktur 1 dari 4, baris 2 lunas 4 dari 4
    await sql`INSERT INTO accurate_invoice (id, number, customer_id, tanggal, status) VALUES (${B + 1}, 'INV-U283', ${B + 1}, ${hk2}, 'OPEN')`;
    await sql`INSERT INTO accurate_invoice_item (invoice_id, line_no, qty, raw) VALUES
      (${B + 1}, 1, 1, ${sql.json({ deliveryOrderDetailId: String(B * 100 + 14 * 10 + 1) })}),
      (${B + 1}, 2, 4, ${sql.json({ deliveryOrderDetailId: String(B * 100 + 14 * 10 + 2) })})`;

    const ambil = async (tab: "tagih" | "kso", extra: Record<string, unknown> = {}) => {
      const r = await listDoBelumFaktur({ tab, limit: 500, ...extra });
      return { ...r, uji: r.items.filter((x) => x.nomor.startsWith("DO-U283")) };
    };
    const t = await ambil("tagih");
    const k = await ambil("kso");
    const by = (n: string) => [...t.uji, ...k.uji].find((x) => x.nomor === n);

    console.log("1. Status");
    cek("Difaktur & Draf tak tampil", !by("DO-U283-SUDAH") && !by("DO-U283-DRAF"));
    cek("Dikirim & Difaktur Sebagian tampil", !!by("DO-U283-REG-BARU") && !!by("DO-U283-SEBAGIAN"));

    console.log("2. Tab KSO");
    cek("KSO murni → tab KSO, tidak terlambat walau 20 hk", k.uji.length === 1 && by("DO-U283-KSO")?.tab === "kso" && by("DO-U283-KSO")?.terlambat === false, k.uji);
    cek("campuran KSO+REGULAR → tab Tagih", by("DO-U283-CAMPUR")?.tab === "tagih");

    console.log("3. Hari kerja & terlambat (libur ikut dilewati)");
    cek("2 hk → belum terlambat", by("DO-U283-REG-BARU")?.hari_kerja === 2 && by("DO-U283-REG-BARU")?.terlambat === false, by("DO-U283-REG-BARU"));
    cek("4 hk → terlambat", by("DO-U283-REG-LAMA")?.hari_kerja === 4 && by("DO-U283-REG-LAMA")?.terlambat === true, by("DO-U283-REG-LAMA"));
    cek("umur kalender ≥ hari kerja", (by("DO-U283-REG-LAMA")?.umur_hari ?? 0) >= 4);

    console.log("4. Nilai & faktur sebagian");
    cek("DO baru 3 × 1 jt = 3 jt", by("DO-U283-REG-BARU")?.nilai === 3_000_000, by("DO-U283-REG-BARU")?.nilai);
    cek("sebagian: sisa 3 × 1 jt (baris lunas tak dihitung)", by("DO-U283-SEBAGIAN")?.nilai === 3_000_000 && by("DO-U283-SEBAGIAN")?.baris_sisa === 1, by("DO-U283-SEBAGIAN"));
    cek("campuran 1×200rb + 2×250rb = 700rb", by("DO-U283-CAMPUR")?.nilai === 700_000, by("DO-U283-CAMPUR")?.nilai);

    console.log("5. AM & cabang");
    cek("AM dari salesman baris SO", by("DO-U283-REG-LAMA")?.am === "AM Uji 283", by("DO-U283-REG-LAMA")?.am);
    cek("cabang = cabang AM", by("DO-U283-REG-LAMA")?.cabang === "MALANG", by("DO-U283-REG-LAMA")?.cabang);

    console.log("6. Item belum tersinkron");
    const ti = by("DO-U283-TANPA-ITEM");
    cek("tetap di Tagih, nilai kosong, ditandai", ti?.tab === "tagih" && ti?.nilai === null && ti?.item_tersinkron === false && ti?.am === "VACANT", ti);

    console.log("7. Ambang");
    await ubahAmbang(5, "Penguji 283");
    const t5 = await ambil("tagih");
    cek("ambang 5 → DO 4 hk tak lagi terlambat", t5.uji.find((x) => x.nomor === "DO-U283-REG-LAMA")?.terlambat === false && t5.ambang_hari_kerja === 5);
    let tolak = false;
    try { await ubahAmbang(2.5, null); } catch { tolak = true; }
    cek("ambang 2,5 ditolak", tolak);
    await ubahAmbang(3, "Penguji 283");

    console.log("8. Filter & ringkasan");
    const cari = await ambil("tagih", { q: "u283-reg" });
    cek("cari nomor", cari.uji.length === 2 && cari.uji.every((x) => x.nomor.includes("REG")));
    const tl = await ambil("tagih", { hanya_terlambat: true, cabang: "MALANG" });
    cek("hanya terlambat + cabang MALANG", tl.uji.length > 0 && tl.uji.every((x) => x.terlambat && x.cabang === "MALANG"), tl.uji.map((x) => x.nomor));
    const hal = await listDoBelumFaktur({ tab: "tagih", limit: 2, offset: 0 });
    cek("pagination server: count ≤ limit, total_rows = semua", hal.count <= 2 && hal.total_rows >= 5, { c: hal.count, t: hal.total_rows });
    cek("urutan: terlambat dulu", !hal.items.length || hal.items[0].terlambat || !t.items.some((x) => x.terlambat));
    cek("ringkasan KSO tanpa terlambat", t.ringkasan.kso.terlambat === 0 && t.ringkasan.kso.do >= 1);

    console.log("9. Rekap WA");
    const pr = await runRekapDoBelumFaktur({ dryRun: true });
    cek("pratinjau memuat DO terlambat, bukan yang belum terlambat / KSO", !!pr.payload?.includes("DO-U283-REG-LAMA") && !pr.payload?.includes("DO-U283-REG-BARU") && !pr.payload?.includes("DO-U283-KSO"), pr.payload?.slice(0, 200));
    const simpanT = [process.env.DO_BELUM_FAKTUR_WA_TARGET, process.env.INVOICE_REMINDER_FINANCE_TARGET];
    delete process.env.DO_BELUM_FAKTUR_WA_TARGET; delete process.env.INVOICE_REMINDER_FINANCE_TARGET;
    const tanpa = await runRekapDoBelumFaktur();
    cek("tanpa target → dilewati", tanpa.sent === false && /kosong/.test(tanpa.skipped ?? ""), tanpa);
    process.env.DO_BELUM_FAKTUR_WA_TARGET = "uji283@g.us";
    const stub = await runRekapDoBelumFaktur();
    const [tanda] = await sql`SELECT count(*)::int AS n FROM notif_state WHERE key = ${"do-belum-faktur-rekap:" + stub.week}`;
    cek("gateway stub/dry-run → sent=false & minggu ini tak ditandai", stub.sent === false && Number(tanda.n) === 0, { stub, n: tanda.n });
    if (simpanT[0] === undefined) delete process.env.DO_BELUM_FAKTUR_WA_TARGET; else process.env.DO_BELUM_FAKTUR_WA_TARGET = simpanT[0];
    if (simpanT[1] !== undefined) process.env.INVOICE_REMINDER_FINANCE_TARGET = simpanT[1];
  } finally {
    await bersih();
    await sql.end();
  }
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

void main();
