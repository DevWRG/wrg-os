// Sales Analytics — ekspor DETAIL FAKTUR per baris barang (XLSX).
//
// Tab-tab Sales Analytics mengekspor rekap; berkas ini satu baris per baris item
// faktur, kolomnya mengikuti laporan penjualan yang biasa ditarik dari Accurate
// (Tahun … Pengadaan). Filter periode + row-level scope sama dengan tab lain.
//
// Nilai uang SENGAJA dialokasikan, bukan diambil mentah dari baris:
//   - "Total Stlh Disc." = netto faktur (total − PPN) dibagi ke baris sesuai porsi
//     totalPrice — pola yang sama dengan Per-Produk/Per-Pengadaan, jadi Σ kolom ini
//     = Total Revenue di dashboard (diskon header ikut terserap).
//   - "PPN" = PPN faktur dibagi ke baris kena pajak sesuai porsi yang sama → Σ PPN
//     baris = PPN faktur.
//   - "Diskon %" = 1 − (Total Stlh Disc. / (Kuantitas × @Harga)).
// Faktur tanpa diskon header menghasilkan angka yang identik dengan baris aslinya.
//
// Nomor SJ: semua DO yang ditautkan baris-baris faktur (raw.deliveryOrderId →
// accurate_delivery_order), digabung koma, diulang di tiap baris faktur itu.
// Cermin DO hanya ±120 hari ke belakang; DO di luar itu memakai
// raw.deliveryOrder.number bila ada, selebihnya kosong.

import ExcelJS from "exceljs";
import { db } from "../db.js";
import { salesRange } from "./sales.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { scopeAccurateClause, type DataScope } from "./access-scope.js";

const BULAN = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

/** Satu baris item faktur apa adanya dari DB (sebelum alokasi). */
export interface BarisMentah {
  invoice_id: string;
  line_no: number;
  tanggal: string; // YYYY-MM-DD
  nomor: string | null;
  inv_net: number; // total − PPN faktur
  inv_tax: number; // PPN faktur
  kode_customer: string | null;
  customer: string | null;
  kota: string | null;
  provinsi: string | null;
  cabang: string | null;
  sales: string | null;
  kode_barang: string | null;
  nama_barang: string | null;
  qty: number;
  satuan: string | null;
  harga: number;
  total_baris: number; // totalPrice Accurate (sesudah diskon baris)
  use_tax: boolean | null; // raw.useTax1; null = field tak ada
  pengadaan: string | null;
  nomor_sj: string | null;
  tgl_kirim: string[]; // YYYY-MM-DD, unik, urut
}

/** Baris siap tulis ke XLSX. */
export interface BarisDetail {
  tahun: number;
  bulan: string;
  tanggal: string;
  nomor: string | null;
  nomor_sj: string | null;
  tgl_kirim: string[];
  kode_customer: string | null;
  customer: string | null;
  kota: string | null;
  provinsi: string | null;
  cabang: string | null;
  sales: string | null;
  kode_barang: string | null;
  nama_barang: string | null;
  qty: number;
  satuan: string | null;
  harga: number;
  total_harga: number;
  diskon_pct: number | null; // pecahan 0..1
  netto: number;
  ppn: number;
  total_ppn: number;
  kena_ppn: "YA" | "TIDAK";
  pengadaan: string | null;
}

const bulat2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Alokasi netto & PPN faktur ke baris-barisnya. Murni (tanpa DB) supaya bisa diuji.
 * Urutan keluaran = urutan masukan.
 */
export function susunBarisDetail(mentah: BarisMentah[]): BarisDetail[] {
  const perFaktur = new Map<string, BarisMentah[]>();
  for (const b of mentah) {
    const g = perFaktur.get(b.invoice_id);
    if (g) g.push(b); else perFaktur.set(b.invoice_id, [b]);
  }

  const alokasi = new Map<BarisMentah, { netto: number; ppn: number; kena: boolean }>();
  for (const g of perFaktur.values()) {
    const { inv_net, inv_tax } = g[0]!;
    const w = (b: BarisMentah) => Math.max(b.total_baris, 0);
    const wsum = g.reduce((s, b) => s + w(b), 0);
    // Kena PPN: flag baris bila ada; tanpa flag → ikut faktur (ber-PPN atau tidak).
    const kena = (b: BarisMentah) => (b.use_tax ?? inv_tax > 0);
    let pajak = g.filter(kena);
    // Faktur ber-PPN tapi semua baris ditandai tak kena → bagi ke semua baris
    // supaya Σ PPN baris tetap = PPN faktur.
    if (inv_tax !== 0 && pajak.length === 0) pajak = g;
    const wpajak = pajak.reduce((s, b) => s + w(b), 0);
    for (const b of g) {
      const netto = wsum > 0 ? (inv_net * w(b)) / wsum : inv_net / g.length;
      const ikut = pajak.includes(b);
      const ppn = !ikut || inv_tax === 0 ? 0 : wpajak > 0 ? (inv_tax * w(b)) / wpajak : inv_tax / pajak.length;
      alokasi.set(b, { netto, ppn, kena: ikut });
    }
  }

  return mentah.map((b) => {
    const a = alokasi.get(b)!;
    const [y, m] = b.tanggal.split("-").map(Number);
    const totalHarga = b.qty * b.harga;
    return {
      tahun: y!,
      bulan: `${String(m).padStart(2, "0")}. ${BULAN[m! - 1]}`,
      tanggal: b.tanggal,
      nomor: b.nomor,
      nomor_sj: b.nomor_sj,
      tgl_kirim: b.tgl_kirim,
      kode_customer: b.kode_customer,
      customer: b.customer,
      kota: b.kota,
      provinsi: b.provinsi,
      cabang: b.cabang,
      sales: b.sales,
      kode_barang: b.kode_barang,
      nama_barang: b.nama_barang,
      qty: b.qty,
      satuan: b.satuan,
      harga: b.harga,
      total_harga: bulat2(totalHarga),
      diskon_pct: totalHarga > 0 ? Math.round((1 - a.netto / totalHarga) * 10000) / 10000 : null,
      netto: bulat2(a.netto),
      ppn: bulat2(a.ppn),
      total_ppn: bulat2(a.netto + a.ppn),
      kena_ppn: a.kena ? "YA" : "TIDAK",
      pengadaan: b.pengadaan,
    };
  });
}

