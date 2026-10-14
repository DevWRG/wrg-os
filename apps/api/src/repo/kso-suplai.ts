// F7 KSO Lifecycle — kontrol suplai reagen + perkiraan kebutuhan vs stok.
//
// SUMBER = DELIVERY ORDER (Surat Jalan) Accurate, BUKAN faktur. Faskes PER_TEST tidak
// membeli reagen — mereka ditagih per tes ("PEMERIKSAAN…") dan reagennya DIKIRIM WRG,
// jadi suplai mereka hanya terlihat di DO. DO juga mencatat kiriman BELI_REAGEN, jadi
// satu sumber berlaku untuk dua skema. Cermin DO baru ada sejak April 2026
// (accurate_delivery_order, sinkron F12) — jendela rata-rata dipotong ke tanggal itu.
// Satuan baris DO = satuan dasar item (prod 15 Okt: 6.845/6.845 baris reagen), jadi
// qty DO bisa langsung dibandingkan dengan stok accurate_item.quantity.
//
// Bagian 1 — KONTROL ORDER per faskes × jenis alat terpasang (alat operasional):
//   kiriman reagen berjenis sama (kso_item_jenis_v; label gabungan "3Diff & 5Diff"
//   dipecah ke anggotanya) dikelompokkan jadi GELOMBANG (kiriman ≤7 hari dari kiriman
//   sebelumnya = satu pesanan yang dikirim bertahap). Ritme = median jeda antar-awal
//   gelombang di dalam jendela. Status:
//     TANPA_KIRIMAN : tak ada kiriman jenis itu sejak data DO ada
//     TELAT         : hari sejak kiriman terakhir > batas; batas = maks(1,5×ritme,
//                     ritme+14) bila ritme terbaca, 60 hari bila belum (≤1 gelombang)
//     RUTIN         : selain itu
//   prod 15 Okt (jendela Jul–Sep): 256 rutin · 67 telat · 99 tanpa kiriman dari 422.
//
// Bagian 2 — KEBUTUHAN vs STOK per item reagen yang dikirim ke faskes KSO di jendela:
//   kebutuhan/bln dihitung dari SEMUA customer (stok gudang melayani semua; item yang
//   kritis rata-rata 4× kebutuhan KSO-nya), kebutuhan KSO ditampilkan berdampingan.
//   KRITIS = stok < 1 bln kebutuhan · PERLU_PO = stok + sisa PO terbuka < 2 bln ·
//   STOK_0 = stok ≤0 padahal rutin dikirim (stok tak tercatat di Accurate — kirim
//   langsung principal/konsinyasi?), sengaja dipisah dari KRITIS supaya tak menenggelamkan
//   kekurangan nyata · AMAN.
//
// Scope bagian 1 sama dengan F73 (AM = faskes miliknya, HoD = cabang/wilayah, admin =
// semua). Bagian 2 = angka agregat perusahaan tanpa nama faskes → tidak di-scope.

import { db } from "../db.js";
import { scopeOnClause, FULL_SCOPE, type DataScope } from "./access-scope.js";
import { sendViaWaGateway } from "../wasend.js";
import { waHod } from "./hod-wa.js";
import { bulanTutup } from "./kso-kesehatan.js";

export type StatusOrder = "TELAT" | "TANPA_KIRIMAN" | "RUTIN";
export type StatusStok = "KRITIS" | "PERLU_PO" | "STOK_0" | "AMAN";

export const ATURAN = {
  gelombang_hari: 7,        // kiriman ≤7 hari dari kiriman sebelumnya = satu gelombang
  telat_kali_ritme: 1.5,
  telat_min_tambah: 14,     // batas minimal ritme + 14 hari (ritme pendek tak langsung telat)
  telat_tanpa_ritme: 60,    // ≤1 gelombang di jendela → batas 60 hari
  cakupan_po_bulan: 2,      // stok + PO terbuka < 2 bulan kebutuhan → perlu PO
  bulan_default: 3,
  bulan_maks: 12,
} as const;

