// F142 Price Book — katalog harga jual produk KEAGENAN WRG (tabel product_pricelist,
// migrasi 071). Tiga muka: katalog SKU, ringkasan analitik, dan daftar item Accurate
// yang berada DI LUAR keagenan.
//
// Semua angka ringkasan dihitung dari isi tabel — tidak ada angka yang ditempel.
// Re-import price book periode baru → ringkasan ikut berubah sendiri.
//
// Yang TIDAK ada di sini, dan sengaja: HPP, margin, persentase markup, harga &
// diskon sub-dealer. Keempatnya memang tidak pernah masuk file handover Direktur
// (HANDOVER §1 & §9) — kalau nanti file HPP/sub-dealer datang, itu tabel terpisah.

import { db, isDbEnabled } from "../db.js";

export const PERIODE_DEFAULT = "H2-2026";

export interface PricebookItem {
  id: number;
  kode: string | null;
  lini: string;
  brand: string;
  nama: string;
  varian: string | null;
  kemasan: string | null;
  kategori: string | null;
  kategoriVerified: boolean;
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  nettPpn: number;
  rentangHarga: string | null;
  catatan: string | null;
  // Berapa SKU lain di brand yang sama memakai nama produk PERSIS ini. >1 =
  // sales wajib konfirmasi varian ke admin sebelum keluarkan penawaran
  // (HANDOVER §6 — risiko mis-quote terbesar di dokumen ini).
  jumlahHarga: number;
}

