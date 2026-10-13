// F74 Non-KSO Field Campaign Tracker (menyerap F46 Bulk Import Campaign).
//
// Kampanye = daftar brand + (opsional) item Accurate tertentu + periode. Semua
// realisasi dihitung OTOMATIS (keputusan user 13 Okt 2026) — AM tak menandai
// apa pun:
//   • Faktur  : baris accurate_invoice_item non-KSO (charField1 ≠ 'KSO') yang
//               item-nya cocok, dalam periode. Netto dialokasikan proporsional
//               per baris (rumus yang sama dgn Sales Analytics per-produk).
//   • SO      : baris accurate_sales_order_item non-KSO, netto = dppAmount.
//   • Corong  : lead / deal / demo-trial ber-brand cocok yang dibuat dalam
//               periode; aktivitas #REPORT yang tertaut ke deal itu.
// Brand per item = item_brand() (migrasi 214): Klasifikasi Produk → Price Book
// → alias brand di nama item.
//
// Scope: AM = dirinya, HoD = cabang timnya, admin = semua (resolveScope).
// Tulis (buat/ubah/batalkan): BUKAN AM dan bukan viewer; HoD hanya bisa
// mengisi target AM di cabang timnya — target AM lain dibiarkan apa adanya.

import { db } from "../db.js";
import { FULL_SCOPE, resolveScope, scopeAccurateClause, scopeOnClause, type DataScope } from "./access-scope.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { listOwnerCandidates } from "./account.js";

export class CampaignError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Murni (diuji tanpa DB) ──────────────────────────────────────────────────

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const tglSah = (s: string): boolean => TGL.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const hariIniWib = (now: Date = new Date()): string =>
  new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

const selisihHari = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export type StatusKampanye = "akan datang" | "berjalan" | "selesai" | "dibatalkan";

export function statusKampanye(c: { tanggal_mulai: string; tanggal_selesai: string; dibatalkan: boolean }, hariIni: string): StatusKampanye {
  if (c.dibatalkan) return "dibatalkan";
  if (hariIni < c.tanggal_mulai) return "akan datang";
  if (hariIni > c.tanggal_selesai) return "selesai";
  return "berjalan";
}

export interface Pacing {
  hari_ke: number;          // 0 bila belum mulai
  hari_total: number;
  harapan_pct: number;      // % target yang "seharusnya" sudah tercapai hari ini
  capai_pct: number | null; // realisasi ÷ target (null bila target 0)
  status: "di depan" | "sesuai" | "tertinggal" | null;
}

/**
 * Pacing linier per hari kalender: hari ke-h dari H hari → harapan h/H.
 * Toleransi ±10 poin persen dari harapan = "sesuai". Tanpa target → status null.
 */
export function hitungPacing(target: number, realisasi: number, mulai: string, selesai: string, hariIni: string): Pacing {
  const hariTotal = selisihHari(mulai, selesai) + 1;
  const hariKe = Math.min(Math.max(selisihHari(mulai, hariIni) + 1, 0), hariTotal);
  const harapan = hariTotal > 0 ? (hariKe / hariTotal) * 100 : 0;
  const capai = target > 0 ? (realisasi / target) * 100 : null;
  let status: Pacing["status"] = null;
  if (capai != null && hariKe > 0) status = capai >= harapan + 10 ? "di depan" : capai >= harapan - 10 ? "sesuai" : "tertinggal";
  return {
    hari_ke: hariKe, hari_total: hariTotal,
    harapan_pct: Math.round(harapan * 10) / 10,
    capai_pct: capai == null ? null : Math.round(capai * 10) / 10,
    status,
  };
}

export interface TargetInput { am_id: string; target_rp: number; target_qty: number | null }
export interface KampanyeInput {
  nama: string;
  deskripsi: string | null;
  tanggal_mulai: string;
  tanggal_selesai: string;
  satuan_qty: string | null;
  brands: string[];
  item_ids: number[];
  targets: TargetInput[];
}