// ── Murni ────────────────────────────────────────────────────────────────

const hariAntara = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const tambahHari = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Tanggal kiriman (YYYY-MM-DD, boleh tak urut/ganda) → tanggal awal tiap gelombang. */
export function gelombang(tgl: string[], jarak: number = ATURAN.gelombang_hari): string[] {
  const urut = [...new Set(tgl)].sort();
  const awal: string[] = [];
  let prev: string | null = null;
  for (const t of urut) {
    if (prev === null || hariAntara(prev, t) > jarak) awal.push(t);
    prev = t;
  }
  return awal;
}

/** Median jeda (hari) antar-awal gelombang; null bila < 2 gelombang. */
export function ritmeHari(awalGelombang: string[]): number | null {
  if (awalGelombang.length < 2) return null;
  const jeda = awalGelombang.slice(1).map((t, i) => hariAntara(awalGelombang[i], t)).sort((a, b) => a - b);
  const n = jeda.length;
  return n % 2 ? jeda[(n - 1) / 2] : (jeda[n / 2 - 1] + jeda[n / 2]) / 2;
}

export interface NilaiOrder {
  status: StatusOrder;
  ritme_hari: number | null;
  batas_hari: number | null;
  lewat_hari: number | null;
  perkiraan_order: string | null;   // terakhir + ritme
  telat_sejak: string | null;       // terakhir + batas (tanggal status jadi TELAT)
}

/**
 * terakhir = kiriman terakhir jenis itu (seluruh data DO); gelombangJendela = awal
 * gelombang yang jatuh di dalam jendela (penentu ritme, ikut filter periode).
 */
export function nilaiOrder(terakhir: string | null, gelombangJendela: string[], hariIni: string): NilaiOrder {
  if (!terakhir) return { status: "TANPA_KIRIMAN", ritme_hari: null, batas_hari: null, lewat_hari: null, perkiraan_order: null, telat_sejak: null };
  const ritme = ritmeHari(gelombangJendela);
  const batas = ritme == null ? ATURAN.telat_tanpa_ritme : Math.round(Math.max(ritme * ATURAN.telat_kali_ritme, ritme + ATURAN.telat_min_tambah));
  const lewat = hariAntara(terakhir, hariIni);
  return {
    status: lewat > batas ? "TELAT" : "RUTIN",
    ritme_hari: ritme == null ? null : Math.round(ritme),
    batas_hari: batas,
    lewat_hari: lewat,
    perkiraan_order: ritme == null ? null : tambahHari(terakhir, Math.round(ritme)),
    telat_sejak: tambahHari(terakhir, batas + 1),
  };
}

export interface NilaiStok { status: StatusStok; cukup_bulan: number | null; saran_po: number }

/** Kebutuhan/bln (semua customer) vs stok & sisa PO terbuka. */
export function nilaiStok(kebutuhanBln: number, stok: number, poSisa: number): NilaiStok {
  if (kebutuhanBln <= 0) return { status: "AMAN", cukup_bulan: null, saran_po: 0 };
  const cukup = stok / kebutuhanBln;
  const target = ATURAN.cakupan_po_bulan * kebutuhanBln;
  const saran = Math.max(0, Math.ceil(target - Math.max(stok, 0) - poSisa));
  if (stok <= 0) return { status: "STOK_0", cukup_bulan: 0, saran_po: saran };
  if (stok < kebutuhanBln) return { status: "KRITIS", cukup_bulan: cukup, saran_po: saran };
  if (stok + poSisa < target) return { status: "PERLU_PO", cukup_bulan: cukup, saran_po: saran };
  return { status: "AMAN", cukup_bulan: cukup, saran_po: 0 };
}