/** Baca baris item faktur dalam rentang + scope. */
async function bacaBaris(from: string, to: string, scope: DataScope): Promise<BarisMentah[]> {
  const sql = db();
  const rows = await sql`
    WITH inv AS (
      SELECT ai.id, ai.number, ai.tanggal, ai.customer_id,
             (ai.total - COALESCE(ai.tax_amount,0))::float8 AS inv_net,
             COALESCE(ai.tax_amount,0)::float8 AS inv_tax,
             ${cabangEffSql(sql)} AS cabang,
             COALESCE(NULLIF(acs.name,''), NULLIF(ai.salesman_name,''),
                      (SELECT e.inisial FROM employee e WHERE e.am_id = mu.am_id AND e.inisial IS NOT NULL LIMIT 1)) AS sales
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeAccurateClause(sql, scope)}
    ),
    line AS (
      SELECT aii.invoice_id, aii.line_no, aii.item_id, aii.qty, aii.unit, aii.unit_price, aii.total,
             aii.kategori_pengadaan,
             aii.raw->'item'->>'no' AS raw_no,
             COALESCE(NULLIF(aii.raw->'item'->>'name',''), NULLIF(aii.raw->>'detailName','')) AS raw_name,
             CASE WHEN aii.raw->>'useTax1' IN ('true','false') THEN (aii.raw->>'useTax1')::boolean END AS use_tax,
             CASE WHEN aii.raw->>'deliveryOrderId' ~ '^[0-9]+$' THEN (aii.raw->>'deliveryOrderId')::bigint END AS do_id,
             NULLIF(aii.raw->'deliveryOrder'->>'number','') AS raw_do_no
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    ),
    sj AS (
      SELECT l.invoice_id,
             string_agg(DISTINCT COALESCE(d.number, l.raw_do_no), ', ') AS nomor_sj,
             array_agg(DISTINCT d.trans_date::text) FILTER (WHERE d.trans_date IS NOT NULL) AS tgl_kirim
      FROM line l LEFT JOIN accurate_delivery_order d ON d.id = l.do_id
      WHERE COALESCE(d.number, l.raw_do_no) IS NOT NULL
      GROUP BY l.invoice_id
    )
    SELECT inv.id::text AS invoice_id, l.line_no, inv.tanggal::text AS tanggal, inv.number AS nomor,
           inv.inv_net, inv.inv_tax,
           NULLIF(ac.no,'') AS kode_customer,
           ac.name AS customer,
           k.kota, upper(w.provinsi) AS provinsi,
           inv.cabang, inv.sales,
           COALESCE(NULLIF(it.no,''), NULLIF(l.raw_no,'')) AS kode_barang,
           COALESCE(NULLIF(it.name,''), l.raw_name) AS nama_barang,
           COALESCE(l.qty,0)::float8 AS qty, l.unit AS satuan,
           COALESCE(l.unit_price,0)::float8 AS harga, COALESCE(l.total,0)::float8 AS total_baris,
           l.use_tax, NULLIF(l.kategori_pengadaan,'') AS pengadaan,
           sj.nomor_sj, COALESCE(sj.tgl_kirim, '{}') AS tgl_kirim
    FROM line l
    JOIN inv ON inv.id = l.invoice_id
    LEFT JOIN accurate_customer ac ON ac.id = inv.customer_id
    LEFT JOIN accurate_item it ON it.id = l.item_id
    LEFT JOIN sj ON sj.invoice_id = l.invoice_id
    -- Kota = akhiran nama customer Accurate ("…, RS KAB. KEDIRI"), pola sama dgn area_customer().
    LEFT JOIN LATERAL (
      SELECT upper(btrim(substring(ac.name from '((?:KAB\\.|KOTA ADM\\.|KOTA) [A-Za-z .\\-]+)$'))) AS kota
    ) k ON true
    -- Provinsi dari wilayah_kab_kota (migrasi 260): "KAB. X" = "Kabupaten X", "KOTA ADM. X" = "Kota Administrasi X".
    LEFT JOIN LATERAL (
      SELECT wk.provinsi FROM wilayah_kab_kota wk
      WHERE upper(btrim(wk.nama)) = regexp_replace(regexp_replace(k.kota, '^KAB\\. ', 'KABUPATEN '), '^KOTA ADM\\. ', 'KOTA ADMINISTRASI ')
      LIMIT 1
    ) w ON true
    ORDER BY inv.tanggal, inv.number, inv.id, l.line_no`;
  return rows.map((r) => ({
    invoice_id: String(r.invoice_id),
    line_no: Number(r.line_no),
    tanggal: String(r.tanggal),
    nomor: r.nomor ?? null,
    inv_net: Number(r.inv_net),
    inv_tax: Number(r.inv_tax),
    kode_customer: r.kode_customer ?? null,
    customer: r.customer ?? null,
    kota: r.kota ?? null,
    provinsi: r.provinsi ?? null,
    cabang: r.cabang ?? null,
    sales: r.sales ?? null,
    kode_barang: r.kode_barang ?? null,
    nama_barang: r.nama_barang ?? null,
    qty: Number(r.qty),
    satuan: r.satuan ?? null,
    harga: Number(r.harga),
    total_baris: Number(r.total_baris),
    use_tax: r.use_tax == null ? null : Boolean(r.use_tax),
    pengadaan: r.pengadaan ?? null,
    nomor_sj: r.nomor_sj ?? null,
    tgl_kirim: ((r.tgl_kirim ?? []) as string[]).slice().sort(),
  }));
}

