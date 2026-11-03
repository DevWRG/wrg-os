// Uji fungsional F90 #ORDER via WA (migrasi 239) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" ORDER_PERIODE_HARGA=UJI90 WA_SEND_URL= npx tsx scripts/qa/uji-order-wa.ts
//
// ORDER_PERIODE_HARGA=UJI90 WAJIB: barang uji ditaruh di periode price book sendiri supaya
// tak bercampur price book asli. Menolak jalan bila DATABASE_URL menyebut prod.
// Fixture (customer, item, price book, SO, AM) memakai penanda `UJI90` dan dihapus di akhir.
//
// Yang dibuktikan:
//   1. Pesan baru → draft + ringkasan; harga default = price list, harga @ dipakai.
//   2. Ditolak tanpa draft: harga di bawah lantai, barang ambigu/tak ada, faskes tak ada,
//      peran non-sales, lebih dari 30 baris.
//   3. "#ORDER ya O<id>" → antrean; AM lain tak bisa; konfirmasi dobel ditolak; draft
//      lewat 24 jam ditolak; batal oleh AM; #ORDER status.
//   4. Cocok otomatis ke SO Accurate (customer, tanggal −1..+14, kode item); SO di luar
//      jendela / kode beda tidak dicocokkan; SATU SO tak dipakai DUA pesanan.
//   5. Transisi status admin: selesai wajib no. SO, batal wajib alasan, transisi terlarang.
//   6. Scope daftar: AM hanya miliknya, HoD per cabang.

import { db } from "../../apps/api/src/db.js";
import { FULL_SCOPE, type DataScope } from "../../apps/api/src/repo/access-scope.js";
import { balasanOrder, cocokkanSo, daftarOrder, ubahStatusOrder } from "../../apps/api/src/repo/order-wa.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}
if (process.env.ORDER_PERIODE_HARGA !== "UJI90") {
  console.error("Set ORDER_PERIODE_HARGA=UJI90 — barang uji ada di periode price book sendiri.");
  process.exit(2);
}

const sql = db();
let gagal = 0;
const cek = (nama: string, ok: boolean, ket = "") => {
  console.log(`${ok ? "  ✔" : "  ✘"} ${nama}${ket ? "  — " + ket.split("\n")[0].slice(0, 140) : ""}`);
  if (!ok) gagal++;
};

const CUST_A = 990901; // RSUD UJI90 KOTA SEMBILAN
const CUST_B = 990902; // KLINIK UJI90 MAWAR
const AM1 = { am_id: "UJI90A", nama: "AM Uji90 A", role: "am" };
const AM2 = { am_id: "UJI90B", nama: "AM Uji90 B", role: "am" };
const OPS = { am_id: "UJI90C", nama: "Ops Uji90", role: "operasional" };

async function bersihkan() {
  await sql`DELETE FROM order_wa WHERE am_id IN ('UJI90A','UJI90B','UJI90C')`;
  await sql`DELETE FROM accurate_sales_order_item WHERE order_id IN (SELECT id FROM accurate_sales_order WHERE number LIKE 'SO-UJI90-%')`;
  await sql`DELETE FROM accurate_sales_order WHERE number LIKE 'SO-UJI90-%'`;
  await sql`DELETE FROM product_pricelist WHERE periode = 'UJI90'`;
  await sql`DELETE FROM accurate_item WHERE no LIKE 'UJX.%'`;
  await sql`DELETE FROM accurate_customer WHERE id IN (${CUST_A}, ${CUST_B})`;
  await sql`DELETE FROM master_user WHERE am_id IN ('UJI90A','UJI90B','UJI90C')`;
}

async function setup() {
  await sql`INSERT INTO accurate_customer (id, no, name) VALUES
    (${CUST_A}, 'C-UJI90-1', 'RSUD UJI90 KOTA SEMBILAN'), (${CUST_B}, 'C-UJI90-2', 'KLINIK UJI90 MAWAR')`;
  await sql`INSERT INTO master_user (am_id, nama, role, cabang) VALUES
    ('UJI90A', 'AM Uji90 A', 'AM', 'UJI90 TIMUR'), ('UJI90B', 'AM Uji90 B', 'AM', 'UJI90 BARAT')`;
  await sql`INSERT INTO accurate_item (id, no, name, quantity) VALUES
    (990801, 'UJX.1001', 'Reagen Uji Glukosa', 50), (990802, 'UJX.1002', 'Reagen Uji Kolesterol', 0)`;
  // row_no unik per periode; Zeta 1 & Zeta 2 sengaja mirip → ambigu.
  await sql`INSERT INTO product_pricelist (periode, row_no, kode, lini, brand, nama, varian, kemasan, price_list, diskon_maks, harga_nett, nett_ppn) VALUES
    ('UJI90', 1, 'UJX.1001', 'IVD', 'UjiBrand', 'Glukosa Ujinova', NULL, 'box', 500000, 0.2, 400000, 444000),
    ('UJI90', 2, 'UJX.1002', 'IVD', 'UjiBrand', 'Kolesterol Ujinova', NULL, 'box', 800000, 0.1, 720000, 799200),
    ('UJI90', 3, NULL, 'IVD', 'UjiBrand', 'Zetakit Ujinova', 'satu', 'kit', 100000, 0, 100000, 111000),
    ('UJI90', 4, NULL, 'IVD', 'UjiBrand', 'Zetakit Ujinova', 'dua', 'kit', 120000, 0, 120000, 133200)`;
}