/** Jendela rata-rata: N bulan tutup sebelum bulan berjalan, dipotong ke awal data DO. */
export function jendela(hariIni: string, bulan: number, dataSejak: string | null) {
  const n = Math.min(Math.max(Math.trunc(bulan) || ATURAN.bulan_default, 1), ATURAN.bulan_maks);
  const sampai = bulanTutup(hariIni, 0);                // eksklusif
  let dari = bulanTutup(hariIni, n);
  const awalData = dataSejak ? `${dataSejak.slice(0, 7)}-01` : null;
  const terpotong = Boolean(awalData && awalData > dari);
  if (terpotong && awalData) dari = awalData;
  const [dy, dm] = dari.split("-").map(Number);
  const [sy, sm] = sampai.split("-").map(Number);
  const efektif = Math.max((sy - dy) * 12 + (sm - dm), 1);
  return { bulan: n, dari, sampai, bulan_efektif: efektif, terpotong };
}

// ── Kueri ────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;
const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const iso = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export interface BarisOrder extends NilaiOrder {
  account_id: string;
  nama: string;
  cabang: string | null;
  pemilik: string | null;
  jenis: string;
  alat: number;
  skema: string[];
  terakhir: string | null;
  gelombang_jendela: number;
  qty_jendela: number;
}

export interface BarisItem extends NilaiStok {
  item_no: string;
  nama: string;
  jenis: string;
  unit: string | null;
  kebutuhan_kso_bln: number;
  kebutuhan_total_bln: number;
  faskes_kso: number;
  stok: number;
  po_sisa: number;
}

// Satu sumber baris DO reagen (jenis mesin, gabungan dipecah) — dipakai dua bagian.
const doReagen = (sql: Sql) => sql`
  SELECT o.customer_id AS account_id, o.trans_date AS tgl, it.id AS item_id, it.no AS item_no,
         i.qty, COALESCE(g.jenis_anggota, j.jenis) AS jenis
  FROM accurate_delivery_order o
  JOIN accurate_delivery_order_item i ON i.delivery_id = o.id
  JOIN accurate_item it ON it.no = i.item_no
  JOIN kso_item_jenis_v j ON j.item_id = it.id
  LEFT JOIN kso_jenis_gabungan g ON g.jenis_gabungan = j.jenis
  WHERE j.jenis !~* '^(UMUM|MANUAL)' AND o.customer_id IS NOT NULL AND o.trans_date IS NOT NULL`;

async function barisOrder(sql: Sql, sc: DataScope, hariIni: string, j: ReturnType<typeof jendela>, akun: number[] | null): Promise<BarisOrder[]> {
  const rows = await sql`
    WITH pas AS (
      SELECT a.account_id, kso_jenis_kanonik(a.type_alat) AS jenis, count(*)::int AS alat,
             array_agg(DISTINCT a.skema) AS skema
      FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
        AND kso_jenis_kanonik(a.type_alat) IS NOT NULL
        ${akun ? sql`AND a.account_id = ANY(${akun}::bigint[])` : sql``}
      GROUP BY 1, 2
    ),
    dl AS (${doReagen(sql)}),
    kir AS (
      SELECT p.account_id, p.jenis,
             array_agg(DISTINCT d.tgl::text) AS tgl,
             COALESCE(sum(d.qty) FILTER (WHERE d.tgl >= ${j.dari}::date AND d.tgl < ${j.sampai}::date), 0)::float8 AS qty
      FROM pas p JOIN dl d ON d.account_id = p.account_id AND d.jenis = p.jenis
      WHERE d.tgl <= ${hariIni}::date
      GROUP BY 1, 2
    )
    SELECT p.account_id::text, p.jenis, p.alat, p.skema,
           COALESCE(NULLIF(ac.name, ''), 'Customer #' || p.account_id::text) AS nama,
           upper(btrim(COALESCE(NULLIF(omu.cabang, ''), NULLIF(area_customer(p.account_id), '')))) AS cabang,
           COALESCE(NULLIF(omu.nama, ''), oa.owner_am_id) AS pemilik,
           COALESCE(k.tgl, '{}') AS tgl, COALESCE(k.qty, 0) AS qty
    FROM pas p
    JOIN accurate_customer ac ON ac.id = p.account_id
    LEFT JOIN crm_account oa ON oa.account_id = p.account_id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    LEFT JOIN kir k ON k.account_id = p.account_id AND k.jenis = p.jenis
    WHERE true ${scopeOnClause(sql, sc, sql`oa.owner_am_id`, sql`COALESCE(NULLIF(omu.cabang, ''), area_customer(p.account_id))`)}`;
  return rows.map((r) => {
    const tgl = ((r.tgl as string[]) ?? []).map(iso).sort();
    const terakhir = tgl.length ? tgl[tgl.length - 1] : null;
    const gj = gelombang(tgl).filter((t) => t >= j.dari);
    return {
      account_id: String(r.account_id), nama: String(r.nama), cabang: r.cabang ? String(r.cabang) : null,
      pemilik: r.pemilik ? String(r.pemilik) : null, jenis: String(r.jenis), alat: Number(r.alat),
      skema: (r.skema as string[]) ?? [], terakhir, gelombang_jendela: gj.length, qty_jendela: Number(r.qty) || 0,
      ...nilaiOrder(terakhir, gj, hariIni),
    };
  });
}