const FMT_RP = "#,##0.00";
const FMT_TGL = "d mmm yyyy";
const tglExcel = (iso: string) => new Date(`${iso}T00:00:00Z`);
const tglTeks = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][m! - 1]} ${y}`;
};

export async function detailFakturXlsx(from0?: string, to0?: string, scope?: DataScope): Promise<{ buf: Buffer; nama: string; baris: number }> {
  const { from, to } = salesRange(from0, to0);
  const sc = scope ?? { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };
  const rows = susunBarisDetail(await bacaBaris(from, to, sc));

  const wb = new ExcelJS.Workbook();
  wb.creator = "WRG-OS";
  const ws = wb.addWorksheet("Detail Faktur");
  const kolom: Array<{ h: string; w: number; fmt?: string }> = [
    { h: "Tahun", w: 7 }, { h: "Bulan", w: 14 }, { h: "Tanggal Faktur", w: 13, fmt: FMT_TGL },
    { h: "Nomor Faktur", w: 22 }, { h: "Nomor SJ", w: 22 }, { h: "Tanggal Pengiriman Pesanan", w: 14, fmt: FMT_TGL },
    { h: "Kode Customer", w: 15 }, { h: "Customer", w: 40 }, { h: "Kota", w: 20 }, { h: "Provinsi", w: 16 },
    { h: "Cabang/Outlet", w: 14 }, { h: "Sales", w: 9 }, { h: "Kode #", w: 12 }, { h: "Nama Barang", w: 50 },
    { h: "Kuantitas", w: 10, fmt: "#,##0.##" }, { h: "Satuan", w: 9 }, { h: "@Harga", w: 15, fmt: FMT_RP },
    { h: "Total Harga", w: 16, fmt: FMT_RP }, { h: "Diskon %", w: 9, fmt: "0.0%" },
    { h: "Total Stlh Disc.", w: 16, fmt: FMT_RP }, { h: "PPN", w: 14, fmt: FMT_RP },
    { h: "Total Stlh PPN", w: 16, fmt: FMT_RP }, { h: "Kena PPN", w: 9 }, { h: "Pengadaan", w: 11 },
  ];
  ws.columns = kolom.map((k) => ({ header: k.h, width: k.w, style: k.fmt ? { numFmt: k.fmt } : undefined }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };

  for (const r of rows) {
    // Satu tanggal kirim → sel tanggal; lebih dari satu (faktur gabungan beberapa SJ) → teks berkoma.
    const kirim = r.tgl_kirim.length === 1 ? tglExcel(r.tgl_kirim[0]!) : r.tgl_kirim.length > 1 ? r.tgl_kirim.map(tglTeks).join(", ") : null;
    ws.addRow([
      r.tahun, r.bulan, tglExcel(r.tanggal), r.nomor, r.nomor_sj, kirim,
      r.kode_customer, r.customer, r.kota, r.provinsi, r.cabang, r.sales, r.kode_barang, r.nama_barang,
      r.qty, r.satuan, r.harga, r.total_harga, r.diskon_pct, r.netto, r.ppn, r.total_ppn, r.kena_ppn, r.pengadaan,
    ]);
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { buf, nama: `sales-analytics_detail-faktur_${from}_${to}.xlsx`, baris: rows.length };
}