const teks = (v: unknown, maks: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, maks) : null;
};
const angka = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  // String gaya Indonesia: titik = pemisah ribuan, koma = desimal ("500.000.000", "12,5").
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Validasi + normalisasi body buat/ubah. Lempar CampaignError(400) bila tak sah. */
export function validasiKampanye(b: Record<string, unknown>): KampanyeInput {
  const nama = teks(b.nama, 120);
  if (!nama) throw new CampaignError(400, "nama kampanye wajib diisi");
  const mulai = teks(b.tanggal_mulai, 10) ?? "";
  const selesai = teks(b.tanggal_selesai, 10) ?? "";
  if (!tglSah(mulai) || !tglSah(selesai)) throw new CampaignError(400, "tanggal mulai & selesai wajib (YYYY-MM-DD)");
  if (selesai < mulai) throw new CampaignError(400, "tanggal selesai tidak boleh sebelum tanggal mulai");
  if (selisihHari(mulai, selesai) > 366) throw new CampaignError(400, "periode kampanye maksimal 1 tahun");

  const brands = Array.isArray(b.brands)
    ? [...new Set(b.brands.map((x) => teks(x, 80)).filter((x): x is string => !!x))]
    : [];
  const itemIds = Array.isArray(b.item_ids)
    ? [...new Set(b.item_ids.map((x) => Number(x)).filter((x) => Number.isSafeInteger(x) && x > 0))]
    : [];
  if (!brands.length && !itemIds.length) throw new CampaignError(400, "pilih minimal satu brand atau item");
  if (brands.length > 30 || itemIds.length > 200) throw new CampaignError(400, "brand maksimal 30, item maksimal 200");

  const satuan = teks(b.satuan_qty, 20);
  const targets: TargetInput[] = [];
  const sudah = new Set<string>();
  for (const t of Array.isArray(b.targets) ? b.targets : []) {
    const r = (t ?? {}) as Record<string, unknown>;
    const am = teks(r.am_id, 40);
    if (!am) continue;
    if (sudah.has(am)) throw new CampaignError(400, `target AM ${am} ganda`);
    const rp = angka(r.target_rp);
    const qty = angka(r.target_qty);
    if (rp === null && qty === null) continue; // baris kosong = tanpa target
    if (rp === null || Number.isNaN(rp) || rp < 0) throw new CampaignError(400, `target Rupiah AM ${am} tidak sah`);
    if (qty !== null && (Number.isNaN(qty) || qty < 0)) throw new CampaignError(400, `target qty AM ${am} tidak sah`);
    if (qty !== null && !satuan) throw new CampaignError(400, "isi satuan qty (mis. box) bila memakai target qty");
    sudah.add(am);
    targets.push({ am_id: am, target_rp: rp, target_qty: qty });
  }
  return {
    nama, deskripsi: teks(b.deskripsi, 500), tanggal_mulai: mulai, tanggal_selesai: selesai,
    satuan_qty: satuan, brands, item_ids: itemIds, targets,
  };
}

const bolehTulis = (s: DataScope): boolean =>
  !s.amOnly && String(s.role ?? "").toLowerCase() !== "viewer";

// ── Baca ───────────────────────────────────────────────────────────────────

export interface KampanyeRow {
  id: string;
  kode: string;
  nama: string;
  deskripsi: string | null;
  tanggal_mulai: string;
  tanggal_selesai: string;
  satuan_qty: string | null;
  dibatalkan: boolean;
  status: StatusKampanye;
  brands: string[];
  items: { item_id: string; no: string | null; nama: string | null; brand: string | null }[];
  created_by: string | null;
  updated_at: string;
}

type Sql = ReturnType<typeof db>;

async function muatKampanye(sql: Sql, ids: number[] | null): Promise<KampanyeRow[]> {
  const rows = await sql`
    SELECT c.id::text, c.kode, c.nama, c.deskripsi, c.tanggal_mulai::text, c.tanggal_selesai::text,
           c.satuan_qty, c.dibatalkan, c.created_by, c.updated_at::text,
           COALESCE((SELECT array_agg(b.brand ORDER BY b.brand) FROM campaign_brand b WHERE b.campaign_id = c.id), '{}') AS brands,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id', ci.item_id::text, 'no', it.no, 'nama', it.name, 'brand', item_brand(ci.item_id)) ORDER BY it.name)
                       FROM campaign_item ci LEFT JOIN accurate_item it ON it.id = ci.item_id
                      WHERE ci.campaign_id = c.id), '[]'::jsonb) AS items
    FROM campaign c
    WHERE ${ids ? sql`c.id = ANY(${ids}::bigint[])` : sql`true`}
    ORDER BY c.dibatalkan, c.tanggal_selesai DESC, c.id DESC`;
  const hari = hariIniWib();
  return rows.map((r) => ({
    id: String(r.id), kode: String(r.kode), nama: String(r.nama), deskripsi: r.deskripsi ?? null,
    tanggal_mulai: String(r.tanggal_mulai), tanggal_selesai: String(r.tanggal_selesai),
    satuan_qty: r.satuan_qty ?? null, dibatalkan: Boolean(r.dibatalkan),
    status: statusKampanye({ tanggal_mulai: String(r.tanggal_mulai), tanggal_selesai: String(r.tanggal_selesai), dibatalkan: Boolean(r.dibatalkan) }, hari),
    brands: (r.brands as string[]) ?? [],
    items: (r.items as KampanyeRow["items"]) ?? [],
    created_by: r.created_by ?? null, updated_at: String(r.updated_at),
  }));
}