async function barisItem(sql: Sql, j: ReturnType<typeof jendela>): Promise<BarisItem[]> {
  const rows = await sql`
    WITH kso AS (
      SELECT DISTINCT a.account_id FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
    ),
    dl AS (${doReagen(sql)}),
    agg AS (
      SELECT d.item_id, d.item_no, min(d.jenis) AS jenis,
             COALESCE(sum(d.qty) FILTER (WHERE d.account_id IN (SELECT account_id FROM kso)), 0)::float8 AS qty_kso,
             sum(d.qty)::float8 AS qty_total,
             count(DISTINCT d.account_id) FILTER (WHERE d.account_id IN (SELECT account_id FROM kso))::int AS faskes_kso
      FROM dl d
      WHERE d.tgl >= ${j.dari}::date AND d.tgl < ${j.sampai}::date
      GROUP BY 1, 2
      HAVING sum(d.qty) FILTER (WHERE d.account_id IN (SELECT account_id FROM kso)) > 0
    ),
    po AS (
      SELECT i.item_no, sum(GREATEST(i.qty_ordered - COALESCE(i.qty_shipped, 0), 0))::float8 AS sisa
      FROM purchase_order_item i JOIN purchase_order p ON p.id = i.purchase_order_id
      WHERE p.cancelled_at IS NULL AND p.accurate_status IN ('Menunggu diproses', 'Sebagian diproses')
      GROUP BY 1
    )
    SELECT a.item_no, it.name, a.jenis, it.unit, a.qty_kso, a.qty_total, a.faskes_kso,
           COALESCE(it.quantity, 0)::float8 AS stok, COALESCE(po.sisa, 0) AS po_sisa
    FROM agg a JOIN accurate_item it ON it.id = a.item_id
    LEFT JOIN po ON po.item_no = a.item_no`;
  const n = j.bulan_efektif;
  return rows.map((r) => {
    const kso = Number(r.qty_kso) / n;
    const total = Number(r.qty_total) / n;
    const stok = Number(r.stok) || 0;
    const po = Number(r.po_sisa) || 0;
    return {
      item_no: String(r.item_no), nama: String(r.name ?? r.item_no), jenis: String(r.jenis), unit: r.unit ? String(r.unit) : null,
      kebutuhan_kso_bln: kso, kebutuhan_total_bln: total, faskes_kso: Number(r.faskes_kso), stok, po_sisa: po,
      ...nilaiStok(total, stok, po),
    };
  });
}

const URUT_ORDER: Record<StatusOrder, number> = { TELAT: 0, TANPA_KIRIMAN: 1, RUTIN: 2 };
const URUT_STOK: Record<StatusStok, number> = { KRITIS: 0, PERLU_PO: 1, STOK_0: 2, AMAN: 3 };

