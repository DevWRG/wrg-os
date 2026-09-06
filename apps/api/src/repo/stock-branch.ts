import { db } from "../db.js";

// F37 Cross-Branch Stock Visibility (PURCHASING). Fungsi KEDUA di menu
// `/inventory` — fungsi pertama ("cek stok", yang di board disebut F2) sudah
// ada: satu angka agregat per SKU dari `accurate_item.quantity`.
//
// Yang ditambahkan di sini adalah KORELASI-nya, persis seperti dijelaskan
// pemilik fitur: stok total dikorelasikan dengan stok yang ada di cabang. Jadi
// tiap baris membawa tiga angka:
//   total       = accurate_item.quantity     (sumber: Accurate, SELURUH gudang)
//   per gudang  = item_stock_branch.quantity (sumber: opname/import tim gudang)
//   selisih     = total - SUM(per gudang)
//
// ⚠️ CARA BACA `selisih` — jangan diperlakukan sebagai "error" begitu saja.
// WRG punya **gudang virtual di customer** yang sengaja TIDAK ditampilkan
// (arahan Direktur 2026-07-31). Stok di gudang-gudang itu tetap terhitung di
// `accurate_item.quantity`, jadi `total` ≥ Σ(gudang cabang) adalah keadaan
// NORMAL, bukan tanda data rusak. Selisih positif punya dua sebab yang tak bisa
// dipisahkan dari data yang kita punya sekarang:
//   (a) barang memang sedang berada di customer (wajar), ATAU
//   (b) data gudang cabang belum lengkap/basi (perlu ditindak).
// Karena itu UI menampilkannya netral, bukan merah.
//
// Yang BENAR-BENAR mustahil adalah selisih NEGATIF: stok gudang cabang tak
// mungkin melebihi total perusahaan. Itu satu-satunya sinyal integritas yang
// tegas di sini — dihitung terpisah sebagai `item_selisih_negatif` di ringkasan
// dan ditandai merah di tabel.

export interface WarehouseRow {
  kode: string;
  nama: string;
  cabang: string | null;
  urutan: number;
  aktif: boolean;
  catatan: string | null;
}