// Brand efektif untuk corong lead/deal/demo = brand kampanye ∪ brand dari item
// pilihan (kampanye 1 SKU tetap punya corong lewat brand item-nya).
const brandEfektif = (c: KampanyeRow): string[] =>
  [...new Set([...c.brands, ...c.items.map((i) => i.brand).filter((b): b is string => !!b)])];

interface RealisasiAm { am_id: string | null; nama: string; netto: number; qty: number; faktur: number; customer: number }
interface RealisasiItem { item_id: string; nama: string; brand: string | null; netto: number; qty: number }

// Baris faktur non-KSO yang cocok dgn kampanye, dalam [from, to], ber-scope.
// Alokasi netto dihitung atas SEMUA baris faktur (termasuk KSO) dulu, baru
// disaring — supaya bagian baris non-KSO tak membengkak.
async function realisasiFaktur(sql: Sql, id: number, from: string, to: string, sc: DataScope) {
  const rows = await sql`
    WITH inv AS (
      SELECT ai.id, ai.customer_id, (ai.total - COALESCE(ai.tax_amount, 0))::float8 AS inv_net,
             NULLIF(mu.am_id, '') AS am_id, NULLIF(mu.nama, '') AS am_nama
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${from}::date AND ${to}::date ${scopeAccurateClause(sql, sc)}
    ),
    line AS (
      SELECT aii.invoice_id, aii.item_id, COALESCE(aii.qty, 0)::float8 AS qty, inv.inv_net, inv.customer_id,
             inv.am_id, inv.am_nama, upper(COALESCE(aii.raw->>'charField1', '')) AS peng,
             aii.raw->'item'->>'name' AS raw_name, GREATEST(aii.total, 0) AS w,
             sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id) AS wsum,
             count(*) OVER (PARTITION BY aii.invoice_id) AS cnt
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    ),
    cocok AS (
      SELECT x.item_id FROM (SELECT DISTINCT item_id FROM line WHERE peng <> 'KSO') x
      WHERE x.item_id IN (SELECT item_id FROM campaign_item WHERE campaign_id = ${id})
         OR item_brand(x.item_id) IN (SELECT brand FROM campaign_brand WHERE campaign_id = ${id})
    )
    SELECT l.invoice_id, l.item_id::text AS item_id, l.qty, l.customer_id, l.am_id, l.am_nama,
           (NOT EXISTS (SELECT 1 FROM campaign_item WHERE campaign_id = ${id})
             OR l.item_id IN (SELECT item_id FROM campaign_item WHERE campaign_id = ${id})) AS hitung_qty,
           COALESCE(NULLIF(it.name, ''), l.raw_name, 'Item #' || l.item_id::text) AS item_nama,
           (CASE WHEN l.wsum > 0 THEN l.inv_net * l.w / l.wsum ELSE l.inv_net / l.cnt END)::float8 AS netto
    FROM line l
    LEFT JOIN accurate_item it ON it.id = l.item_id
    WHERE l.peng <> 'KSO' AND l.item_id IN (SELECT item_id FROM cocok)`;

  const perAm = new Map<string, RealisasiAm & { _f: Set<string>; _c: Set<string> }>();
  const perItem = new Map<string, RealisasiItem>();
  let netto = 0;
  let qty = 0;
  for (const r of rows) {
    const n = Number(r.netto) || 0;
    // Qty kampanye = item PILIHAN saja bila ada (satuan antar-item brand beda —
    // strip, meter, diluent — jadi menjumlah semuanya tak bermakna); tanpa item
    // pilihan = semua item yang cocok. Qty per item tetap apa adanya.
    const qItem = Number(r.qty) || 0;
    const q = r.hitung_qty ? qItem : 0;
    netto += n;
    qty += q;
    const k = r.am_id ?? "";
    const a = perAm.get(k) ?? { am_id: r.am_id ?? null, nama: r.am_nama ?? "Tanpa AM", netto: 0, qty: 0, faktur: 0, customer: 0, _f: new Set(), _c: new Set() };
    a.netto += n; a.qty += q; a._f.add(String(r.invoice_id)); if (r.customer_id != null) a._c.add(String(r.customer_id));
    perAm.set(k, a);
    const it = perItem.get(r.item_id) ?? { item_id: r.item_id, nama: String(r.item_nama), brand: null, netto: 0, qty: 0 };
    it.netto += n; it.qty += qItem;
    perItem.set(r.item_id, it);
  }
  const fakturUnik = new Set(rows.map((r) => String(r.invoice_id))).size;
  const customerUnik = new Set(rows.filter((r) => r.customer_id != null).map((r) => String(r.customer_id))).size;
  return {
    netto, qty, faktur: fakturUnik, customer: customerUnik,
    per_am: [...perAm.values()].map(({ _f, _c, ...a }) => ({ ...a, faktur: _f.size, customer: _c.size })),
    per_item: [...perItem.values()].sort((a, b) => b.netto - a.netto),
  };
}

