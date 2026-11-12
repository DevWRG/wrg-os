// "Sales Area Performance": infografis web /sales-analytics/area (kartu YTD /
// bulan / minggu / hari per region + tabel per sales) dan ringkasan WA singkat
// yang menautkan ke halaman itu — tanpa lampiran PDF/gambar (keputusan user
// 11 Nov 2026). Angka = kartu Sales Performance (reportSalesPerformance).
//
// Penerima = grup (Koord HoD), bukan DM. Kirim lewat job `sales-area-ringkasan`
// (saklar SALES_AREA_RINGKASAN_ENABLED, default mati) atau manual lewat
// POST /sales/performance/ringkasan (service token, default pratinjau).
// Hanya omzet (netto tanpa PPN) — tak ada margin/HPP di pesan ini.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { cabangRegionMap, reportSalesPerformance } from "./sales.js";
import { cabangEffSql, isOfficeSql, joinAmFromSalesman } from "./salesman-am.js";

type Performa = Awaited<ReturnType<typeof reportSalesPerformance>>;
type Periode = Performa["periods"][number];

const koma = (n: number, d: number) => n.toFixed(d).replace(".", ",");

/** Rupiah ringkas: ≥ 1 M → "Rp 39,96 M", ≥ 1 jt → "Rp 171,3 jt", selebihnya penuh. */
export function rpRingkas(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${koma(n / 1e9, 2)} M`;
  if (Math.abs(n) >= 1e6) return `Rp ${koma(n / 1e6, 1)} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

const persen = (v: number | null) => (v == null ? "target belum diisi" : `${koma(v, 1)}%`);

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const tgl = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
export function labelTanggal(iso: string): string {
  const { y, m, d } = tgl(iso);
  return `${HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${BULAN[m - 1]} ${y}`;
}
/** Teks WA singkat + link infografis. Murni — angka dari reportSalesPerformance. */
export function formatRingkasanSalesArea(perf: Performa, link: string | null): string {
  const p = (k: Periode["key"]) => perf.periods.find((x) => x.key === k);
  const pctTeks = (x: Periode | undefined) => (x ? persen(x.pct.total) : "-");
  const hari = p("day");
  const out = [
    `*Sales Area Performance* · ${labelTanggal(perf.as_of)}`,
    `Capaian target: YTD ${pctTeks(p("year"))} · Bulan ${pctTeks(p("month"))} · Minggu ${pctTeks(p("week"))} · Hari ini ${pctTeks(hari)}`,
  ];
  if (hari) {
    const reg = Object.fromEntries(hari.regions.map((r) => [r.region, r.total])) as Record<string, number>;
    out.push(`Hari ini ${rpRingkas(hari.total)} (East ${rpRingkas(reg.East ?? 0)} · West ${rpRingkas(reg.West ?? 0)})`);
  }
  if (link) out.push("", `Infografis lengkap: ${link}`);
  return out.join("\n");
}

// ── Tabel per sales (infografis) ─────────────────────────────────

export interface BarisSales {
  nama: string;
  region: "East" | "West" | "OFFICE";
  cabang: string | null;
  hari: { kso: number; regular: number; lain: number; total: number };
  ytd: number;
  /** Target tahunan per AM (sales_target_am); null bila belum diisi / bukan AM. */
  target: number | null;
  pct_ytd: number | null;
}

/**
 * Per pemilik faktur: AM AKTIF per orang; OFFICE satu baris. Faktur tanpa AM
 * aktif (AM kosong ATAU sudah nonaktif/resign): bila AREA-nya tak punya AM aktif
 * (cabang SEKARANG AM aktif) → "VACANT · <cabang>" dengan target cabang
 * (sales_target_cabang) — keputusan user 11 Nov 2026; bila areanya ada AM aktif
 * atau area tak diketahui → satu baris "VACANT · lainnya" tanpa target (target
 * cabang itu sudah milik AM-nya, jangan dihitung dua kali). YTD s/d as-of + hari as-of dipecah
 * kategori pengadaan baris faktur (charField1: KSO / REGULAR / lainnya), faktur
 * campur dialokasikan proporsional nilai baris — sama dengan tab Per-Pengadaan.
 */
export async function perSalesArea(asOf: string): Promise<BarisSales[]> {
  const sql = db();
  const awal = `${asOf.slice(0, 4)}-01-01`;
  const regionMap = await cabangRegionMap(sql);
  const rows = await sql`
    WITH inv0 AS MATERIALIZED (
      SELECT ai.id, ai.tanggal, ai.raw, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS netto,
             ${isOfficeSql(sql)} AS kantor,
             CASE WHEN NULLIF(mu.am_id,'') IS NOT NULL AND mu.aktif THEN mu.am_id END AS am_aktif,
             COALESCE(NULLIF(mu.nama,''), mu.am_id) AS nama_am, NULLIF(mu.cabang,'') AS cabang_am,
             ${cabangEffSql(sql)} AS cabang_eff
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${awal} AND ${asOf}
    ),
    area_aktif AS (  -- cabang SEKARANG tiap AM aktif yang punya faktur tahun ini
      SELECT DISTINCT NULLIF(m.cabang,'') AS cabang FROM master_user m
      WHERE m.am_id IN (SELECT am_aktif FROM inv0 WHERE am_aktif IS NOT NULL) AND NULLIF(m.cabang,'') IS NOT NULL
    ),
    inv1 AS (
      SELECT inv0.*, (cabang_eff IS NOT NULL AND cabang_eff NOT IN (SELECT cabang FROM area_aktif)) AS area_kosong
      FROM inv0
    ),
    inv AS (
      SELECT id, tanggal, raw, netto,
             CASE WHEN kantor THEN 'office' WHEN am_aktif IS NOT NULL THEN am_aktif
                  WHEN area_kosong THEN 'vacant:' || cabang_eff ELSE 'vacant-lain' END AS kunci,
             CASE WHEN kantor THEN 'OFFICE' WHEN am_aktif IS NOT NULL THEN nama_am
                  WHEN area_kosong THEN 'VACANT · ' || cabang_eff ELSE 'VACANT · lainnya' END AS nama,
             CASE WHEN NOT kantor THEN am_aktif END AS am_id,
             CASE WHEN kantor THEN NULL WHEN am_aktif IS NOT NULL THEN cabang_am
                  WHEN area_kosong THEN cabang_eff END AS cabang
      FROM inv1
    ),
    cat AS (
      SELECT inv.id, inv.kunci, inv.netto, COALESCE(NULLIF(d.val->>'charField1',''),'') AS kat,
             COALESCE(sum(GREATEST((d.val->>'totalPrice')::numeric, 0)), 0)::float8 AS w
      FROM inv
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inv.raw->'detailItem','[]'::jsonb)) AS d(val) ON true
      WHERE inv.tanggal = ${asOf}
      GROUP BY 1, 2, 3, 4
    ),
    sh AS (
      SELECT kunci, kat,
             CASE WHEN sum(w) OVER (PARTITION BY id) > 0 THEN netto * w / sum(w) OVER (PARTITION BY id)
                  ELSE netto / count(*) OVER (PARTITION BY id) END AS porsi
      FROM cat
    ),
    hari AS (
      SELECT kunci,
             sum(porsi) FILTER (WHERE kat ILIKE 'KSO%') AS kso,
             sum(porsi) FILTER (WHERE kat ILIKE 'REG%') AS regular,
             sum(porsi) FILTER (WHERE kat NOT ILIKE 'KSO%' AND kat NOT ILIKE 'REG%') AS lain,
             sum(porsi) AS total
      FROM sh GROUP BY kunci
    ),
    ytd AS (
      SELECT kunci, max(nama) AS nama, max(am_id) AS am_id, sum(netto) AS ytd,
             (array_agg(cabang ORDER BY tanggal DESC) FILTER (WHERE cabang IS NOT NULL))[1] AS cabang
      FROM inv GROUP BY kunci
    )
    SELECT y.nama, y.cabang, y.ytd::float8 AS ytd,
           (CASE WHEN y.kunci LIKE 'vacant:%' THEN stc.target ELSE sta.target END)::float8 AS target,
           COALESCE(h.kso,0)::float8 AS kso, COALESCE(h.regular,0)::float8 AS regular,
           COALESCE(h.lain,0)::float8 AS lain, COALESCE(h.total,0)::float8 AS total
    FROM ytd y
    LEFT JOIN hari h USING (kunci)
    LEFT JOIN sales_target_am sta ON sta.am_id = y.am_id AND sta.year = ${Number(asOf.slice(0, 4))}
    LEFT JOIN sales_target_cabang stc ON stc.cabang = y.cabang AND stc.year = ${Number(asOf.slice(0, 4))}
    ORDER BY COALESCE(h.total,0) DESC, y.ytd DESC`;
  return rows.map((r) => {
    const cabang = r.cabang ? String(r.cabang) : null;
    const ytd = Number(r.ytd ?? 0);
    const target = r.target != null && Number(r.target) > 0 ? Number(r.target) : null;
    return {
      nama: String(r.nama ?? "-"),
      region: (cabang && regionMap[cabang]) || "OFFICE",
      cabang,
      hari: { kso: Number(r.kso), regular: Number(r.regular), lain: Number(r.lain), total: Number(r.total) },
      ytd,
      target,
      pct_ytd: target ? Math.round((ytd / target) * 1000) / 10 : null,
    };
  });
}

export async function infografisSalesArea(asOf?: string) {
  const performance = await reportSalesPerformance(asOf);
  const per_sales = await perSalesArea(performance.as_of);
  return { performance, per_sales, generated_at: new Date().toISOString() };
}

export interface HasilRingkasan {
  as_of: string;
  preview: string;
  wa: { target: string | null; sent: boolean; error?: string; skipped?: string };
}

/**
 * Susun (dan kirim) ringkasan. `dryRun` = pratinjau saja. `paksa` mengabaikan
 * anti-dobel (sekali per hari per target, notif_state) — untuk uji manual.
 */
export async function runRingkasanSalesArea(opts: { dryRun?: boolean; target?: string; asOf?: string; paksa?: boolean } = {}): Promise<HasilRingkasan> {
  const perf = await reportSalesPerformance(opts.asOf);
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const preview = formatRingkasanSalesArea(perf, base ? `${base}/sales-analytics/area?tanggal=${perf.as_of}` : null);
  const target = opts.target?.trim() || process.env.SALES_AREA_RINGKASAN_TARGET?.trim() || null;
  if (opts.dryRun) return { as_of: perf.as_of, preview, wa: { target, sent: false, skipped: "dry-run" } };
  if (!target) return { as_of: perf.as_of, preview, wa: { target: null, sent: false, error: "SALES_AREA_RINGKASAN_TARGET belum diisi" } };

  const sql = db();
  const key = `sales-area-ringkasan:${target}`;
  if (!opts.paksa) {
    const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${key}`;
    if (prev && String(prev.signature) === perf.as_of) return { as_of: perf.as_of, preview, wa: { target, sent: false, skipped: "sudah terkirim hari ini" } };
  }
  const r = await sendViaWaGateway(target, preview);
  if (r.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${perf.as_of}, 1, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${perf.as_of}, count = 1, sent_at = now()
    `;
  }
  return { as_of: perf.as_of, preview, wa: { target, sent: r.sent, error: r.error } };
}