export interface PricebookFilter {
  periode?: string;
  lini?: string;
  brand?: string;
  kategori?: string;
  q?: string;
  limit?: number;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export async function listItems(f: PricebookFilter = {}): Promise<PricebookItem[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const periode = f.periode || PERIODE_DEFAULT;
  const limit = Math.min(Math.max(f.limit ?? 5000, 1), 20000);
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;

  const rows = await sql<Record<string, unknown>[]>`
    SELECT p.id, p.kode, p.lini, p.brand, p.nama, p.varian, p.kemasan, p.kategori,
           p.kategori_verified, p.price_list, p.diskon_maks, p.harga_nett, p.nett_ppn,
           p.rentang_harga, p.catatan,
           COUNT(*) OVER (PARTITION BY p.brand, p.nama) AS jumlah_harga
      FROM product_pricelist p
     WHERE p.periode = ${periode}
       AND (${f.lini ?? null}::text IS NULL OR p.lini = ${f.lini ?? null})
       AND (${f.brand ?? null}::text IS NULL OR p.brand = ${f.brand ?? null})
       AND (${f.kategori ?? null}::text IS NULL OR p.kategori = ${f.kategori ?? null})
       AND (${q}::text IS NULL OR p.nama ILIKE ${q} OR p.brand ILIKE ${q} OR p.kode ILIKE ${q})
     ORDER BY p.lini, p.brand, p.nama, p.price_list DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    kode: (r.kode as string) ?? null,
    lini: r.lini as string,
    brand: r.brand as string,
    nama: r.nama as string,
    varian: (r.varian as string) ?? null,
    kemasan: (r.kemasan as string) ?? null,
    kategori: (r.kategori as string) ?? null,
    kategoriVerified: r.kategori_verified === true,
    priceList: num(r.price_list),
    diskonMaks: num(r.diskon_maks),
    hargaNett: num(r.harga_nett),
    nettPpn: num(r.nett_ppn),
    rentangHarga: (r.rentang_harga as string) ?? null,
    catatan: (r.catatan as string) ?? null,
    jumlahHarga: num(r.jumlah_harga),
  }));
}

// ── Ringkasan (infografis) ─────────────────────────────────────────────────

export interface NamaValue { nama: string; sku: number; nilai: number; pct: number }
export interface PricebookSummary {
  periode: string;
  kosong: boolean;
  kpi: {
    sku: number;
    skuPerLini: { lini: string; sku: number }[];
    nilaiKatalog: number;       // Σ harga nett (lantai) 1 unit per SKU
    nilaiPriceList: number;     // Σ price list 1 unit per SKU
    brand: number;
    brandPerLini: { lini: string; brand: number }[];
    konsentrasiTop: { lini: string; brand: string; pct: number } | null;
  };
  // Dua mesin: pangsa SKU vs pangsa nilai per lini (biasanya terbalik).
  lini: { lini: string; sku: number; skuPct: number; nilai: number; nilaiPct: number }[];
  kategoriPerLini: { lini: string; rows: NamaValue[] }[];
  brandPerLini: { lini: string; rows: NamaValue[]; top10Pct: number }[];
  diskon: { tier: number; sku: number }[];
  rentang: { band: string; sku: number }[];
  risiko: {
    namaDuplikat: { kelompok: number; baris: number; contoh: { brand: string; nama: string; baris: number }[] };
    tanpaKode: number;
    kategoriBelumVerified: number;
    kategoriLainLain: number;
    // Ketergantungan satu principal per lini — angka risiko utama di portofolio.
    konsentrasi: { lini: string; brand: string; pct: number; nilai: number }[];
  };
  // Cakupan katalog keagenan terhadap mirror Accurate (lihat outsideKeagenan).
  cakupan: { accurateTotal: number; cocok: number; diLuarKeagenan: number; tanpaKode: number } | null;
}

export async function summary(periode = PERIODE_DEFAULT): Promise<PricebookSummary> {
  const kosongResult: PricebookSummary = {
    periode,
    kosong: true,
    kpi: { sku: 0, skuPerLini: [], nilaiKatalog: 0, nilaiPriceList: 0, brand: 0, brandPerLini: [], konsentrasiTop: null },
    lini: [], kategoriPerLini: [], brandPerLini: [], diskon: [], rentang: [],
    risiko: { namaDuplikat: { kelompok: 0, baris: 0, contoh: [] }, tanpaKode: 0, kategoriBelumVerified: 0, kategoriLainLain: 0, konsentrasi: [] },
    cakupan: null,
  };
  if (!isDbEnabled()) return kosongResult;
  const sql = db();

  const [tot] = await sql<Record<string, unknown>[]>`
    SELECT COUNT(*) AS sku, COALESCE(SUM(harga_nett),0) AS nett,
           COALESCE(SUM(price_list),0) AS pl, COUNT(DISTINCT brand) AS brand
      FROM product_pricelist WHERE periode = ${periode}
  `;
  const skuTotal = num(tot?.sku);
  if (skuTotal === 0) return kosongResult;
  const nilaiTotal = num(tot?.nett);

  const perLini = await sql<Record<string, unknown>[]>`
    SELECT lini, COUNT(*) AS sku, COUNT(DISTINCT brand) AS brand,
           COALESCE(SUM(harga_nett),0) AS nilai
      FROM product_pricelist WHERE periode = ${periode}
     GROUP BY lini ORDER BY SUM(harga_nett) DESC
  `;

  // Kategori & brand per lini — dipisah per lini karena taksonominya memang beda
  // (IVD pakai Product Line 27 kategori, Medical pakai Class 11 kategori).
  const kategori = await sql<Record<string, unknown>[]>`
    SELECT lini, COALESCE(NULLIF(kategori,''),'(tanpa kategori)') AS nama,
           COUNT(*) AS sku, COALESCE(SUM(harga_nett),0) AS nilai
      FROM product_pricelist WHERE periode = ${periode}
     GROUP BY 1,2 ORDER BY lini, SUM(harga_nett) DESC
  `;
  const brandAgg = await sql<Record<string, unknown>[]>`
    SELECT lini, brand AS nama, COUNT(*) AS sku, COALESCE(SUM(harga_nett),0) AS nilai
      FROM product_pricelist WHERE periode = ${periode}
     GROUP BY 1,2 ORDER BY lini, SUM(harga_nett) DESC
  `;
  const diskon = await sql<Record<string, unknown>[]>`
    SELECT diskon_maks AS tier, COUNT(*) AS sku FROM product_pricelist
     WHERE periode = ${periode} GROUP BY 1 ORDER BY 1
  `;
  const rentang = await sql<Record<string, unknown>[]>`
    SELECT COALESCE(NULLIF(rentang_harga,''),'(tanpa band)') AS band, COUNT(*) AS sku
      FROM product_pricelist WHERE periode = ${periode} GROUP BY 1 ORDER BY 1
  `;
  const [risk] = await sql<Record<string, unknown>[]>`
    SELECT COUNT(*) FILTER (WHERE kode IS NULL OR kode = '') AS tanpa_kode,
           COUNT(*) FILTER (WHERE NOT kategori_verified)     AS belum_verified,
           COUNT(*) FILTER (WHERE kategori = 'Lain-lain')    AS lain_lain
      FROM product_pricelist WHERE periode = ${periode}
  `;
  const dupRows = await sql<Record<string, unknown>[]>`
    SELECT brand, nama, COUNT(*) AS baris
      FROM product_pricelist WHERE periode = ${periode}
     GROUP BY brand, nama HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC, brand, nama
  `;

  const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  const toRows = (src: Record<string, unknown>[], lini: string, total: number): NamaValue[] =>
    src.filter((r) => r.lini === lini).map((r) => ({
      nama: r.nama as string, sku: num(r.sku), nilai: num(r.nilai), pct: pct(num(r.nilai), total),
    }));

  const liniRows = perLini.map((r) => ({
    lini: r.lini as string,
    sku: num(r.sku),
    skuPct: pct(num(r.sku), skuTotal),
    nilai: num(r.nilai),
    nilaiPct: pct(num(r.nilai), nilaiTotal),
  }));

  const konsentrasi = liniRows
    .map((l) => {
      const top = toRows(brandAgg, l.lini, l.nilai)[0];
      return top ? { lini: l.lini, brand: top.nama, pct: top.pct, nilai: top.nilai } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.pct - a.pct);

  return {
    periode,
    kosong: false,
    kpi: {
      sku: skuTotal,
      skuPerLini: liniRows.map((l) => ({ lini: l.lini, sku: l.sku })),
      nilaiKatalog: nilaiTotal,
      nilaiPriceList: num(tot?.pl),
      brand: num(tot?.brand),
      brandPerLini: perLini.map((r) => ({ lini: r.lini as string, brand: num(r.brand) })),
      konsentrasiTop: konsentrasi[0] ? { lini: konsentrasi[0].lini, brand: konsentrasi[0].brand, pct: konsentrasi[0].pct } : null,
    },
    lini: liniRows,
    kategoriPerLini: liniRows.map((l) => ({ lini: l.lini, rows: toRows(kategori, l.lini, l.nilai) })),
    brandPerLini: liniRows.map((l) => {
      const rows = toRows(brandAgg, l.lini, l.nilai);
      return { lini: l.lini, rows, top10Pct: Math.round(rows.slice(0, 10).reduce((a, b) => a + b.pct, 0) * 10) / 10 };
    }),
    diskon: diskon.map((r) => ({ tier: num(r.tier), sku: num(r.sku) })),
    rentang: rentang.map((r) => ({ band: r.band as string, sku: num(r.sku) })),
    risiko: {
      namaDuplikat: {
        kelompok: dupRows.length,
        baris: dupRows.reduce((a, r) => a + num(r.baris), 0),
        contoh: dupRows.slice(0, 8).map((r) => ({ brand: r.brand as string, nama: r.nama as string, baris: num(r.baris) })),
      },
      tanpaKode: num(risk?.tanpa_kode),
      kategoriBelumVerified: num(risk?.belum_verified),
      kategoriLainLain: num(risk?.lain_lain),
      konsentrasi,
    },
    cakupan: await cakupan(periode),
  };
}

async function cakupan(periode: string): Promise<PricebookSummary["cakupan"]> {
  const sql = db();
  const [r] = await sql<Record<string, unknown>[]>`
    SELECT (SELECT COUNT(*) FROM accurate_item) AS accurate_total,
           (SELECT COUNT(DISTINCT ai.id) FROM accurate_item ai
              JOIN product_pricelist p ON p.kode = ai.no AND p.periode = ${periode}) AS cocok,
           (SELECT COUNT(*) FROM product_pricelist
             WHERE periode = ${periode} AND (kode IS NULL OR kode = '')) AS tanpa_kode
  `;
  const total = num(r?.accurate_total);
  const cocok = num(r?.cocok);
  return { accurateTotal: total, cocok, diLuarKeagenan: Math.max(total - cocok, 0), tanpaKode: num(r?.tanpa_kode) };
}

// ── Di luar keagenan ───────────────────────────────────────────────────────

export interface OutsideItem {
  id: number;
  no: string | null;
  name: string | null;
  category: string | null;
  unit: string | null;
  unitPrice: number | null;
  quantity: number | null;
  available: number | null;
}

// Item mirror Accurate yang TIDAK punya pasangan di price book keagenan periode
// ini. Pencocokan lewat kode (accurate_item.no = product_pricelist.kode) — satu-
// satunya identitas yang dijamin sama; nama produk tidak bisa dipakai karena di
// price book pun 22 nama dipakai berulang.
//
// Catatan yang harus ikut tampil di UI: 141 SKU keagenan sendiri tidak punya kode
// Accurate (HANDOVER §8 poin 2), jadi ada kemungkinan sebagian item "di luar
// keagenan" sebetulnya SKU keagenan yang kodenya belum terisi. Bukan tebakan yang
// boleh diselesaikan diam-diam di query — itu pekerjaan pembersihan master.
export async function outsideKeagenan(
  opts: { periode?: string; q?: string; limit?: number } = {},
): Promise<OutsideItem[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const periode = opts.periode || PERIODE_DEFAULT;
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;

  const rows = await sql<Record<string, unknown>[]>`
    SELECT ai.id, ai.no, ai.name, ai.category, ai.unit, ai.unit_price, ai.quantity, ai.available
      FROM accurate_item ai
     WHERE NOT EXISTS (
             SELECT 1 FROM product_pricelist p
              WHERE p.periode = ${periode} AND p.kode IS NOT NULL AND p.kode = ai.no)
       AND (${q}::text IS NULL OR ai.name ILIKE ${q} OR ai.no ILIKE ${q})
     ORDER BY ai.name NULLS LAST
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    no: (r.no as string) ?? null,
    name: (r.name as string) ?? null,
    category: (r.category as string) ?? null,
    unit: (r.unit as string) ?? null,
    unitPrice: r.unit_price === null ? null : num(r.unit_price),
    quantity: r.quantity === null ? null : num(r.quantity),
    available: r.available === null ? null : num(r.available),
  }));
}