// SO non-KSO (dppAmount = netto baris) yang item-nya cocok. Header SO tak
// membawa salesman — salesman1Id dari baris pertama, persis pola SO pacing (F21).
async function realisasiSo(sql: Sql, id: number, from: string, to: string, sc: DataScope) {
  const rows = await sql`
    WITH so AS (
      SELECT so.id, so.trans_date AS tanggal, so.customer_id, so.status, i.item_no,
             COALESCE(i.qty, 0)::float8 AS qty, COALESCE((i.raw->>'dppAmount')::numeric, 0)::float8 AS netto,
             upper(COALESCE(i.raw->>'charField1', '')) AS peng,
             first_value(NULLIF(i.raw->>'salesman1Id', '')::bigint) OVER (PARTITION BY so.id ORDER BY i.line_no) AS salesman_id
      FROM accurate_sales_order so
      JOIN accurate_sales_order_item i ON i.order_id = so.id
      WHERE so.trans_date BETWEEN ${from}::date AND ${to}::date AND COALESCE(so.status, '') NOT ILIKE '%batal%'
    )
    SELECT ai.id, ai.netto, ai.qty, NULLIF(mu.am_id, '') AS am_id
    FROM (SELECT so.*, NULL::text AS salesman_name FROM so) ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    LEFT JOIN accurate_item it ON it.no = ai.item_no
    WHERE ai.peng <> 'KSO'
      AND (it.id IN (SELECT item_id FROM campaign_item WHERE campaign_id = ${id})
           OR item_brand(it.id) IN (SELECT brand FROM campaign_brand WHERE campaign_id = ${id}))
      ${scopeAccurateClause(sql, sc)}`;
  const perAm = new Map<string, number>();
  let netto = 0;
  for (const r of rows) {
    const n = Number(r.netto) || 0;
    netto += n;
    perAm.set(r.am_id ?? "", (perAm.get(r.am_id ?? "") ?? 0) + n);
  }
  return { netto, so: new Set(rows.map((r) => String(r.id))).size, per_am: perAm };
}

async function corong(sql: Sql, brands: string[], from: string, to: string, sc: DataScope) {
  if (!brands.length) return { lead: 0, lead_dikonversi: 0, deal: 0, deal_menang: 0, pipeline_terbuka: 0, aktivitas: 0, demo_trial: 0, demo_positif: 0 };
  const [lead] = await sql`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE l.status = 'dikonversi')::int AS konv
    FROM lead l
    WHERE l.created_at >= ${from}::date AND l.created_at < ${to}::date + 1
      AND norm_brand(l.brand) = ANY(${brands}::text[])
      ${scopeOnClause(sql, sc, sql`l.am_id`, sql`l.cabang`)}`;
  const [deal] = await sql`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE d.stage::text = 'Closing-Won')::int AS menang,
           COALESCE(sum(COALESCE(d.estimated_value, d.estimate_amount)) FILTER (WHERE d.stage::text NOT LIKE 'Closing-%'), 0)::float8 AS terbuka
    FROM deal d
    WHERE d.created_at >= ${from}::date AND d.created_at < ${to}::date + 1
      AND d.brand = ANY(${brands}::text[])
      ${scopeOnClause(sql, sc, sql`d.am_id`, sql`d.cabang`)}`;
  const [akt] = await sql`
    SELECT count(*)::int AS n
    FROM activity_log a JOIN deal d ON d.deal_id = a.opportunity_id
    WHERE a.tanggal BETWEEN ${from}::date AND ${to}::date
      AND d.brand = ANY(${brands}::text[])
      ${scopeOnClause(sql, sc, sql`d.am_id`, sql`d.cabang`)}`;
  const [dt] = await sql`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE t.hasil = 'positif')::int AS positif
    FROM demo_trial t
    WHERE t.tanggal BETWEEN ${from}::date AND ${to}::date
      AND t.brand = ANY(${brands}::text[])
      ${scopeOnClause(sql, sc, sql`t.am_id`, sql`t.cabang`)}`;
  return {
    lead: Number(lead.n), lead_dikonversi: Number(lead.konv),
    deal: Number(deal.n), deal_menang: Number(deal.menang), pipeline_terbuka: Number(deal.terbuka),
    aktivitas: Number(akt.n), demo_trial: Number(dt.n), demo_positif: Number(dt.positif),
  };
}

