// F21 — Daily SO Target per Region, versi PACING BULAN BERJALAN.
//
// Kartu aslinya: "SO hari ini per region + alert region <50% target jam 14:00".
// Diubah atas keputusan user (11 Okt 2026) setelah simulasi data prod:
//   - SO Accurate cuma ±60% dari faktur (banyak penjualan tanpa SO) dan item SO
//     baru tersinkron mulai ±10:00 → "SO hari ini" merah 17–18 dari 20 hari.
//   - Basis jadi PACING: capaian sejak tgl 1 (faktur netto + SO terbuka) vs
//     target bulan diprorata HARI KERJA. Satu hari sepi tak membuat merah; yang
//     dijawab: "apakah bulan ini akan tercapai".
//   - Target = sales_region_target (menu Sales Targets) — sama dengan kartu
//     Sales Performance; BUKAN target WatchPoint (Rp 2,5 M/bln) yang jauh lebih
//     rendah. Dua target ini berbeda dan belum didamaikan.
//
// Region: faktur lewat periodAgg (repo/sales.ts) — fungsi yang SAMA dengan kartu
// Sales Performance, jadi angka faktur di sini identik. SO dibentuk menjadi
// baris "mirip faktur" (alias ai/acs) supaya joinAmFromSalesman + cabangEffSql
// dipakai apa adanya: cabang AM pada tanggal SO (migrasi 193), fallback lokasi
// customer (194). Salesman SO diambil dari item (raw->>'salesman1Id') karena
// header mirror SO tak membawa salesman sama sekali (raw header cuma {id}).

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { cabangRegionMap, periodAgg, salesDefaultRange, type Region } from "./sales.js";
import { listTargets } from "./sales-target.js";

export type StatusPacing = "MERAH" | "KUNING" | "HIJAU" | "TANPA_TARGET";

/** Di bawah ini = MERAH (alert). Ambang kartu F21. */
export const AMBANG_MERAH = 50;
/** Di bawah ini = KUNING. */
export const AMBANG_KUNING = 80;

/**
 * Status SO yang dihitung sebagai "order di tangan" (belum jadi faktur).
 * 'Sebagian diproses' SENGAJA tidak ikut: sebagiannya sudah difaktur dan sudah
 * terhitung di faktur — menjumlah nilai SO penuhnya akan menghitung dobel.
 */
export const STATUS_SO_TERBUKA = "Menunggu diproses";

export interface InputPacing {
  targetBulan: number | null;
  hariKerjaBulan: number;
  /** Hari kerja yang sudah berjalan s/d HARI INI (inklusif). */
  hariKerjaLewat: number;
  faktur: number;
  soTerbuka: number;
}

export interface HasilPacing {
  target_bulan: number | null;
  target_prorata: number | null;
  faktur: number;
  so_terbuka: number;
  capaian: number;
  /** capaian ÷ target prorata × 100, satu desimal. */
  pct_pacing: number | null;
  /** capaian ÷ target sebulan penuh × 100, satu desimal. */
  pct_bulan: number | null;
  status: StatusPacing;
}

export function statusDariPct(pct: number | null): StatusPacing {
  if (pct == null) return "TANPA_TARGET";
  if (pct < AMBANG_MERAH) return "MERAH";
  if (pct < AMBANG_KUNING) return "KUNING";
  return "HIJAU";
}

const satuDesimal = (n: number) => Math.round(n * 10) / 10;

export function nilaiPacing(i: InputPacing): HasilPacing {
  const capaian = i.faktur + i.soTerbuka;
  const adaTarget = i.targetBulan != null && i.targetBulan > 0 && i.hariKerjaBulan > 0;
  const prorata = adaTarget ? (i.targetBulan! * Math.min(i.hariKerjaLewat, i.hariKerjaBulan)) / i.hariKerjaBulan : null;
  const pct = prorata && prorata > 0 ? satuDesimal((capaian / prorata) * 100) : null;
  return {
    target_bulan: adaTarget ? i.targetBulan : null,
    target_prorata: prorata,
    faktur: i.faktur,
    so_terbuka: i.soTerbuka,
    capaian,
    pct_pacing: pct,
    pct_bulan: adaTarget ? satuDesimal((capaian / i.targetBulan!) * 100) : null,
    status: statusDariPct(pct),
  };
}