export async function periodeList(): Promise<string[]> {
  if (!isDbEnabled()) return [PERIODE_DEFAULT];
  const sql = db();
  const rows = await sql<{ periode: string }[]>`
    SELECT DISTINCT periode FROM product_pricelist ORDER BY periode DESC
  `;
  return rows.length ? rows.map((r) => r.periode) : [PERIODE_DEFAULT];
}

// ── Pricelist Setup (lapisan kroscek, migrasi 073) ──────────────────────────
// INTERNAL — berisi HPP & margin. Endpoint yang memakai ini WAJIB di-gate ke
// HoD Business / Purchasing / admin di BFF; jangan pernah dipakai halaman AM.
// Isi tabel dari scripts/db/import_kroscek_pricelist.py (data tidak di repo).
//
// Margin DIHITUNG di sini (1 - hpp/price_list), tidak disimpan: harga price book
// itu final dari Direktur, jadi margin cuma turunan. Kalau margin disimpan
// numeric(6,4), hpp/(1-margin) tidak lagi mengembalikan harga aslinya.

export interface PricebookSetupRow {
  rowNo: number;
  kode: string | null; // kode di snapshot price book
  lini: string;
  brand: string;
  nama: string; // nama di handover Direktur
  namaFinal: string | null; // hasil kroscek; beda dari `nama` di 326 baris
  varian: string | null;
  kemasan: string | null;
  satuan: string | null;
  // Harga EFEKTIF (override HoD kalau ada, kalau tidak angka handover).
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  nettPpn: number;
  // Angka handover Direktur apa adanya — supaya override selalu bisa dibandingkan
  // dengan aslinya, dan kelihatan mana yang sudah disetel manusia.
  priceListAsli: number;
  diskonMaksAsli: number;
  adaOverride: boolean;
  hpp: number | null; // null = belum ada HPP di sumber Compilation
  marginPct: number | null; // fraksi; null kalau hpp null (dihitung dari harga efektif)
  status: string; // draft | published
  publishedAt: string | null;
  kategori: string | null;
  productLine: string | null;
  klas: string | null;
  subClass: string | null;
  productKode: string | null; // KK.PP.CC.SSS.NNNN di product_code
  klasifikasiLengkap: boolean; // 4 level ter-resolve
}