async function targetTerlihat(sql: Sql, id: number, sc: DataScope) {
  const rows = await sql`
    SELECT t.am_id, COALESCE(NULLIF(mu.nama, ''), t.am_id) AS nama, NULLIF(mu.cabang, '') AS cabang,
           t.target_rp::float8 AS target_rp, t.target_qty::float8 AS target_qty
    FROM campaign_target t
    LEFT JOIN master_user mu ON mu.am_id = t.am_id
    WHERE t.campaign_id = ${id} ${scopeOnClause(sql, sc, sql`t.am_id`, sql`mu.cabang`)}
    ORDER BY nama`;
  return rows.map((r) => ({
    am_id: String(r.am_id), nama: String(r.nama), cabang: r.cabang ?? null,
    target_rp: Number(r.target_rp) || 0, target_qty: r.target_qty == null ? null : Number(r.target_qty),
  }));
}

const tahunLalu = (d: string): string => {
  const [y, m, h] = d.split("-").map(Number);
  // 29 Feb → 28 Feb tahun lalu
  const dt = new Date(Date.UTC(y - 1, m - 1, h));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
};

export interface Ringkasan {
  target_rp: number;
  target_qty: number | null;
  netto: number;
  qty: number;
  faktur: number;
  customer: number;
  so_netto: number;
  pacing: Pacing;
}

async function ringkasKampanye(sql: Sql, c: KampanyeRow, sc: DataScope, hari: string) {
  const id = Number(c.id);
  const sampai = hari < c.tanggal_selesai ? hari : c.tanggal_selesai;
  const belumMulai = hari < c.tanggal_mulai;
  const targets = await targetTerlihat(sql, id, sc);
  const kosong = { netto: 0, qty: 0, faktur: 0, customer: 0, per_am: [] as RealisasiAm[], per_item: [] as RealisasiItem[] };
  const f = belumMulai ? kosong : await realisasiFaktur(sql, id, c.tanggal_mulai, sampai, sc);
  const target_rp = targets.reduce((s, t) => s + t.target_rp, 0);
  const tq = targets.filter((t) => t.target_qty != null);
  const target_qty = tq.length ? tq.reduce((s, t) => s + (t.target_qty ?? 0), 0) : null;
  return { targets, f, sampai, belumMulai, target_rp, target_qty };
}

export async function listKampanye(sc: DataScope = FULL_SCOPE) {
  const sql = db();
  const hari = hariIniWib();
  const list = await muatKampanye(sql, null);
  return Promise.all(list.map(async (c) => {
    const r = c.dibatalkan
      ? { target_rp: 0, target_qty: null, f: { netto: 0, qty: 0, faktur: 0, customer: 0 } }
      : await ringkasKampanye(sql, c, sc, hari);
    return {
      ...c,
      ringkasan: {
        target_rp: r.target_rp, target_qty: r.target_qty, netto: r.f.netto, qty: r.f.qty,
        faktur: r.f.faktur, customer: r.f.customer,
        pacing: hitungPacing(r.target_rp, r.f.netto, c.tanggal_mulai, c.tanggal_selesai, hari),
      },
    };
  }));
}