export async function suplaiKso(sc: DataScope = FULL_SCOPE, bulan: number = ATURAN.bulan_default) {
  const sql = db();
  const hari = hariIniWib();
  const [d] = await sql`SELECT min(trans_date)::text AS sejak, max(trans_date)::text AS sampai FROM accurate_delivery_order`;
  const [s] = await sql`SELECT max(stock_synced_at) AS stok_per FROM accurate_item`;
  const j = jendela(hari, bulan, d?.sejak ?? null);
  const [order, item] = await Promise.all([barisOrder(sql, sc, hari, j, null), barisItem(sql, j)]);
  order.sort((a, b) => URUT_ORDER[a.status] - URUT_ORDER[b.status] || (b.lewat_hari ?? 0) - (a.lewat_hari ?? 0) || a.nama.localeCompare(b.nama));
  item.sort((a, b) => URUT_STOK[a.status] - URUT_STOK[b.status] || b.kebutuhan_total_bln - a.kebutuhan_total_bln);
  return {
    hari_ini: hari,
    jendela: j,
    data_do: { sejak: d?.sejak ?? null, sampai: d?.sampai ?? null },
    stok_per: s?.stok_per ? new Date(s.stok_per as string).toISOString() : null,
    aturan: ATURAN,
    ringkas: {
      order: { total: order.length, telat: order.filter((o) => o.status === "TELAT").length,
               tanpa_kiriman: order.filter((o) => o.status === "TANPA_KIRIMAN").length,
               rutin: order.filter((o) => o.status === "RUTIN").length,
               faskes: new Set(order.map((o) => o.account_id)).size },
      item: { total: item.length, kritis: item.filter((i) => i.status === "KRITIS").length,
              perlu_po: item.filter((i) => i.status === "PERLU_PO").length,
              stok_0: item.filter((i) => i.status === "STOK_0").length,
              aman: item.filter((i) => i.status === "AMAN").length },
    },
    order,
    item,
  };
}

// ── Rekap mingguan (saklar KSO_SUPLAI_REKAP_ENABLED, default mati) ──────────

/** Murni: pasangan yang BARU masuk TELAT dalam 7 hari terakhir (tanpa snapshot). */
export function baruTelat(order: Pick<BarisOrder, "status" | "telat_sejak">[], hariIni: string) {
  const awal = tambahHari(hariIni, -7);
  return order.filter((o) => o.status === "TELAT" && o.telat_sejak != null && o.telat_sejak > awal && o.telat_sejak <= hariIni);
}

export function pesanRekapOrder(nama: string, list: Pick<BarisOrder, "nama" | "jenis" | "terakhir" | "ritme_hari">[]): string {
  const baris = list.slice(0, 15).map((o) =>
    `🟠 ${o.nama} — ${o.jenis}: kiriman terakhir ${o.terakhir ?? "—"}${o.ritme_hari ? ` (biasanya tiap ±${o.ritme_hari} hari)` : ""}`);
  return [`📦 *Suplai reagen KSO — tim ${nama}*`, `${list.length} faskes × jenis alat baru telat order minggu ini:`, ...baris,
    list.length > 15 ? `… dan ${list.length - 15} lainnya — lihat Produktivitas KSO → tab Suplai Reagen.` : "Rincian: Produktivitas KSO → tab Suplai Reagen."].join("\n");
}