export interface PricebookSetupSummary {
  periode: string;
  total: number;
  adaHpp: number;
  tanpaHpp: number;
  klasifikasiLengkap: number;
  kepasangKode: number;
  draft: number;
  published: number;
  adaOverride: number; // baris yang harganya sudah disetel HoD (beda dari handover)
  reviewTerbuka: number; // antrean product_code_review dari sumber kroscek
  totalHpp: number;
  totalPriceList: number; // Σ price list, HANYA baris ber-HPP (biar sebanding)
  marginAgregat: number | null; // 1 - Σhpp/Σprice_list atas baris ber-HPP saja
}

// Label sumber di product_code_review — harus sama dengan konstanta SUMBER di
// scripts/db/import_kroscek_pricelist.py.
const SUMBER_KROSCEK = "Master Kroscek PL H2-2026";

export const PPN_PRICEBOOK = 0.11; // PPN atas NETT (bukan price list) — HANDOVER §3.
const rnd = (v: number) => Math.round(v); // half-up, sama dengan ROUND() spreadsheet

/** Harga efektif satu baris setup.
 *
 *  Tanpa override → angka handover dipakai APA ADANYA. HANDOVER §9 melarang
 *  menghitung ulang dengan pembulatan sendiri: 13 baris beda Rp 1 karena
 *  generator sumber half-even sedangkan ROUND() half-up.
 *  Dengan override → angkanya bukan lagi angka handover, jadi rumus resmi
 *  berlaku: nett = ROUND(price × (1-diskon)), ppn = ROUND(nett × 1,11).
 */