const idDari = (t: string) => Number(/O(\d+)/.exec(t)?.[1] ?? NaN);
const statusOrder = async (id: number) => (await sql`SELECT status, so_number, selesai_oleh FROM order_wa WHERE id = ${id}`)[0];

async function main() {
  await bersihkan();
  await setup();

  console.log("1. Draft");
  const t1 = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nUJX.1001 2\nUJX.1002 1 @ 750000", AM1, "jid-a");
  const o1 = idDari(t1);
  cek("draft dibuat + ringkasan", /Draft O\d+/.test(t1) && Number.isFinite(o1), t1);
  const it1 = await sql`SELECT kode, qty::float8 AS qty, harga::float8 AS harga, stok::float8 AS stok FROM order_wa_item WHERE order_id = ${o1} ORDER BY urut`;
  cek("harga default = price list, @ dipakai", it1[0]?.harga === 500000 && it1[1]?.harga === 750000, JSON.stringify(it1));
  cek("stok Accurate tercatat (stok 0 ditandai)", it1[0]?.stok === 50 && it1[1]?.stok === 0 && /stok 0/.test(t1));
  cek("total di ringkasan", /Rp 1\.750\.000/.test(t1), t1.split("\n").find((l) => l.startsWith("Total")) ?? "");
  cek("status draft", (await statusOrder(o1)).status === "draft");

  console.log("2. Ditolak tanpa draft");
  const n0 = (await sql`SELECT count(*)::int AS n FROM order_wa WHERE am_id LIKE 'UJI90%'`)[0].n;
  const lantai = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nUJX.1001 1 @ 350000", AM1, null);
  cek("harga di bawah lantai ditolak", /di bawah harga nett/.test(lantai), lantai);
  const ambigu = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nzetakit ujinova 1", AM1, null);
  cek("barang ambigu minta kode", /cocok ke 2 barang/.test(ambigu), ambigu);
  const takAda = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nbarang hantu xyzq 1", AM1, null);
  cek("barang tak ada ditolak", /tidak ditemukan di price book/.test(takAda), takAda);
  const fTakAda = await balasanOrder("#ORDER RS Antah Berantah Qwz\nUJX.1001 1", AM1, null);
  cek("faskes tak ada ditolak", /tidak ditemukan|cocok ke beberapa/.test(fTakAda), fTakAda);
  const ops = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nUJX.1001 1", OPS, null);
  cek("peran non-sales ditolak", /khusus tim sales/.test(ops), ops);
  const banyak = await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\n" + Array.from({ length: 31 }, () => "UJX.1001 1").join("\n"), AM1, null);
  cek("lebih dari 30 baris ditolak", /Maksimal 30/.test(banyak), banyak);
  const n1 = (await sql`SELECT count(*)::int AS n FROM order_wa WHERE am_id LIKE 'UJI90%'`)[0].n;
  cek("tak ada draft tambahan dari pesan yang ditolak", n1 === n0, `${n0} → ${n1}`);

  console.log("3. Konfirmasi & batal");
  const lain = await balasanOrder(`#ORDER ya O${o1}`, AM2, null);
  cek("AM lain tak bisa konfirmasi", /tidak ditemukan atas nama/.test(lain), lain);
  const ya = await balasanOrder(`#ORDER ya O${o1}`, AM1, null);
  cek("konfirmasi → antrean", /masuk antrean/.test(ya) && (await statusOrder(o1)).status === "antrean", ya);
  const ya2 = await balasanOrder(`#ORDER ya O${o1}`, AM1, null);
  cek("konfirmasi dobel ditolak", /sudah dikirim/.test(ya2), ya2);
  const o2 = idDari(await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nUJX.1001 3", AM1, null));
  await sql`UPDATE order_wa SET dibuat_at = now() - interval '25 hours' WHERE id = ${o2}`;
  const basi = await balasanOrder(`#ORDER ya O${o2}`, AM1, null);
  cek("draft lewat 24 jam ditolak", /lewat 24 jam/.test(basi) && (await statusOrder(o2)).status === "draft", basi);
  const bt = await balasanOrder(`#ORDER batal O${o2} salah input`, AM1, null);
  cek("AM membatalkan draft", /dibatalkan/.test(bt) && (await statusOrder(o2)).status === "batal", bt);
  const st = await balasanOrder("#ORDER status", AM1, null);
  cek("#ORDER status menampilkan pesanan", st.includes(`O${o1}`) && st.includes(`O${o2}`), st);

  console.log("4. Cocok otomatis SO Accurate");
  // Dua pesanan lagi di faskes yang sama & item yang sama, plus satu di faskes B.
  const o3 = idDari(await balasanOrder("#ORDER RSUD UJI90 Kota Sembilan\nUJX.1001 1", AM1, null));
  await balasanOrder(`#ORDER ya O${o3}`, AM1, null);
  const o4 = idDari(await balasanOrder("#ORDER Klinik UJI90 Mawar\nUJX.1002 1", AM2, null));
  await balasanOrder(`#ORDER ya O${o4}`, AM2, null);
  const hari = (d: number) => sql`((now() AT TIME ZONE 'Asia/Jakarta')::date + ${d}::int)`;
  // SO-1: faskes A, hari ini, item 1001 → cocok untuk SATU dari o1/o3.
  // SO-2: faskes B, +20 hari → di luar jendela.  SO-3: faskes B, besok, item lain → kode beda.
  await sql`INSERT INTO accurate_sales_order (id, number, trans_date, customer_id, customer_name) VALUES
    (990701, 'SO-UJI90-1', ${hari(0)}, ${CUST_A}, 'RSUD UJI90'),
    (990702, 'SO-UJI90-2', ${hari(20)}, ${CUST_B}, 'KLINIK UJI90'),
    (990703, 'SO-UJI90-3', ${hari(1)}, ${CUST_B}, 'KLINIK UJI90')`;
  await sql`INSERT INTO accurate_sales_order_item (order_id, line_no, item_no) VALUES
    (990701, 1, 'UJX.1001'), (990702, 1, 'UJX.1002'), (990703, 1, 'UJX.9999')`;
  const n = await cocokkanSo();
  const s1 = await statusOrder(o1);
  const s3 = await statusOrder(o3);
  const s4 = await statusOrder(o4);
  const pakaiSo1 = [s1, s3].filter((s) => s.so_number === "SO-UJI90-1").length;
  cek("SO-1 dicocokkan otomatis", pakaiSo1 >= 1 && [s1, s3].some((s) => s.selesai_oleh === "otomatis"), `n=${n}`);
  cek("SATU SO tidak dipakai dua pesanan", pakaiSo1 === 1, `o1=${s1.so_number} o3=${s3.so_number}`);
  cek("SO di luar jendela / kode beda tidak dicocokkan", s4.status === "antrean", `${s4.status} ${s4.so_number}`);

  console.log("5. Transisi admin");
  const sisa = s1.so_number === "SO-UJI90-1" ? o3 : o1;
  cek("pesanan yang kalah tetap di antrean", (await statusOrder(sisa)).status === "antrean");
  const err = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return (e as Error).message; } };
  cek("selesai tanpa no. SO ditolak", /nomor SO/.test((await err(() => ubahStatusOrder(String(o4), { status: "selesai" }, "admin"))) ?? ""));
  cek("batal tanpa alasan ditolak", /alasan/.test((await err(() => ubahStatusOrder(String(o4), { status: "batal" }, "admin"))) ?? ""));
  await ubahStatusOrder(String(o4), { status: "diproses" }, "Admin Uji");
  await ubahStatusOrder(String(o4), { status: "selesai", so_number: "SO-UJI90-3" }, "Admin Uji");
  cek("diproses → selesai manual", (await statusOrder(o4)).status === "selesai");
  cek("batal → apa pun ditolak", /tidak bisa diubah/.test((await err(() => ubahStatusOrder(String(o2), { status: "antrean" }, "admin"))) ?? ""));
  await ubahStatusOrder(String(o4), { status: "diproses" }, "Admin Uji");
  const s4b = await statusOrder(o4);
  cek("buka lagi dari selesai mengosongkan SO", s4b.status === "diproses" && s4b.so_number == null);
  // o4 sekarang 'diproses'; SO-UJI90-1 sudah milik pesanan lain.
  const dobelManual = await err(() => ubahStatusOrder(String(o4), { status: "selesai", so_number: "SO-UJI90-1" }, "Admin Uji"));
  const pakaiSo1b = (await sql`SELECT count(*)::int AS n FROM order_wa WHERE so_number = 'SO-UJI90-1'`)[0].n;
  cek("no. SO yang sudah dipakai pesanan lain ditolak saat input manual", dobelManual != null && pakaiSo1b === 1, dobelManual ?? `dipakai ${pakaiSo1b} pesanan`);

  console.log("6. Scope daftar");
  const scAm: DataScope = { ...FULL_SCOPE, userId: "x", amOnly: true, amId: "UJI90A" };
  const scHod: DataScope = { ...FULL_SCOPE, userId: "y", cabangScope: ["UJI90 BARAT"] };
  const dAm = await daftarOrder(scAm);
  const dHod = await daftarOrder(scHod);
  cek("AM hanya melihat miliknya", dAm.order.length > 0 && dAm.order.every((o) => o.am_id === "UJI90A"));
  cek("HoD hanya cabangnya", dHod.order.length > 0 && dHod.order.every((o) => o.am_id === "UJI90B"));
  const semua = await daftarOrder(FULL_SCOPE);
  cek("draft tak tampil di antrean", !semua.order.some((o) => o.status === "draft"));

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
