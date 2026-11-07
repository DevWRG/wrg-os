// F149 (dipersempit) — monitor DO/SJ yang sudah dikirim tapi belum difakturkan
// (migrasi 283, issue #2052). SOP Fakturis: monitoring BON belum difakturkan.
//
// Sumber = cermin Accurate:
//   • accurate_delivery_order.status = statusName Accurate. Yang ditunggu Fakturis:
//     “Dikirim” (belum ada faktur sama sekali) dan “Difaktur Sebagian”.
//   • sisa per baris DO = qty DO − qty faktur yang menunjuk baris itu
//     (accurate_invoice_item.raw->>'deliveryOrderDetailId' = id baris DO).
//   • kategori pengadaan + salesman + nilai netto dari baris SO asal
//     (accurate_delivery_order_item.sales_order_detail_id = accurate_sales_order_item.line_id).
//     DO sendiri tak membawa nilai, cabang, maupun salesman.
//
// Keputusan user 7 Nov 2026:
//   • DO yang SEMUA barisnya kategori KSO → tab terpisah tanpa alarm (ditagih
//     bulanan lewat form perhitungan KSO, bukan per DO — status DO-nya memang
//     tetap “Dikirim”). Campuran / REGULAR / kosong / RUTIN / PL → tab Tagih.
//   • Terlambat = lewat N hari kerja sejak tanggal DO (param ambang_hari_kerja,
//     default 3; Sabtu/Minggu + Kalender Libur F14 dilewati).
//   • Rekap WA menyusul (belum ada job).
//
// Gerbang menu “/do-belum-faktur” (lihat / ubah ambang) diperiksa di BFF.