export function hargaEfektif(r: {
  price_list: unknown; diskon_maks: unknown; harga_nett: unknown; nett_ppn: unknown;
  price_list_override: unknown; diskon_override: unknown;
}): { priceList: number; diskon: number; nett: number; ppn: number; adaOverride: boolean } {
  const plAsli = num(r.price_list);
  const dAsli = num(r.diskon_maks);
  const adaOverride = r.price_list_override !== null || r.diskon_override !== null;
  const priceList = r.price_list_override === null ? plAsli : num(r.price_list_override);
  const diskon = r.diskon_override === null ? dAsli : num(r.diskon_override);
  if (!adaOverride) {
    return { priceList, diskon, nett: num(r.harga_nett), ppn: num(r.nett_ppn), adaOverride };
  }
  const nett = rnd(priceList * (1 - diskon));
  return { priceList, diskon, nett, ppn: rnd(nett * (1 + PPN_PRICEBOOK)), adaOverride };
}

export async function listSetup(
  opts: { periode?: string; q?: string; lini?: string; limit?: number } = {},
): Promise<PricebookSetupRow[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const periode = opts.periode || PERIODE_DEFAULT;
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;

  const rows = await sql<Record<string, unknown>[]>`
    SELECT p.row_no, p.kode, p.lini, p.brand, p.nama, p.price_list, p.diskon_maks,
           p.harga_nett, p.nett_ppn,
           s.nama_final, s.varian, s.kemasan, s.satuan, s.hpp, s.product_kode,
           s.price_list_override, s.diskon_override, s.status, s.published_at::text,
           kat.nama AS kategori_nama, ln.nama AS line_nama,
           cl.nama AS class_nama, sc.nama AS sub_nama,
           (s.sub_class_id IS NOT NULL) AS klasifikasi_lengkap
      FROM product_pricelist p
      JOIN product_pricelist_setup s ON s.periode = p.periode AND s.row_no = p.row_no
      LEFT JOIN product_kategori kat ON kat.id = s.kategori_id
      LEFT JOIN product_line ln ON ln.kategori_id = s.kategori_id AND ln.id = s.line_id
      LEFT JOIN product_class cl ON cl.kategori_id = s.kategori_id AND cl.id = s.class_id
      LEFT JOIN product_sub_class sc ON sc.kategori_id = s.kategori_id
             AND sc.class_id = s.class_id AND sc.id = s.sub_class_id
     WHERE p.periode = ${periode}
       AND (${opts.lini ?? null}::text IS NULL OR p.lini = ${opts.lini ?? null})
       AND (${q}::text IS NULL OR COALESCE(s.nama_final, p.nama) ILIKE ${q}
            OR p.nama ILIKE ${q} OR p.brand ILIKE ${q} OR p.kode ILIKE ${q}
            OR s.product_kode ILIKE ${q})
     ORDER BY p.lini, p.brand, COALESCE(s.nama_final, p.nama)
     LIMIT ${limit}
  `;
  return rows.map((r) => {
    const e = hargaEfektif(r as Parameters<typeof hargaEfektif>[0]);
    return {
    rowNo: Number(r.row_no),
    kode: (r.kode as string) ?? null,
    lini: r.lini as string,
    brand: r.brand as string,
    nama: r.nama as string,
    namaFinal: (r.nama_final as string) ?? null,
    varian: (r.varian as string) ?? null,
    kemasan: (r.kemasan as string) ?? null,
    satuan: (r.satuan as string) ?? null,
    priceList: e.priceList,
    diskonMaks: e.diskon,
    hargaNett: e.nett,
    nettPpn: e.ppn,
    priceListAsli: num(r.price_list),
    diskonMaksAsli: num(r.diskon_maks),
    adaOverride: e.adaOverride,
    hpp: r.hpp === null || r.hpp === undefined ? null : num(r.hpp),
    // Margin dihitung dari harga EFEKTIF: begitu HoD menyetel Price List baru,
    // margin harus ikut bergerak, bukan tetap mengacu angka handover.
    marginPct:
      r.hpp === null || r.hpp === undefined || e.priceList <= 0
        ? null
        : 1 - num(r.hpp) / e.priceList,
    status: String(r.status ?? "draft"),
    publishedAt: (r.published_at as string) ?? null,
    kategori: (r.kategori_nama as string) ?? null,
    productLine: (r.line_nama as string) ?? null,
    klas: (r.class_nama as string) ?? null,
    subClass: (r.sub_nama as string) ?? null,
    productKode: (r.product_kode as string) ?? null,
    klasifikasiLengkap: r.klasifikasi_lengkap === true,
    };
  });
}

