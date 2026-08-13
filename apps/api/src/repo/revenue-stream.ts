import { db } from "../db.js";

// Revenue-by-stream (WatchPoint kartu Fafa, metric `revstream`): revenue dipecah
// per LINI PRODUK, bukan per sales/cabang seperti sales.ts.
//
// Rantai join: accurate_invoice_item → accurate_item (lewat item_id) →
// product_code.accurate_item_id → product_line. Klasifikasi produk berasal dari
// impor pricebook (product_code/product_line), bukan dari Accurate.
//
// DUA BATAS YANG WAJIB IKUT DITAMPILKAN — keduanya dikembalikan di `ringkasan`
// supaya pemakai laporan tak salah menyimpulkan:
//
//  1. CAKUPAN KLASIFIKASI. Hanya 494 dari 1.042 produk pricebook punya
//     accurate_item_id, jadi per 2026-08-13 baru ~68,5% baris invoice (~73,8%
//     nilai) yang bisa dipetakan ke lini. Sisanya masuk `tanpaKlasifikasi` —
//     JANGAN dibuang diam-diam, karena laporan yang menjumlahkan 74% revenue
//     tapi terlihat lengkap akan dibaca sebagai 100%.
//
//  2. BASIS ANGKA. Jumlah baris item TIDAK sama dengan netto invoice yang
//     dipakai Sales Analytics (`total - tax_amount`): per Agustus 2026,
//     Rp 1,5705 M vs Rp 1,5508 M — selisih ~1,3%, dari diskon/biaya level
//     invoice yang tak punya baris item. Pecahan per lini hanya mungkin dari
//     baris item, jadi selisihnya dilaporkan (`selisihThdNettoInvoice`) alih-alih
//     disamarkan.
//
// GP per lini sengaja TIDAK dihitung di sini. HPP-nya belum bersih: audit
// 2026-08-13 menemukan 35 produk dengan HPP > harga jual (distorsi −Rp 7,54 M),
// dan 760 produk ber-HPP belum pernah terjual sehingga tak terverifikasi.
// Lihat ~/DevWRG/ops/hpp-anomali-20260813/.

export interface StreamRow {
  lineId: string;
  lini: string;
  kategori: string;
  revenue: number;
  share: number;
  baris: number;
  customers: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** `?periode=YYYY-MM` menang atas from/to. Default = bulan berjalan. */
export function streamRange(periode?: string, from?: string, to?: string): { from: string; to: string } {
  if (periode && MONTH.test(periode)) {
    const [y, m] = periode.split("-").map(Number);
    const akhir = new Date(Date.UTC(y, m, 0)); // hari 0 bulan berikutnya = akhir bulan ini
    return { from: `${periode}-01`, to: akhir.toISOString().slice(0, 10) };
  }
  const now = new Date();
  const bulanIni = now.toISOString().slice(0, 7);
  let f = from && ISO.test(from) ? from : `${bulanIni}-01`;
  let t = to && ISO.test(to) ? to : now.toISOString().slice(0, 10);
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

export async function reportRevenueByStream(from: string, to: string) {
  const sql = db();

  const rows = await sql<
    { line_id: string | null; lini: string | null; kategori: string | null; revenue: number; baris: number; customers: number }[]
  >`
    SELECT pc.line_id, pl.nama AS lini, pk.nama AS kategori,
           COALESCE(sum(ii.total), 0)::float8 AS revenue,
           count(*)::int AS baris,
           count(DISTINCT inv.customer_id)::int AS customers
      FROM accurate_invoice_item ii
      JOIN accurate_invoice inv ON inv.id = ii.invoice_id
      LEFT JOIN product_code pc ON pc.accurate_item_id::text = ii.item_id::text
      LEFT JOIN product_line pl ON pl.kategori_id = pc.kategori_id AND pl.id = pc.line_id
      LEFT JOIN product_kategori pk ON pk.id = pc.kategori_id
     WHERE inv.tanggal >= ${from}::date AND inv.tanggal <= ${to}::date
     GROUP BY pc.line_id, pl.nama, pk.nama`;

  const [tot] = await sql<{ netto: number; bruto: number }[]>`
    SELECT COALESCE(sum(total - COALESCE(tax_amount, 0)), 0)::float8 AS netto,
           COALESCE(sum(total), 0)::float8 AS bruto
      FROM accurate_invoice
     WHERE tanggal >= ${from}::date AND tanggal <= ${to}::date`;

  const semua = rows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const terklasifikasi = rows.filter((r) => r.lini).reduce((a, r) => a + Number(r.revenue || 0), 0);
  const tanpa = rows.find((r) => !r.lini);

  const streams: StreamRow[] = rows
    .filter((r) => r.lini)
    .map((r) => ({
      lineId: String(r.line_id ?? ""),
      lini: String(r.lini),
      kategori: String(r.kategori ?? "—"),
      revenue: Number(r.revenue || 0),
      share: terklasifikasi > 0 ? (Number(r.revenue || 0) / terklasifikasi) * 100 : 0,
      baris: Number(r.baris || 0),
      customers: Number(r.customers || 0),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const nettoInvoice = Number(tot?.netto ?? 0);
  return {
    from,
    to,
    streams,
    ringkasan: {
      revenueTerklasifikasi: terklasifikasi,
      revenueSemuaBarisItem: semua,
      cakupanNilaiPct: semua > 0 ? (terklasifikasi / semua) * 100 : null,
      tanpaKlasifikasi: { revenue: Number(tanpa?.revenue ?? 0), baris: Number(tanpa?.baris ?? 0) },
      nettoInvoice,
      selisihThdNettoInvoice: semua - nettoInvoice,
    },
  };
}