export function pesanRekapStok(nama: string, list: Pick<BarisItem, "item_no" | "nama" | "status" | "stok" | "kebutuhan_total_bln" | "po_sisa" | "saran_po" | "unit">[]): string {
  const f = (n: number) => Math.round(n).toLocaleString("id-ID");
  const baris = list.slice(0, 20).map((i) =>
    `${i.status === "KRITIS" ? "🔴" : "🟡"} ${i.nama} (${i.item_no}): stok ${f(i.stok)} · butuh ±${f(i.kebutuhan_total_bln)}/bln${i.po_sisa > 0 ? ` · PO jalan ${f(i.po_sisa)}` : ""} · saran PO ${f(i.saran_po)} ${i.unit ?? ""}`.trim());
  return [`📦 *Stok reagen KSO — untuk ${nama}*`, `${list.length} item stoknya kurang dari ${ATURAN.cakupan_po_bulan} bulan kebutuhan:`, ...baris,
    list.length > 20 ? `… dan ${list.length - 20} lainnya — lihat Produktivitas KSO → tab Suplai Reagen.` : "Rincian: Produktivitas KSO → tab Suplai Reagen."].join("\n");
}

/**
 * Rekap Senin: (1) per HoD — faskes × jenis alat yang BARU telat order minggu ini
 * (cabang → hod_territory → waHod); (2) ringkasan item KRITIS/PERLU_PO ke HoD
 * penanggung jawab stok (env KSO_SUPLAI_PO_HOD = hod_key; kosong = dilewati —
 * sengaja tak ditulis di kode, lihat master_hod). dryRun = tanpa kirim.
 */
export async function runRekapSuplaiKso(opts: { dryRun?: boolean } = {}) {
  const sql = db();
  const data = await suplaiKso(FULL_SCOPE, ATURAN.bulan_default);
  const baru = baruTelat(data.order, data.hari_ini) as BarisOrder[];
  const kirim: { ke: string; jenis: "order" | "stok"; jumlah: number; terkirim: boolean }[] = [];
  const lewati: string[] = [];

  const perHod = new Map<string, BarisOrder[]>();
  for (const o of baru) {
    if (!o.cabang) { lewati.push(`${o.nama}: tanpa cabang`); continue; }
    const h = await sql`SELECT DISTINCT hod_key FROM hod_territory WHERE upper(btrim(cabang)) = ${o.cabang}`;
    if (h.length !== 1) { lewati.push(`cabang ${o.cabang}: HoD ${h.length ? "ganda" : "tak terpetakan"}`); continue; }
    const k = String(h[0].hod_key);
    perHod.set(k, [...(perHod.get(k) ?? []), o]);
  }
  for (const [hodKey, list] of perHod) {
    const u = await waHod(hodKey);
    if (!u) { lewati.push(`HoD ${hodKey}: nomor WA tak ditemukan`); continue; }
    if (opts.dryRun) { kirim.push({ ke: hodKey, jenis: "order", jumlah: list.length, terkirim: false }); continue; }
    const gw = await sendViaWaGateway(u.wa, pesanRekapOrder(u.nama, list));
    kirim.push({ ke: hodKey, jenis: "order", jumlah: list.length, terkirim: Boolean(gw.sent && !gw.stub && !gw.dryRun) });
  }

  const kurang = data.item.filter((i) => i.status === "KRITIS" || i.status === "PERLU_PO");
  const poHod = (process.env.KSO_SUPLAI_PO_HOD ?? "").trim();
  if (kurang.length && !poHod) lewati.push("rekap stok: KSO_SUPLAI_PO_HOD belum diatur");
  if (kurang.length && poHod) {
    const u = await waHod(poHod);
    if (!u) lewati.push(`rekap stok: nomor WA HoD ${poHod} tak ditemukan`);
    else if (opts.dryRun) kirim.push({ ke: poHod, jenis: "stok", jumlah: kurang.length, terkirim: false });
    else {
      const gw = await sendViaWaGateway(u.wa, pesanRekapStok(u.nama, kurang));
      kirim.push({ ke: poHod, jenis: "stok", jumlah: kurang.length, terkirim: Boolean(gw.sent && !gw.stub && !gw.dryRun) });
    }
  }
  return { hari_ini: data.hari_ini, baru_telat: baru.length, item_kurang: kurang.length, kirim, lewati, dry_run: Boolean(opts.dryRun) };
}