export async function setupSummary(periode = PERIODE_DEFAULT): Promise<PricebookSetupSummary> {
  const kosong: PricebookSetupSummary = {
    periode, total: 0, adaHpp: 0, tanpaHpp: 0, klasifikasiLengkap: 0, kepasangKode: 0,
    draft: 0, published: 0, adaOverride: 0,
    reviewTerbuka: 0, totalHpp: 0, totalPriceList: 0, marginAgregat: null,
  };
  if (!isDbEnabled()) return kosong;
  const sql = db();

  // Σ price list DIBATASI ke baris ber-HPP: kalau ikut baris tanpa HPP, margin
  // agregatnya jadi terlihat jauh lebih untung daripada kenyataannya.
  const [r] = await sql<Record<string, unknown>[]>`
    SELECT COUNT(*) AS total,
           COUNT(s.hpp) AS ada_hpp,
           COUNT(*) FILTER (WHERE s.hpp IS NULL) AS tanpa_hpp,
           COUNT(*) FILTER (WHERE s.sub_class_id IS NOT NULL) AS klas_lengkap,
           COUNT(s.product_kode) AS kepasang_kode,
           COUNT(*) FILTER (WHERE s.status = 'draft') AS draft,
           COUNT(*) FILTER (WHERE s.status = 'published') AS published,
           COUNT(*) FILTER (WHERE s.price_list_override IS NOT NULL
                               OR s.diskon_override IS NOT NULL) AS ada_override,
           COALESCE(SUM(s.hpp), 0) AS total_hpp,
           COALESCE(SUM(COALESCE(s.price_list_override, p.price_list))
                    FILTER (WHERE s.hpp IS NOT NULL), 0) AS total_pl
      FROM product_pricelist p
      JOIN product_pricelist_setup s ON s.periode = p.periode AND s.row_no = p.row_no
     WHERE p.periode = ${periode}
  `;
  const [rev] = await sql<Record<string, unknown>[]>`
    SELECT COUNT(*) AS n FROM product_code_review
     WHERE sumber = ${SUMBER_KROSCEK} AND status = 'terbuka'
  `;
  const totalHpp = num(r?.total_hpp);
  const totalPl = num(r?.total_pl);
  return {
    periode,
    total: num(r?.total),
    adaHpp: num(r?.ada_hpp),
    tanpaHpp: num(r?.tanpa_hpp),
    klasifikasiLengkap: num(r?.klas_lengkap),
    kepasangKode: num(r?.kepasang_kode),
    draft: num(r?.draft),
    published: num(r?.published),
    adaOverride: num(r?.ada_override),
    reviewTerbuka: num(rev?.n),
    totalHpp,
    totalPriceList: totalPl,
    marginAgregat: totalPl > 0 ? 1 - totalHpp / totalPl : null,
  };
}