const jt = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(2).replace(".", ",")} M` : `Rp ${Math.round(n / 1e6)} jt`);
const IKON: Record<StatusPacing, string> = { MERAH: "🔴", KUNING: "🟡", HIJAU: "🟢", TANPA_TARGET: "⚪" };

export interface RegionPacing extends HasilPacing {
  region: "East" | "West";
  so_hari_ini: number;
  so_hari_ini_jumlah: number;
}

export interface SoPacing {
  tanggal: string;
  bulan: string;
  hari_kerja_bulan: number;
  hari_kerja_lewat: number;
  regions: RegionPacing[];
  /** OFFICE/VACANT tak punya target — ditampilkan sebagai informasi saja. */
  office: { faktur: number; so_terbuka: number };
  ambang: { merah: number; kuning: number };
}

/** Pesan WA ke grup HoD — satu layar, tanpa kurung sudut (dibuang WA). */
export function formatWaPacing(p: SoPacing, link: string | null): string {
  const baris = [
    `*Pacing Sales ${p.bulan}* · s/d ${p.tanggal} (hari kerja ${p.hari_kerja_lewat}/${p.hari_kerja_bulan})`,
    "",
  ];
  for (const r of p.regions) {
    if (r.status === "TANPA_TARGET") {
      baris.push(`${IKON[r.status]} *${r.region}*: target bulan belum diisi di menu Sales Targets`);
      continue;
    }
    baris.push(
      `${IKON[r.status]} *${r.region}*: ${r.pct_pacing}% dari target s/d hari ini`,
      `   capaian ${jt(r.capaian)} (faktur ${jt(r.faktur)} + SO terbuka ${jt(r.so_terbuka)}) vs ${jt(r.target_prorata ?? 0)}`,
      `   = ${r.pct_bulan}% target sebulan ${jt(r.target_bulan ?? 0)} · SO masuk hari ini ${r.so_hari_ini_jumlah} (${jt(r.so_hari_ini)})`,
    );
  }
  baris.push("", `Merah = di bawah ${p.ambang.merah}% target prorata hari kerja · kuning di bawah ${p.ambang.kuning}%.`);
  if (link) baris.push(`Detail: ${link}`);
  return baris.join("\n");
}

const bulanId = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Pacing bulan berjalan s/d `asOf` (YYYY-MM-DD WIB, default hari ini). */
export async function getSoPacing(asOf?: string): Promise<SoPacing> {
  const sql = db();
  const today = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : salesDefaultRange().to;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const awal = `${today.slice(0, 7)}-01`;

  const [[hk], regionMap, targets] = await Promise.all([
    sql<{ total: number; lewat: number }[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE g::date <= ${today}::date)::int AS lewat
      FROM generate_series(${awal}::date, (${awal}::date + interval '1 month - 1 day')::date, '1 day') g
      WHERE extract(isodow FROM g) < 6
        AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = g::date)`,
    cabangRegionMap(sql),
    listTargets(y),
  ]);
  const faktur = await periodAgg(sql, awal, today, regionMap);

  // SO sebagai baris "mirip faktur" — lihat catatan kepala berkas.
  const soRows = await sql<{ cabang: string; terbuka: number; hari_ini: number; hari_ini_n: number }[]>`
    WITH so AS (
      SELECT so.id, so.trans_date, so.customer_id, so.status,
        it.netto, it.sid
      FROM accurate_sales_order so
      JOIN LATERAL (
        SELECT sum((i.raw->>'dppAmount')::numeric) AS netto,
          (array_agg(NULLIF(i.raw->>'salesman1Id','')::bigint ORDER BY i.line_no))[1] AS sid
        FROM accurate_sales_order_item i WHERE i.order_id = so.id
      ) it ON true
      WHERE so.trans_date BETWEEN ${awal}::date AND ${today}::date
        AND so.status NOT ILIKE '%batal%'
    )
    SELECT COALESCE(${cabangEffSql(sql)}, 'Tanpa cabang') AS cabang,
      COALESCE(sum(ai.total) FILTER (WHERE ai.status = ${STATUS_SO_TERBUKA}), 0)::float8 AS terbuka,
      COALESCE(sum(ai.total) FILTER (WHERE ai.tanggal = ${today}::date), 0)::float8 AS hari_ini,
      count(*) FILTER (WHERE ai.tanggal = ${today}::date)::int AS hari_ini_n
    FROM (
      SELECT id, trans_date AS tanggal, customer_id, status, COALESCE(netto, 0) AS total,
        0::numeric AS tax_amount, sid AS salesman_id, NULL::text AS salesman_name
      FROM so
    ) ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    GROUP BY 1`;

  const soReg = { East: { terbuka: 0, hari_ini: 0, n: 0 }, West: { terbuka: 0, hari_ini: 0, n: 0 }, OFFICE: { terbuka: 0, hari_ini: 0, n: 0 } };
  for (const r of soRows) {
    const reg: Region = regionMap[String(r.cabang)] ?? "OFFICE";
    soReg[reg].terbuka += Number(r.terbuka);
    soReg[reg].hari_ini += Number(r.hari_ini);
    soReg[reg].n += Number(r.hari_ini_n);
  }
  const targetBulan = (region: "East" | "West") =>
    targets.find((t) => t.period === "month" && t.region === region)?.target ?? null;

  const regions: RegionPacing[] = (["East", "West"] as const).map((region) => ({
    region,
    ...nilaiPacing({
      targetBulan: targetBulan(region),
      hariKerjaBulan: Number(hk?.total ?? 0),
      hariKerjaLewat: Number(hk?.lewat ?? 0),
      faktur: faktur.regions[region],
      soTerbuka: soReg[region].terbuka,
    }),
    so_hari_ini: soReg[region].hari_ini,
    so_hari_ini_jumlah: soReg[region].n,
  }));

  return {
    tanggal: today,
    bulan: `${bulanId[m - 1]} ${y}`,
    hari_kerja_bulan: Number(hk?.total ?? 0),
    hari_kerja_lewat: Number(hk?.lewat ?? 0),
    regions,
    office: { faktur: faktur.regions.OFFICE, so_terbuka: soReg.OFFICE.terbuka },
    ambang: { merah: AMBANG_MERAH, kuning: AMBANG_KUNING },
  };
}