export async function listWarehouses(opts: { aktifSaja?: boolean } = {}): Promise<WarehouseRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT kode, nama, cabang, urutan, aktif, catatan
    FROM warehouse
    -- Gerbang jenis: gudang virtual di customer TIDAK pernah ikut terbaca
    -- (arahan Direktur). Ini bukan filter opsional — jangan dijadikan parameter.
    WHERE jenis = 'cabang'
      AND (${opts.aktifSaja ?? false} = false OR aktif = true)
    ORDER BY urutan, kode
  `;
  return rows.map((r) => ({
    kode: String(r.kode),
    nama: String(r.nama),
    cabang: r.cabang == null ? null : String(r.cabang),
    urutan: Number(r.urutan),
    aktif: Boolean(r.aktif),
    catatan: r.catatan == null ? null : String(r.catatan),
  }));
}

export interface StockBranchRow {
  item_id: string;
  no: string;
  name: string;
  unit: string | null;
  total: number | null; // accurate_item.quantity — null kalau mirror belum sync
  per_gudang: Record<string, number>; // kode gudang → qty (hanya yang ADA datanya)
  jumlah_cabang: number; // SUM(per_gudang)
  selisih: number | null; // total - jumlah_cabang; null kalau total null
  ada_data_cabang: boolean;
  terakhir_update: string | null;
  sumber: string[]; // 'import' | 'manual' | 'accurate' yang menyusun baris ini
}

export interface StockBranchQuery {
  q?: string; // cari SKU / nama
  warehouse?: string; // hanya item yang punya stok di gudang ini
  // total > Σ cabang. SENGAJA positif-saja, bukan `<>`: kartu ringkasan berlabel
  // "Total > Σ cabang" dan pemakai men-drill dari kartu itu. Dulu filternya `<>`
  // sehingga mengembalikan 3.480 baris untuk kartu yang menampilkan 2.116 —
  // 64% lebih banyak dari angka yang diklik. Untuk yang negatif ada hanyaNegatif.
  hanyaSelisih?: boolean;
  hanyaNegatif?: boolean; // Σ cabang > total — mustahil, sinyal integritas
  tanpaData?: boolean; // hanya item yang BELUM punya data cabang sama sekali
  limit?: number;
  offset?: number;
}

// Matriks item × gudang. LEFT JOIN dari `accurate_item` supaya item yang BELUM
// punya data cabang tetap muncul (itu justru informasi penting: cakupan data
// gudang masih bolong) — bukan INNER JOIN yang menyembunyikannya.
export async function listStockBranch(qy: StockBranchQuery = {}): Promise<{
  rows: StockBranchRow[];
  total_rows: number;
}> {
  const sql = db();
  // Clamp 20.000: katalog Accurate ~5.800 item, jadi ini menutup seluruhnya
  // dengan ruang tumbuh. Clamp 5.000 sebelumnya membuat `?limit=10000` dari
  // halaman diam-diam dipotong — 800 SKU (480 di antaranya PUNYA data stok)
  // hilang permanen karena `ORDER BY no` deterministik, dan pencarian
  // client-side melaporkan "tidak ada" untuk SKU yang sebenarnya ada.
  const limit = Math.min(Math.max(Number(qy.limit) || 200, 1), 20000);
  const offset = Math.max(Number(qy.offset) || 0, 0);
  const q = (qy.q ?? "").trim();
  const wh = (qy.warehouse ?? "").trim();

  const rows = await sql`
    WITH per_item AS (
      SELECT
        ai.id, ai.no, ai.name, ai.unit, ai.quantity,
        COALESCE(
          jsonb_object_agg(sb.warehouse_kode, sb.quantity)
            FILTER (WHERE sb.warehouse_kode IS NOT NULL),
          '{}'::jsonb
        ) AS per_gudang,
        COALESCE(sum(sb.quantity), 0) AS jumlah_cabang,
        count(sb.warehouse_kode) AS n_gudang,
        max(sb.updated_at) AS terakhir_update,
        COALESCE(
          array_agg(DISTINCT sb.source) FILTER (WHERE sb.source IS NOT NULL),
          '{}'::text[]
        ) AS sumber
      FROM accurate_item ai
      -- Gerbang jenis ditaruh di KONDISI JOIN "sb", bukan sebagai LEFT JOIN
      -- terpisah ke "warehouse": dengan LEFT JOIN, baris sb yang gudangnya bukan
      -- 'cabang' tetap lolos (w-nya saja yang NULL) sehingga tak menyaring apa
      -- pun. Bentuk ini membuang stok gudang customer dari per_gudang, Σ cabang,
      -- DAN selisih sekaligus, tapi tetap mempertahankan item yang belum punya
      -- data stok (itu gunanya LEFT).
      LEFT JOIN item_stock_branch sb
        ON sb.item_id = ai.id
       AND sb.warehouse_kode IN (SELECT kode FROM warehouse WHERE jenis = 'cabang')
      WHERE (${q} = '' OR ai.no ILIKE ${"%" + q + "%"} OR ai.name ILIKE ${"%" + q + "%"})
      GROUP BY ai.id, ai.no, ai.name, ai.unit, ai.quantity
    ), difilter AS (
      SELECT * FROM per_item
      WHERE (${wh} = '' OR per_gudang ? ${wh})
        AND (${qy.tanpaData ?? false} = false OR n_gudang = 0)
        -- Selisih hanya bermakna kalau item PUNYA data cabang; item tanpa data
        -- sama sekali bukan "selisih", itu "belum diisi" (filter tanpaData).
        -- "quantity IS NOT NULL" selaras dgn ringkasan: total NULL bukan selisih,
        -- itu "belum sinkron" (lihat catatan di stockBranchSummary). Dan ">" —
        -- bukan "<>" — supaya cocok dengan kartu "Total > Σ cabang".
        AND (${qy.hanyaSelisih ?? false} = false
             OR (n_gudang > 0 AND quantity IS NOT NULL AND quantity > jumlah_cabang))
        AND (${qy.hanyaNegatif ?? false} = false
             OR (n_gudang > 0 AND quantity IS NOT NULL AND quantity < jumlah_cabang))
    )
    SELECT *, count(*) OVER () AS total_rows
    FROM difilter
    ORDER BY no
    LIMIT ${limit} OFFSET ${offset}
  `;

  // `count(*) OVER ()` sendiri benar (window dievaluasi sebelum LIMIT), tapi
  // nilainya cuma bisa dibaca dari baris hasil — dan halaman kosong tak punya
  // baris. Dengan offset melewati akhir data, total_rows jadi 0 dan klien paging
  // tak bisa membedakan "kamu kelewat jauh" dari "memang tak ada data".
  //
  // Diselesaikan dengan memanggil ulang fungsi INI (offset 0, limit 1) alih-alih
  // menulis query count terpisah — supaya filternya mustahil menyimpang dari
  // yang di atas. Hanya jalan pada kasus yang memang bermasalah.
  if (rows.length === 0 && offset > 0) {
    const probe = await listStockBranch({ ...qy, limit: 1, offset: 0 });
    return { rows: [], total_rows: probe.total_rows };
  }

  return {
    total_rows: rows.length ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => {
      const total = r.quantity == null ? null : Number(r.quantity);
      const jumlahCabang = Number(r.jumlah_cabang);
      const per = r.per_gudang as Record<string, string | number>;
      const perGudang: Record<string, number> = {};
      for (const [k, v] of Object.entries(per ?? {})) perGudang[k] = Number(v);
      return {
        item_id: String(r.id),
        no: String(r.no ?? ""),
        name: String(r.name ?? ""),
        unit: r.unit == null ? null : String(r.unit),
        total,
        per_gudang: perGudang,
        jumlah_cabang: jumlahCabang,
        selisih: total == null ? null : total - jumlahCabang,
        ada_data_cabang: Number(r.n_gudang) > 0,
        terakhir_update: r.terakhir_update == null ? null : new Date(r.terakhir_update as string | Date).toISOString(),
        sumber: (r.sumber as string[] | null) ?? [],
      };
    }),
  };
}

export interface StockBranchSummary {
  // Kesehatan data — ditaruh di atas karena inilah yang menentukan apakah angka
  // di bawahnya layak dipakai untuk keputusan relokasi barang.
  item_mirror: number; // jumlah item di mirror Accurate
  item_ada_data: number; // yang sudah punya stok cabang
  item_tanpa_data: number;
  // total > Σ cabang. INFORMASIONAL: bisa barang di gudang virtual customer
  // (wajar) atau data cabang belum lengkap — dua sebab yang tak terpisahkan.
  item_selisih: number;
  // Σ cabang > total. MUSTAHIL secara bisnis → sinyal integritas yang tegas.
  item_selisih_negatif: number;
  cakupan_persen: number; // item_ada_data / item_mirror × 100
  terakhir_update: string | null;
  per_gudang: {
    kode: string;
    nama: string;
    cabang: string | null;
    aktif: boolean;
    item_count: number;
    total_qty: number;
    terakhir_update: string | null;
    // Asal angka gudang ini. Setelah puller F37 hidup, tabel ini berisi DUA
    // sumber sekaligus: gudang yang dipetakan ke Accurate ('accurate') dan
    // lima cabang yang di-skip yang tetap memakai CSV opname ('import').
    // Tanpa kolom ini, dua-duanya tampil sebagai angka yang sama meyakinkan.
    sumber: string[];
  }[];
}

export async function stockBranchSummary(): Promise<StockBranchSummary> {
  const sql = db();
  const [agg] = await sql`
    WITH per_item AS (
      SELECT ai.id, ai.quantity,
             count(sb.warehouse_kode) AS n_gudang,
             COALESCE(sum(sb.quantity), 0) AS jumlah_cabang
      FROM accurate_item ai
      LEFT JOIN item_stock_branch sb
        ON sb.item_id = ai.id
       AND sb.warehouse_kode IN (SELECT kode FROM warehouse WHERE jenis = 'cabang')
      GROUP BY ai.id, ai.quantity
    )
    SELECT
      count(*)::int AS item_mirror,
      count(*) FILTER (WHERE n_gudang > 0)::int AS item_ada_data,
      count(*) FILTER (WHERE n_gudang = 0)::int AS item_tanpa_data,
      -- "quantity IS NOT NULL" wajib, JANGAN COALESCE ke 0: quantity NULL itu
      -- normal untuk item non-stok/jasa (kolomnya nullable, puller mengirim
      -- undefined kalau Accurate tak mengembalikannya). Kalau di-COALESCE jadi 0,
      -- setiap item jasa yang punya stok cabang ikut terhitung "Σ cabang > total"
      -- alias anomali merah — padahal total-nya cuma belum sinkron. Tabel
      -- menampilkannya sebagai "total belum sinkron", jadi ringkasan harus setuju.
      count(*) FILTER (WHERE n_gudang > 0 AND quantity IS NOT NULL AND quantity > jumlah_cabang)::int AS item_selisih,
      count(*) FILTER (WHERE n_gudang > 0 AND quantity IS NOT NULL AND quantity < jumlah_cabang)::int AS item_selisih_negatif
    FROM per_item
  `;
  const [upd] = await sql`SELECT max(updated_at) AS t FROM item_stock_branch`;

  // LEFT JOIN dari `warehouse`: gudang yang belum punya satu pun baris stok
  // tetap tampil dengan 0 — kalau di-INNER JOIN, gudang yang datanya belum
  // diisi hilang dari ringkasan dan kelihatan seolah tak ada masalah.
  const perWh = await sql`
    SELECT w.kode, w.nama, w.cabang, w.aktif,
           count(sb.item_id)::int AS item_count,
           COALESCE(sum(sb.quantity), 0) AS total_qty,
           max(sb.updated_at) AS terakhir_update,
           COALESCE(array_agg(DISTINCT sb.source) FILTER (WHERE sb.source IS NOT NULL), '{}') AS sumber
    FROM warehouse w
    LEFT JOIN item_stock_branch sb ON sb.warehouse_kode = w.kode
    GROUP BY w.kode, w.nama, w.cabang, w.aktif, w.urutan
    ORDER BY w.urutan, w.kode
  `;

  const itemMirror = Number(agg.item_mirror);
  return {
    item_mirror: itemMirror,
    item_ada_data: Number(agg.item_ada_data),
    item_tanpa_data: Number(agg.item_tanpa_data),
    item_selisih: Number(agg.item_selisih),
    item_selisih_negatif: Number(agg.item_selisih_negatif),
    cakupan_persen: itemMirror === 0 ? 0 : Math.round((Number(agg.item_ada_data) / itemMirror) * 1000) / 10,
    terakhir_update: upd?.t == null ? null : new Date(upd.t as string | Date).toISOString(),
    per_gudang: perWh.map((r) => ({
      kode: String(r.kode),
      nama: String(r.nama),
      cabang: r.cabang == null ? null : String(r.cabang),
      aktif: Boolean(r.aktif),
      item_count: Number(r.item_count),
      total_qty: Number(r.total_qty),
      terakhir_update: r.terakhir_update == null ? null : new Date(r.terakhir_update as string | Date).toISOString(),
      sumber: Array.isArray(r.sumber) ? (r.sumber as unknown[]).map(String) : [],
    })),
  };
}