export async function detailKampanye(sc: DataScope, idText: string) {
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CampaignError(400, "id kampanye tidak sah");
  const sql = db();
  const [c] = await muatKampanye(sql, [id]);
  if (!c) throw new CampaignError(404, "kampanye tak ditemukan");
  const hari = hariIniWib();
  const r = await ringkasKampanye(sql, c, sc, hari);
  const so = r.belumMulai ? { netto: 0, so: 0, per_am: new Map<string, number>() } : await realisasiSo(sql, id, c.tanggal_mulai, r.sampai, sc);
  // Pembanding: periode yang sama tahun lalu, dipotong di hari yang sama.
  const ly = r.belumMulai ? null : await realisasiFaktur(sql, id, tahunLalu(c.tanggal_mulai), tahunLalu(r.sampai), sc);
  const brands = brandEfektif(c);
  const funnel = r.belumMulai ? await corong(sql, [], c.tanggal_mulai, r.sampai, sc) : await corong(sql, brands, c.tanggal_mulai, r.sampai, sc);

  const brandItem = new Map(c.items.map((i) => [i.item_id, i.brand]));
  const perItem = r.f.per_item.slice(0, 25);
  if (perItem.length) {
    const ids = perItem.map((i) => Number(i.item_id));
    const b = await sql`SELECT x::text AS id, item_brand(x) AS brand FROM unnest(${ids}::bigint[]) AS x`;
    const m = new Map(b.map((x) => [String(x.id), (x.brand as string | null) ?? null]));
    for (const i of perItem) i.brand = m.get(i.item_id) ?? brandItem.get(i.item_id) ?? null;
  }

  // Baris per AM = gabungan AM bertarget (dalam scope) + AM yang punya realisasi.
  const lyAm = new Map((ly?.per_am ?? []).map((a) => [a.am_id ?? "", a.netto]));
  const realAm = new Map(r.f.per_am.map((a) => [a.am_id ?? "", a]));
  const baris = r.targets.map((t) => {
    const a = realAm.get(t.am_id);
    realAm.delete(t.am_id);
    return {
      am_id: t.am_id, nama: t.nama, cabang: t.cabang, target_rp: t.target_rp, target_qty: t.target_qty,
      netto: a?.netto ?? 0, qty: a?.qty ?? 0, faktur: a?.faktur ?? 0, customer: a?.customer ?? 0,
      so_netto: so.per_am.get(t.am_id) ?? 0, tahun_lalu: lyAm.get(t.am_id) ?? 0,
      pacing: hitungPacing(t.target_rp, a?.netto ?? 0, c.tanggal_mulai, c.tanggal_selesai, hari),
    };
  });
  for (const [k, a] of realAm) {
    baris.push({
      am_id: a.am_id ?? "", nama: a.am_id ? a.nama : "Tanpa AM (VACANT/OFFICE)", cabang: null, target_rp: 0, target_qty: null,
      netto: a.netto, qty: a.qty, faktur: a.faktur, customer: a.customer,
      so_netto: so.per_am.get(k) ?? 0, tahun_lalu: lyAm.get(k) ?? 0,
      pacing: hitungPacing(0, a.netto, c.tanggal_mulai, c.tanggal_selesai, hari),
    });
  }
  baris.sort((a, b) => b.target_rp - a.target_rp || b.netto - a.netto);

  const ringkasan: Ringkasan & { tahun_lalu: number | null; so: number } = {
    target_rp: r.target_rp, target_qty: r.target_qty, netto: r.f.netto, qty: r.f.qty,
    faktur: r.f.faktur, customer: r.f.customer, so_netto: so.netto, so: so.so,
    tahun_lalu: ly ? ly.netto : null,
    pacing: hitungPacing(r.target_rp, r.f.netto, c.tanggal_mulai, c.tanggal_selesai, hari),
  };
  return {
    kampanye: c, ringkasan, corong: { ...funnel, so: so.so, faktur: r.f.faktur },
    brand_corong: brands, per_am: baris, per_item: perItem,
    hari_ini: hari, dihitung_sampai: r.sampai,
    boleh_ubah: bolehTulis(sc),
  };
}

// ── Opsi form ──────────────────────────────────────────────────────────────

export async function opsiBrand(): Promise<string[]> {
  const rows = await db()`SELECT DISTINCT canonical FROM brand_alias WHERE kind = 'brand' AND btrim(canonical) <> '' ORDER BY 1`;
  return rows.map((r) => String(r.canonical));
}

export async function cariItem(q: string) {
  const t = q.trim();
  if (t.length < 2) return [];
  const pola = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db()`
    SELECT it.id::text AS item_id, it.no, it.name AS nama, item_brand(it.id) AS brand
    FROM accurate_item it
    WHERE it.name ILIKE ${pola} OR it.no ILIKE ${pola}
    ORDER BY it.name LIMIT 20`;
  return rows.map((r) => ({ item_id: String(r.item_id), no: r.no ?? null, nama: r.nama ?? null, brand: r.brand ?? null }));
}

// ── Tulis ──────────────────────────────────────────────────────────────────

async function simpanIsi(sql: Sql, id: number, v: KampanyeInput, sc: DataScope) {
  // Brand disimpan dalam bentuk kanonik supaya cocok dgn item_brand()/deal.brand.
  const brands = v.brands.length
    ? (await sql`SELECT DISTINCT norm_brand(b) AS b FROM unnest(${v.brands}::text[]) AS b`).map((r) => String(r.b)).filter(Boolean)
    : [];
  if (v.item_ids.length) {
    const ada = await sql`SELECT id FROM accurate_item WHERE id = ANY(${v.item_ids}::bigint[])`;
    if (ada.length !== v.item_ids.length) throw new CampaignError(400, "ada item yang tak ditemukan di Accurate");
  }
  // Target: hanya AM yang boleh diatur pemanggil (HoD = cabang timnya).
  const kandidat = await listOwnerCandidates(sc);
  const bolehAm = new Set(kandidat.map((k) => k.am_id));
  for (const t of v.targets) {
    if (!bolehAm.has(t.am_id)) throw new CampaignError(400, `AM ${t.am_id} bukan AM aktif di cabang Anda`);
  }
  await sql`DELETE FROM campaign_brand WHERE campaign_id = ${id}`;
  if (brands.length) await sql`INSERT INTO campaign_brand (campaign_id, brand) SELECT ${id}, unnest(${brands}::text[]) ON CONFLICT DO NOTHING`;
  await sql`DELETE FROM campaign_item WHERE campaign_id = ${id}`;
  if (v.item_ids.length) await sql`INSERT INTO campaign_item (campaign_id, item_id) SELECT ${id}, unnest(${v.item_ids}::bigint[]) ON CONFLICT DO NOTHING`;
  const amBoleh = [...bolehAm];
  await sql`DELETE FROM campaign_target WHERE campaign_id = ${id} AND am_id = ANY(${amBoleh}::text[])`;
  for (const t of v.targets) {
    await sql`INSERT INTO campaign_target (campaign_id, am_id, target_rp, target_qty)
              VALUES (${id}, ${t.am_id}, ${t.target_rp}, ${t.target_qty})`;
  }
}