/** Grup HOD Squad — sama dengan laporan mingguan (weeklyreport.ts). */
const HOD_SQUAD_JID = "120363042143432430@g.us";

export interface HasilAlert {
  pacing: SoPacing;
  merah: string[];
  wa?: { target: string; sent: boolean; error?: string; skipped?: string };
  wa_preview: string;
}

/**
 * Alert 14:10 (setelah sinkron Accurate 14:00). Kirim HANYA kalau ada region
 * MERAH — sesuai kartu ("alert region <50%"). `dryRun` = hitung & susun saja.
 */
export async function runSoPacingAlert(opts: { dryRun?: boolean; target?: string } = {}): Promise<HasilAlert> {
  const pacing = await getSoPacing();
  const merah = pacing.regions.filter((r) => r.status === "MERAH").map((r) => r.region);
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const wa_preview = formatWaPacing(pacing, base ? `${base}/sales-analytics` : null);
  const target = opts.target || process.env.SO_PACING_ALERT_TARGET || process.env.WEEKLY_REPORT_TARGET || HOD_SQUAD_JID;
  if (opts.dryRun) return { pacing, merah, wa_preview, wa: { target, sent: false, skipped: "dry-run" } };
  if (merah.length === 0) return { pacing, merah, wa_preview, wa: { target, sent: false, skipped: "tak ada region merah" } };
  const r = await sendViaWaGateway(target, wa_preview);
  return { pacing, merah, wa_preview, wa: { target, sent: r.sent, error: r.error } };
}