// ── Tulis: setelan harga & gerbang publish (Setup Harga, migrasi 077) ───────
// Snapshot handover (`product_pricelist`) TIDAK pernah ditulis dari sini —
// perubahan hidup sebagai override di lapisan setup. Lihat migrasi 077.

export interface SetupPatch {
  periode?: string;
  rowNo: number;
  hpp?: number | null;
  priceListOverride?: number | null;
  diskonOverride?: number | null;
  catatan?: string | null;
  updatedBy?: string | null;
}

export async function updateSetupRow(
  patch: SetupPatch,
): Promise<{ ok: true; row: PricebookSetupRow } | { ok: false; error: string }> {
  if (!isDbEnabled()) return { ok: false, error: "DATABASE_URL off" };
  const periode = patch.periode || PERIODE_DEFAULT;
  if (!Number.isInteger(patch.rowNo)) return { ok: false, error: "rowNo wajib angka" };
  if (patch.hpp != null && patch.hpp <= 0) return { ok: false, error: "HPP harus lebih dari 0" };
  if (patch.priceListOverride != null && patch.priceListOverride <= 0) {
    return { ok: false, error: "Price List harus lebih dari 0" };
  }
  if (patch.diskonOverride != null && (patch.diskonOverride < 0 || patch.diskonOverride >= 1)) {
    return { ok: false, error: "Diskon harus antara 0% dan 100% (tidak termasuk 100%)" };
  }
  const sql = db();
  const rows = await sql<{ row_no: number }[]>`
    UPDATE product_pricelist_setup SET
      hpp = ${patch.hpp ?? null},
      price_list_override = ${patch.priceListOverride ?? null},
      diskon_override = ${patch.diskonOverride ?? null},
      catatan = ${patch.catatan ?? null},
      updated_by = ${patch.updatedBy ?? null},
      updated_at = now()
    WHERE periode = ${periode} AND row_no = ${patch.rowNo}
    RETURNING row_no`;
  if (!rows.length) return { ok: false, error: "baris tidak ditemukan di periode itu" };
  const [row] = await listSetup({ periode, limit: 20000 }).then((all) =>
    all.filter((x) => x.rowNo === patch.rowNo),
  );
  return row ? { ok: true, row } : { ok: false, error: "baris tersimpan tapi gagal dibaca ulang" };
}

/** rowNos kosong/undefined → SEMUA draft periode itu. */
export async function publishSetup(
  rowNos: number[] | undefined, by: string | null, periode = PERIODE_DEFAULT,
): Promise<{ published: number }> {
  if (!isDbEnabled()) return { published: 0 };
  const sql = db();
  const pilih = rowNos && rowNos.length ? rowNos : null;
  const rows = await sql`
    UPDATE product_pricelist_setup
       SET status = 'published', published_at = now(), published_by = ${by}, updated_at = now()
     WHERE periode = ${periode} AND status = 'draft'
       AND (${pilih}::int[] IS NULL OR row_no = ANY(${pilih}::int[]))
    RETURNING row_no`;
  return { published: rows.length };
}