export async function buatKampanye(sc: DataScope, body: Record<string, unknown>, oleh: string | null) {
  if (!bolehTulis(sc)) throw new CampaignError(403, "hanya HoD/admin yang bisa membuat kampanye");
  const v = validasiKampanye(body);
  const sql = db();
  const id = await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [row] = await t`
      INSERT INTO campaign (nama, deskripsi, tanggal_mulai, tanggal_selesai, satuan_qty, created_by, updated_by)
      VALUES (${v.nama}, ${v.deskripsi}, ${v.tanggal_mulai}, ${v.tanggal_selesai}, ${v.satuan_qty}, ${oleh}, ${oleh})
      RETURNING id`;
    await simpanIsi(t, Number(row.id), v, sc);
    return Number(row.id);
  });
  const [c] = await muatKampanye(sql, [id]);
  return c;
}

export async function ubahKampanye(sc: DataScope, idText: string, body: Record<string, unknown>, oleh: string | null) {
  if (!bolehTulis(sc)) throw new CampaignError(403, "hanya HoD/admin yang bisa mengubah kampanye");
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) throw new CampaignError(400, "id kampanye tidak sah");
  const sql = db();
  const [ada] = await sql`SELECT id FROM campaign WHERE id = ${id}`;
  if (!ada) throw new CampaignError(404, "kampanye tak ditemukan");

  // Batal / aktifkan lagi = PATCH { dibatalkan } saja.
  if (typeof body.dibatalkan === "boolean" && Object.keys(body).filter((k) => k !== "oleh").length === 1) {
    await sql`UPDATE campaign SET dibatalkan = ${body.dibatalkan}, updated_by = ${oleh}, updated_at = now() WHERE id = ${id}`;
  } else {
    const v = validasiKampanye(body);
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`
        UPDATE campaign SET nama = ${v.nama}, deskripsi = ${v.deskripsi}, tanggal_mulai = ${v.tanggal_mulai},
               tanggal_selesai = ${v.tanggal_selesai}, satuan_qty = ${v.satuan_qty},
               updated_by = ${oleh}, updated_at = now()
        WHERE id = ${id}`;
      await simpanIsi(t, id, v, sc);
    });
  }
  const [c] = await muatKampanye(sql, [id]);
  return c;
}

// ── WA #KAMPANYE (baca saja) ───────────────────────────────────────────────
// `#KAMPANYE` = kampanye berjalan + progres dalam scope pengirim (AM = dirinya,
// HoD = timnya, admin = semua). `#KAMPANYE KMP-0001` / `#KAMPANYE <nama>` =
// rincian satu kampanye. Pengirim → app_user (via am_id) → resolveScope, sama
// dgn #SALES; tanpa akun login: AM = dirinya, lainnya = semua.

const ikonPacing = (s: Pacing["status"]): string =>
  s === "di depan" ? "✅ di depan" : s === "sesuai" ? "🟡 sesuai" : s === "tertinggal" ? "🔴 tertinggal" : "";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tglPendek = (d: string): string => {
  const [, m, h] = d.split("-").map(Number);
  return `${h} ${BULAN[m - 1]}`;
};

export function rpWa(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2).replace(".", ",")} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${Math.round(v / 1e6).toLocaleString("id-ID")} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