import { db } from "../db.js";
import { amLabelSql, cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";

export class DoFakturError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const STATUS_BELUM = ["Dikirim", "Difaktur Sebagian"] as const;
export type Tab = "tagih" | "kso";

// ---------------------------------------------------------------- murni (diuji)

/** Tab sebuah DO dari kategori baris-barisnya. Hanya DO yang SEMUA barisnya KSO masuk tab KSO. */
export function tabDari(kategori: (string | null)[]): Tab {
  if (!kategori.length) return "tagih"; // item belum tersinkron → jangan disembunyikan
  return kategori.every((k) => (k ?? "").trim().toUpperCase() === "KSO") ? "kso" : "tagih";
}

/** Terlambat = hari kerja sejak DO melewati ambang. Tab KSO tak pernah terlambat. */
export function terlambat(tab: Tab, hariKerja: number, ambang: number): boolean {
  return tab === "tagih" && hariKerja > ambang;
}

/** Ambang dari isian layar: bilangan bulat 0–60. */
export function ambangSah(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : null;
}

// ---------------------------------------------------------------- data

export async function bacaAmbang(): Promise<number> {
  const [r] = await db()`SELECT nilai::int AS n FROM do_belum_faktur_param WHERE kunci = 'ambang_hari_kerja'`;
  return r ? Number(r.n) : 3;
}

export async function ubahAmbang(v: unknown, oleh: string | null): Promise<{ ambang_hari_kerja: number }> {
  const n = ambangSah(v);
  if (n === null) throw new DoFakturError(400, "ambang hari kerja harus bilangan bulat 0–60");
  await db()`
    INSERT INTO do_belum_faktur_param (kunci, nilai, diubah_oleh, diubah_at) VALUES ('ambang_hari_kerja', ${n}, ${oleh}, now())
    ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now()`;
  return { ambang_hari_kerja: n };
}

export interface BarisDo {
  id: number; nomor: string; tanggal: string; status: string; customer_id: number | null; customer: string;
  cabang: string | null; am: string; kategori: string; tab: Tab; baris: number; baris_sisa: number;
  item_tersinkron: boolean; nilai: number | null; umur_hari: number; hari_kerja: number; terlambat: boolean;
}

export interface FilterDo { tab?: string | null; q?: string | null; cabang?: string | null; hanya_terlambat?: boolean; limit?: number; offset?: number }

/** Semua DO belum difaktur + kolom turunan — dipakai daftar & ringkasan (±ratusan baris). */
async function semua(): Promise<BarisDo[]> {
  const sql = db();
  const ambang = await bacaAmbang();
  const rows = await sql`
    WITH baris AS (
      SELECT di.delivery_id AS do_id, di.line_no, COALESCE(di.qty, 0)::numeric AS qty,
             upper(NULLIF(btrim(si.raw->>'charField1'), '')) AS kat,
             NULLIF(si.raw->>'salesman1Id', '')::bigint AS sid,
             (si.raw->>'dppAmount')::numeric / NULLIF(si.qty, 0) AS netto_per_unit,
             -- Hanya DO “Difaktur Sebagian” yang punya faktur; “Dikirim” pasti 0. CASE
             -- mencegah subkueri jalan untuk ratusan DO lain, dan syarat raw ? … membuat
             -- indeks parsial migrasi 283 terpakai (tanpa itu: baca raw SEMUA baris faktur
             -- per baris DO — uji dev 7 Nov: > 1 menit).
             CASE WHEN o.status = 'Difaktur Sebagian' THEN
               COALESCE((SELECT sum(ii.qty) FROM accurate_invoice_item ii
                          WHERE ii.raw ? 'deliveryOrderDetailId'
                            AND ii.raw->>'deliveryOrderDetailId' = di.raw->>'id'), 0)
             ELSE 0 END::numeric AS qty_faktur
      FROM accurate_delivery_order_item di
      JOIN accurate_delivery_order o ON o.id = di.delivery_id
      LEFT JOIN accurate_sales_order_item si ON si.line_id = di.sales_order_detail_id
      WHERE o.status IN ${sql(STATUS_BELUM as unknown as string[])}
    ),
    per_do AS (
      SELECT do_id, count(*)::int AS baris,
             count(*) FILTER (WHERE qty - qty_faktur > 0)::int AS baris_sisa,
             array_agg(kat ORDER BY line_no) AS kat,
             (array_agg(sid ORDER BY line_no) FILTER (WHERE sid IS NOT NULL))[1] AS sid,
             sum(GREATEST(qty - qty_faktur, 0) * netto_per_unit) AS nilai,
             bool_or(netto_per_unit IS NULL) AS nilai_kurang
      FROM baris GROUP BY do_id
    ),
    ai AS (
      SELECT o.id, o.number, o.trans_date AS tanggal, o.status, o.customer_id, o.customer_name,
             p.baris, p.baris_sisa, p.kat, p.nilai, p.nilai_kurang,
             p.sid AS salesman_id, NULL::text AS salesman_name
      FROM accurate_delivery_order o
      LEFT JOIN per_do p ON p.do_id = o.id
      WHERE o.status IN ${sql(STATUS_BELUM as unknown as string[])} AND o.trans_date IS NOT NULL
    )
    SELECT ai.id::int, ai.number AS nomor, ai.tanggal::text, ai.status, ai.customer_id::int,
           COALESCE(NULLIF(ai.customer_name, ''), '—') AS customer,
           ${cabangEffSql(sql)} AS cabang, ${amLabelSql(sql)} AS am,
           COALESCE(ai.baris, 0) AS baris, COALESCE(ai.baris_sisa, 0) AS baris_sisa,
           COALESCE(ai.kat, ARRAY[]::text[]) AS kat,
           CASE WHEN ai.baris IS NULL OR ai.nilai_kurang THEN NULL ELSE ai.nilai END::float8 AS nilai,
           ((now() AT TIME ZONE 'Asia/Jakarta')::date - ai.tanggal)::int AS umur_hari,
           produk_permintaan_hari_kerja(ai.tanggal, (now() AT TIME ZONE 'Asia/Jakarta')::date) AS hari_kerja
    FROM ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    ORDER BY ai.tanggal, ai.number`;
  return rows.map((r) => {
    const kat = (r.kat as (string | null)[]) ?? [];
    const tab = tabDari(kat);
    const unik = [...new Set(kat.map((k) => k ?? "tanpa kategori"))];
    return {
      id: Number(r.id), nomor: String(r.nomor), tanggal: String(r.tanggal), status: String(r.status),
      customer_id: r.customer_id == null ? null : Number(r.customer_id), customer: String(r.customer),
      cabang: r.cabang ? String(r.cabang) : null, am: String(r.am),
      kategori: unik.length ? unik.join(" / ") : "—", tab,
      baris: Number(r.baris), baris_sisa: Number(r.baris_sisa), item_tersinkron: Number(r.baris) > 0,
      nilai: r.nilai == null ? null : Number(r.nilai),
      umur_hari: Number(r.umur_hari), hari_kerja: Number(r.hari_kerja),
      terlambat: terlambat(tab, Number(r.hari_kerja), ambang),
    };
  });
}

export async function listDoBelumFaktur(f: FilterDo) {
  const ambang = await bacaAmbang();
  const tab: Tab = f.tab === "kso" ? "kso" : "tagih";
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);
  const q = (f.q ?? "").trim().toLowerCase();
  const cabang = (f.cabang ?? "").trim();
  const all = await semua();

  const ringkas = (t: Tab) => {
    const r = all.filter((x) => x.tab === t);
    return {
      do: r.length,
      terlambat: r.filter((x) => x.terlambat).length,
      nilai: r.reduce((s, x) => s + (x.nilai ?? 0), 0),
      tanpa_nilai: r.filter((x) => x.nilai == null).length,
      tertua_hari: r.reduce((m, x) => Math.max(m, x.umur_hari), 0),
    };
  };
  const cocok = all.filter((x) => x.tab === tab
    && (!q || x.nomor.toLowerCase().includes(q) || x.customer.toLowerCase().includes(q) || x.am.toLowerCase().includes(q))
    && (!cabang || (x.cabang ?? "Tanpa cabang") === cabang)
    && (!f.hanya_terlambat || x.terlambat));
  // terlambat & tertua dulu — itu yang dikejar Fakturis
  cocok.sort((a, b) => Number(b.terlambat) - Number(a.terlambat) || b.hari_kerja - a.hari_kerja || a.nomor.localeCompare(b.nomor));
  const cabangOpsi = [...new Set(all.filter((x) => x.tab === tab).map((x) => x.cabang ?? "Tanpa cabang"))].sort();
  return {
    ambang_hari_kerja: ambang,
    ringkasan: { tagih: ringkas("tagih"), kso: ringkas("kso") },
    cabang_opsi: cabangOpsi,
    count: Math.max(0, Math.min(limit, cocok.length - offset)),
    total_rows: cocok.length, limit, offset,
    items: cocok.slice(offset, offset + limit),
  };
}