export async function unpublishSetup(
  rowNos: number[] | undefined, periode = PERIODE_DEFAULT,
): Promise<{ unpublished: number }> {
  if (!isDbEnabled()) return { unpublished: 0 };
  const sql = db();
  const pilih = rowNos && rowNos.length ? rowNos : null;
  const rows = await sql`
    UPDATE product_pricelist_setup
       SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = now()
     WHERE periode = ${periode} AND status = 'published'
       AND (${pilih}::int[] IS NULL OR row_no = ANY(${pilih}::int[]))
    RETURNING row_no`;
  return { unpublished: rows.length };
}

// ── Harga terpublikasi untuk AM (tab "Harga per Produk") ────────────────────
// TANPA HPP dan TANPA margin — ini dibuka Account Manager. Bentuknya sengaja
// dibatasi di sini, bukan disaring di UI: kalau kolomnya tidak pernah di-SELECT,
// tidak ada cara ia bocor ke browser.

export interface PricebookPublishedRow {
  rowNo: number;
  kode: string | null;
  productKode: string | null;
  lini: string;
  // Nama Product Line dari master klasifikasi (072), bukan teks bebas — dipakai
  // filter di menu Price Book. NULL kalau baris setup belum punya klasifikasi.
  productLine: string | null;
  brand: string;
  nama: string;
  varian: string | null;
  kemasan: string | null;
  satuan: string | null;
  kategori: string | null;
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  nettPpn: number;
  publishedAt: string | null;
}

export async function listPublishedKeagenan(
  opts: { periode?: string; q?: string; lini?: string; limit?: number } = {},
): Promise<PricebookPublishedRow[]> {
  if (!isDbEnabled()) return [];
  const sql = db();
  const periode = opts.periode || PERIODE_DEFAULT;
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const q = opts.q?.trim() ? `%${opts.q.trim()}%` : null;

  const rows = await sql<Record<string, unknown>[]>`
    SELECT p.row_no, p.kode, p.lini, p.brand, p.nama, p.kategori,
           p.price_list, p.diskon_maks, p.harga_nett, p.nett_ppn,
           s.nama_final, s.varian, s.kemasan, s.satuan, s.product_kode,
           s.price_list_override, s.diskon_override, s.published_at::text,
           pl.nama AS product_line
      FROM product_pricelist p
      JOIN product_pricelist_setup s ON s.periode = p.periode AND s.row_no = p.row_no
      -- LEFT JOIN: baris setup yang klasifikasinya belum lengkap tetap tampil,
      -- cuma tanpa Product Line. Kalau INNER, harga bisa hilang dari muka AM
      -- hanya karena master klasifikasinya belum diisi.
      LEFT JOIN product_line pl ON pl.kategori_id = s.kategori_id AND pl.id = s.line_id
     WHERE p.periode = ${periode} AND s.status = 'published'
       AND (${opts.lini ?? null}::text IS NULL OR p.lini = ${opts.lini ?? null})
       AND (${q}::text IS NULL OR COALESCE(s.nama_final, p.nama) ILIKE ${q}
            OR p.brand ILIKE ${q} OR p.kode ILIKE ${q} OR s.product_kode ILIKE ${q})
     ORDER BY p.lini, p.brand, COALESCE(s.nama_final, p.nama)
     LIMIT ${limit}`;
  return rows.map((r) => {
    const e = hargaEfektif(r as Parameters<typeof hargaEfektif>[0]);
    return {
      rowNo: Number(r.row_no),
      kode: (r.kode as string) ?? null,
      productKode: (r.product_kode as string) ?? null,
      lini: r.lini as string,
      productLine: (r.product_line as string) ?? null,
      brand: r.brand as string,
      nama: ((r.nama_final as string) || (r.nama as string)) ?? "",
      varian: (r.varian as string) ?? null,
      kemasan: (r.kemasan as string) ?? null,
      satuan: (r.satuan as string) ?? null,
      kategori: (r.kategori as string) ?? null,
      priceList: e.priceList,
      diskonMaks: e.diskon,
      hargaNett: e.nett,
      nettPpn: e.ppn,
      publishedAt: (r.published_at as string) ?? null,
    };
  });
}