const pctWa = (p: number | null): string => (p == null ? "—" : `${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const qtyWa = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });

/** Satu baris progres: "Rp 120 jt / Rp 500 jt (24%) · harapan 14% · ✅ di depan". */
export function barisProgres(target: number, netto: number, p: Pacing): string {
  if (target <= 0) return `${rpWa(netto)} (tanpa target)`;
  const ikon = ikonPacing(p.status);
  return `${rpWa(netto)} / ${rpWa(target)} (${pctWa(p.capai_pct)}) · harapan ${pctWa(p.harapan_pct)}${ikon ? ` · ${ikon}` : ""}`;
}

async function scopeDariPengirim(sender: { am_id: string; role: string | null }): Promise<DataScope> {
  const [au] = await db()`SELECT id FROM app_user WHERE am_id = ${sender.am_id}`;
  if (au) return resolveScope(String(au.id));
  const am = /^am$/i.test(String(sender.role ?? "").trim());
  return { ...FULL_SCOPE, amOnly: am, amId: sender.am_id };
}

const labelScope = (sc: DataScope, nama: string | null, amId: string): string =>
  sc.amOnly ? `Anda (${nama ?? amId})` : sc.cabangScope?.length ? `Tim ${sc.hodKey ?? "HoD"}` : "Semua AM";

export async function balasanKampanye(arg: string, sender: { am_id: string; nama: string | null; role: string | null }): Promise<string> {
  const sc = await scopeDariPengirim(sender);
  const sql = db();
  const q = arg.trim();
  if (!q) {
    const semua = await listKampanye(sc);
    const jalan = semua.filter((c) => c.status === "berjalan");
    if (!jalan.length) {
      const nanti = semua.filter((c) => c.status === "akan datang").slice(0, 3);
      return `📣 *Kampanye* · ${labelScope(sc, sender.nama, sender.am_id)}\nTidak ada kampanye yang sedang berjalan.` +
        (nanti.length ? `\nAkan datang: ${nanti.map((c) => `${c.kode} ${c.nama} (mulai ${tglPendek(c.tanggal_mulai)})`).join("; ")}` : "");
    }
    const baris = jalan.slice(0, 8).map((c, i) => {
      const r = c.ringkasan;
      return `${i + 1}. *${c.kode}* ${c.nama} — hari ${r.pacing.hari_ke}/${r.pacing.hari_total}\n   ${barisProgres(r.target_rp, r.netto, r.pacing)}`;
    });
    return `📣 *Kampanye berjalan* · ${labelScope(sc, sender.nama, sender.am_id)}\n${baris.join("\n")}\n\nRincian: #KAMPANYE ${jalan[0].kode}`;
  }

  const kode = q.match(/^kmp[-\s]?0*(\d{1,6})$/i);
  let ids: number[];
  if (kode) {
    ids = (await sql`SELECT id FROM campaign WHERE kode = ${`KMP-${kode[1].padStart(4, "0")}`}`).map((r) => Number(r.id));
  } else {
    const pola = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    ids = (await sql`SELECT id FROM campaign WHERE nama ILIKE ${pola} AND NOT dibatalkan ORDER BY tanggal_selesai DESC LIMIT 5`).map((r) => Number(r.id));
  }
  if (!ids.length) return `⚠️ Kampanye "${q}" tidak ditemukan. Kirim #KAMPANYE saja untuk daftar kampanye berjalan.`;
  if (ids.length > 1) {
    const daftar = await muatKampanye(sql, ids);
    return `Ada ${daftar.length} kampanye yang cocok — sebutkan kodenya:\n${daftar.map((c) => `• ${c.kode} ${c.nama} (${c.status})`).join("\n")}`;
  }
  const d = await detailKampanye(sc, String(ids[0]));
  const c = d.kampanye;
  const r = d.ringkasan;
  const head = `📣 *${c.kode} ${c.nama}* (${tglPendek(c.tanggal_mulai)}–${tglPendek(c.tanggal_selesai)} · ${c.status === "berjalan" ? `hari ${r.pacing.hari_ke}/${r.pacing.hari_total}` : c.status})`;
  const lingkup = [c.brands.length ? `Brand: ${c.brands.join(", ")}` : null, c.items.length ? `+ ${c.items.length} item pilihan` : null].filter(Boolean).join(" ");
  const out = [head, `${labelScope(sc, sender.nama, sender.am_id)} · ${lingkup}`, `Faktur non-KSO: ${barisProgres(r.target_rp, r.netto, r.pacing)}`];
  if (c.satuan_qty) out.push(`Qty: ${qtyWa(r.qty)}${r.target_qty != null ? ` / ${qtyWa(r.target_qty)}` : ""} ${c.satuan_qty}`);
  out.push(`SO non-KSO: ${rpWa(r.so_netto)} (${r.so} SO)`);
  if (r.tahun_lalu != null) out.push(`Periode sama tahun lalu: ${rpWa(r.tahun_lalu)}`);
  const f = d.corong;
  out.push(`Corong: Lead ${f.lead} → Deal ${f.deal} (menang ${f.deal_menang}) · Aktivitas ${f.aktivitas} · Demo/Trial ${f.demo_trial} (positif ${f.demo_positif})`);
  if (!sc.amOnly) {
    const am = d.per_am.filter((a) => a.target_rp > 0 || a.netto > 0).slice(0, 12);
    if (am.length) out.push("", "*Per AM:*", ...am.map((a) => `• ${a.nama}: ${barisProgres(a.target_rp, a.netto, a.pacing)}`));
  }
  return out.join("\n");
}
