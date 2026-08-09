// F67 Sales Incentive Engine — lapisan data.
//
// Model: `wrg_incentive_console_v2.jsx` (PRD-S3-Insentif-Simulator-v2.md v3.1 §A.2),
// BUKAN SK Pasal 4. Rumusnya murni di lib/insentif-calc.ts; berkas ini yang mengumpulkan
// input dari mirror Accurate + price book, lalu menyimpan hasilnya.
//
// Unit hitung = PER TRANSAKSI (satu invoice). Hanya invoice LUNAS yang dihitung.

import { db } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { computeTransaksi, rekapBulanan, type TierUt, type LeadType, type NcrType } from "../lib/insentif-calc.js";
import type { DataScope } from "./access-scope.js";
import { isAmRole } from "./access-scope.js";

// ─────────────────────────────────────────────────────────────────────────────
// AKSES (PRD §E). Satu definisi, dipakai semua endpoint insentif.
//
// Beda DISENGAJA dari visibleAms() di npk-am.ts — jangan "diseragamkan":
//   • HoD di sini dibatasi cabang timnya (hod_territory); di NPK, HoD melihat SEMUA AM.
//     Alasannya NPK = skor kinerja, insentif = angka penghasilan orang (keputusan
//     pemilik produk 2026-08-09).
//   • Tanpa identitas → TERTUTUP, bukan "all". visibleAms() mengembalikan "all" untuk
//     panggilan service-token; untuk payroll itu berarti slip gaji satu tim bocor ke
//     pemanggil mana pun yang punya token. Insentif WAJIB fail-closed.
export type VisibleAms = string[] | "all";

/**
 * Daftar am_id yang boleh dilihat pemanggil. SATU-SATUNYA definisi akses insentif —
 * jangan bikin cabang izin kedua di endpoint atau di UI.
 *
 * Async karena cabang HoD perlu di-resolve ke daftar AM lewat master_user.cabang,
 * memakai scope.cabangScope yang sudah diisi resolveScope dari hod_territory — dengan
 * begitu definisi "cabang" tetap satu, tidak diduplikasi di sini.
 */
export async function resolveVisibleAms(scope: DataScope | undefined): Promise<VisibleAms> {
  if (!scope || !scope.userId) return [];
  if (scope.superuser) return "all";
  if (scope.amOnly && scope.amId) return [scope.amId];

  if (scope.cabangScope?.length) {
    const sql = db();
    const rows = await sql<{ am_id: string; role: string | null }[]>`
      SELECT am_id, role FROM master_user
      WHERE aktif IS NOT FALSE AND NULLIF(cabang,'') = ANY(${scope.cabangScope}::text[])`;
    return rows.filter((r) => isAmRole(r.role)).map((r) => String(r.am_id));
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// PENGUMPULAN INPUT

export interface EffortInput {
  /** 60-100, global per AM per bulan. Sementara di-input manual (PRD §A.4). */
  effort: number;
  /** 0-10, global per AM per bulan. */
  presales: number;
}

interface RawTrx {
  invoice_no: string;
  am_id: string;
  customer_id: string | null;
  tanggal: string;
  revenue: number;
  hpp_total: number | null;
  item_count: number;
  item_ber_hpp: number;
  lunas_at: string | null;
  aging_days: number | null;
}

/**
 * Ambil invoice LUNAS milik AM pada satu periode, sekalian turunkan HPP-nya.
 *
 * Revenue = netto tanpa PPN (total − tax_amount), konsisten dengan basis revenue
 * Sales Analytics. Kalau dipakai gross, GP% jadi ikut turun palsu karena HPP dibanding
 * angka ber-PPN.
 *
 * HPP per baris: accurate_invoice_item.item_id → product_code.accurate_item_id →
 * product_pricelist_setup.hpp. `item_ber_hpp` menghitung berapa baris yang benar-benar
 * ketemu HPP-nya — dipakai memutuskan apakah GP boleh dipercaya (lihat gpActualPct).
 */
async function ambilTransaksi(amIds: string[], periode: string, periodeHpp: string): Promise<RawTrx[]> {
  const sql = db();
  return sql<RawTrx[]>`
    WITH inv AS (
      SELECT ai.id, ai.number AS invoice_no, ai.customer_id::text AS customer_id,
             ai.tanggal, ai.lunas_at,
             (COALESCE(ai.total,0) - COALESCE(ai.tax_amount,0))::float8 AS revenue,
             mu.am_id
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE to_char(ai.tanggal, 'YYYY-MM') = ${periode}
        -- LUNAS: outstanding harus ada DAN nol. Sengaja tidak COALESCE(outstanding,0):
        -- outstanding NULL berarti belum pernah ter-sync, bukan "sudah lunas".
        AND ai.outstanding IS NOT NULL AND ai.outstanding <= 0
        AND COALESCE(ai.total,0) > 0
        AND mu.am_id = ANY(${amIds}::text[])
    )
    SELECT inv.invoice_no, inv.am_id, inv.customer_id, inv.tanggal::text AS tanggal,
           inv.revenue, inv.lunas_at::text AS lunas_at,
           CASE WHEN inv.lunas_at IS NOT NULL THEN (inv.lunas_at - inv.tanggal) END AS aging_days,
           count(it.id)::int AS item_count,
           count(pps.hpp)::int AS item_ber_hpp,
           CASE WHEN count(pps.hpp) > 0
                THEN sum(COALESCE(pps.hpp,0) * COALESCE(it.qty,0))::float8
           END AS hpp_total
    FROM inv
    LEFT JOIN accurate_invoice_item it ON it.invoice_id = inv.id
    LEFT JOIN product_code pc ON pc.accurate_item_id = it.item_id
    LEFT JOIN product_pricelist_setup pps
           ON pps.product_kode = pc.kode AND pps.periode = ${periodeHpp}
    GROUP BY inv.invoice_no, inv.am_id, inv.customer_id, inv.tanggal, inv.revenue, inv.lunas_at
    ORDER BY inv.tanggal, inv.invoice_no`;
}

/**
 * Tipe customer baru per invoice (PRD §A.2 / Pasal 4.5 model).
 *
 * newMurni    = belum pernah ada transaksi apa pun sebelum invoice ini
 * reaktivasi  = ada transaksi sebelumnya, tapi jeda > 12 bulan
 * existing    = selain itu
 *
 * Berlaku 3 bulan pertama sejak transaksi pertama customer itu. AM hasil rotasi tidak
 * dapat NCR atas customer warisan → di sini diputuskan lewat kepemilikan invoice
 * pertama: kalau transaksi pertama customer dipegang AM LAIN, invoice ini `existing`.
 */
async function tipeCustomerBaru(
  amIds: string[],
  periode: string,
): Promise<Map<string, NcrType>> {
  const sql = db();
  const rows = await sql<{ invoice_no: string; ncr_type: NcrType }[]>`
    WITH inv AS (
      SELECT ai.id, ai.number AS invoice_no, ai.customer_id, ai.tanggal, mu.am_id
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE to_char(ai.tanggal, 'YYYY-MM') = ${periode}
        AND ai.outstanding IS NOT NULL AND ai.outstanding <= 0
        AND mu.am_id = ANY(${amIds}::text[])
    ),
    -- Riwayat customer: transaksi pertama + transaksi terakhir SEBELUM invoice ini.
    riwayat AS (
      SELECT inv.invoice_no,
             inv.am_id,
             inv.tanggal,
             (SELECT min(p.tanggal) FROM accurate_invoice p
               WHERE p.customer_id = inv.customer_id) AS pertama,
             (SELECT max(p.tanggal) FROM accurate_invoice p
               WHERE p.customer_id = inv.customer_id AND p.tanggal < inv.tanggal) AS sebelumnya,
             -- AM pemegang transaksi pertama customer ini (untuk aturan rotasi).
             (SELECT mu2.am_id FROM accurate_invoice p
                LEFT JOIN accurate_salesman acs2 ON acs2.id = p.salesman_id
                LEFT JOIN master_user mu2 ON mu2.am_id = acs2.master_user_id::text
               WHERE p.customer_id = inv.customer_id
               ORDER BY p.tanggal ASC LIMIT 1) AS am_pertama
      FROM inv
    )
    SELECT invoice_no,
           CASE
             -- customer warisan (transaksi pertama milik AM lain) → tidak dapat NCR
             WHEN am_pertama IS NOT NULL AND am_pertama <> am_id THEN 'existing'
             -- di luar 3 bulan pertama sejak transaksi pertama → tidak dapat NCR
             WHEN pertama IS NOT NULL AND tanggal > (pertama + INTERVAL '3 months') THEN 'existing'
             WHEN sebelumnya IS NULL THEN 'newMurni'
             WHEN tanggal - sebelumnya > 365 THEN 'reaktivasi'
             ELSE 'existing'
           END AS ncr_type
    FROM riwayat`;
  return new Map(rows.map((r) => [r.invoice_no, r.ncr_type]));
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE

export interface ComputeOptions {
  periode: string;            // 'YYYY-MM'
  periodeHpp: string;         // periode price book yang dipakai ambil HPP
  effortPerAm: Map<string, EffortInput>;
  amIds: string[];
  /** true → tulis ke DB. Default false (pratinjau), meniru pola importer lain. */
  apply?: boolean;
}

export interface ComputeReport {
  periode: string;
  am_dihitung: number;
  transaksi: number;
  tanpa_hpp: number;          // GP tak bisa diturunkan → MR 0
  tanpa_aging: number;        // umur pelunasan tak diketahui → CF netral 1,00
  total_am: number;
  total_ho: number;
  ditulis: boolean;
}

/**
 * Hitung satu periode untuk sekumpulan AM.
 *
 * Dua kondisi "tidak diketahui" ditangani eksplisit, dan KEDUANYA dicatat di laporan
 * supaya kelihatan — bukan diam-diam dianggap nol:
 *
 *   • HPP tak ketemu untuk SEMUA baris invoice → gpActualPct null → MR 0.
 *     Tidak ditebak: menebak margin = menebak insentif orang.
 *   • lunas_at NULL (invoice sudah lunas sejak pertama ter-sync, migrasi 094) →
 *     aging tak diketahui → CF 1,00 (netral). Alternatifnya membuang invoice itu
 *     dari perhitungan, tapi itu menghapus revenue yang nyata; netral lebih jujur
 *     daripada menghukum atau menghadiahi.
 */
export async function computePeriode(opts: ComputeOptions): Promise<ComputeReport> {
  const sql = db();
  const trx = await ambilTransaksi(opts.amIds, opts.periode, opts.periodeHpp);
  const ncrMap = await tipeCustomerBaru(opts.amIds, opts.periode);

  const perAm = new Map<string, { rows: ReturnType<typeof computeTransaksi>[]; tier: TierUt }>();
  const cfg = await sql<{ am_id: string; tier_ut: TierUt; cap_bulanan: number }[]>`
    SELECT am_id, tier_ut, cap_bulanan::float8 AS cap_bulanan FROM insentif_am_config
    WHERE am_id = ANY(${opts.amIds}::text[])`;
  const cfgByAm = new Map(cfg.map((c) => [c.am_id, c]));

  let tanpaHpp = 0;
  let tanpaAging = 0;
  const hasil: {
    r: RawTrx;
    out: ReturnType<typeof computeTransaksi>;
    ncr: NcrType;
    gpActualPct: number | null;
  }[] = [];

  for (const r of trx) {
    const c = cfgByAm.get(r.am_id);
    if (!c) continue; // AM belum punya tier → tak dihitung. Sengaja diam: seed dulu.

    const eff = opts.effortPerAm.get(r.am_id) ?? { effort: 60, presales: 0 };

    // GP hanya dipercaya kalau SEMUA baris invoice ketemu HPP-nya. Kalau sebagian saja,
    // hpp_total terlalu kecil → GP terlihat tinggi palsu → MR kelebihan. Lebih baik null.
    const hppLengkap = r.item_count > 0 && r.item_ber_hpp === r.item_count && r.hpp_total != null;
    const gpActualPct = hppLengkap && r.revenue > 0
      ? ((r.revenue - (r.hpp_total as number)) / r.revenue) * 100
      : null;
    if (gpActualPct == null) tanpaHpp++;
    if (r.aging_days == null) tanpaAging++;

    const ncr = ncrMap.get(r.invoice_no) ?? "existing";
    const out = computeTransaksi({
      revenue: r.revenue,
      tier: c.tier_ut,
      gpActualPct,
      agingDays: r.aging_days ?? 30, // 30 = tingkat netral CF 1,00 (lihat doc di atas)
      ncrType: ncr,
      leadType: "A" as LeadType,     // default; HOD menandai B/C saat review (PRD §C.2.8)
      effort: eff.effort,
      presales: eff.presales,
    });
    hasil.push({ r, out, ncr, gpActualPct });
    const bucket = perAm.get(r.am_id) ?? { rows: [], tier: c.tier_ut };
    bucket.rows.push(out);
    perAm.set(r.am_id, bucket);
  }

  const totalAm = hasil.reduce((s, h) => s + h.out.insentifAm, 0);
  const totalHo = hasil.reduce((s, h) => s + h.out.insentifHo, 0);

  if (opts.apply) {
    for (const h of hasil) {
      const c = cfgByAm.get(h.r.am_id)!;
      const eff = opts.effortPerAm.get(h.r.am_id) ?? { effort: 60, presales: 0 };
      await sql`
        INSERT INTO insentif_transaksi
          (am_id, periode, invoice_no, customer_id, tanggal, revenue,
           gp_actual_pct, aging_days, ncr_type, lead_type,
           pi_points, harga_poin, mr_pct, ncr_pct, cf, pengali,
           insentif_raw, insentif_am, insentif_ho, computed_from)
        VALUES
          (${h.r.am_id}, ${opts.periode}, ${h.r.invoice_no}, ${h.r.customer_id}, ${h.r.tanggal},
           ${h.r.revenue}, ${h.gpActualPct},
           ${h.r.aging_days}, ${h.ncr}, 'A',
           ${h.out.piPoints}, ${h.out.hargaPoin}, ${h.out.mrPct}, ${h.out.ncrPct}, ${h.out.cf},
           ${h.out.pengali}, ${h.out.insentifRaw}, ${h.out.insentifAm}, ${h.out.insentifHo},
           ${sql.json({ effort: eff.effort, presales: eff.presales, tier_ut: c.tier_ut,
                        aging_diketahui: h.r.aging_days != null,
                        hpp_lengkap: h.r.item_count > 0 && h.r.item_ber_hpp === h.r.item_count })})
        ON CONFLICT (invoice_no, am_id) DO UPDATE SET
          revenue = EXCLUDED.revenue, gp_actual_pct = EXCLUDED.gp_actual_pct,
          aging_days = EXCLUDED.aging_days, ncr_type = EXCLUDED.ncr_type,
          pi_points = EXCLUDED.pi_points, harga_poin = EXCLUDED.harga_poin,
          mr_pct = EXCLUDED.mr_pct, ncr_pct = EXCLUDED.ncr_pct, cf = EXCLUDED.cf,
          pengali = EXCLUDED.pengali, insentif_raw = EXCLUDED.insentif_raw,
          insentif_am = EXCLUDED.insentif_am, insentif_ho = EXCLUDED.insentif_ho,
          computed_from = EXCLUDED.computed_from, computed_at = now()`;
    }

    for (const [amId, bucket] of perAm) {
      const c = cfgByAm.get(amId)!;
      const eff = opts.effortPerAm.get(amId) ?? { effort: 60, presales: 0 };
      const rk = rekapBulanan(bucket.rows, c.cap_bulanan);
      await sql`
        INSERT INTO insentif_bulanan
          (am_id, periode, tier_ut, effort_score, presales_score,
           total_insentif_am, total_insentif_ho, cap_bulanan, dibayar, retention_pool)
        VALUES
          (${amId}, ${opts.periode}, ${c.tier_ut}, ${eff.effort}, ${eff.presales},
           ${rk.totalAm}, ${rk.totalHo}, ${c.cap_bulanan}, ${rk.dibayar}, ${rk.retentionPool})
        ON CONFLICT (am_id, periode) DO UPDATE SET
          tier_ut = EXCLUDED.tier_ut, effort_score = EXCLUDED.effort_score,
          presales_score = EXCLUDED.presales_score,
          total_insentif_am = EXCLUDED.total_insentif_am,
          total_insentif_ho = EXCLUDED.total_insentif_ho,
          cap_bulanan = EXCLUDED.cap_bulanan, dibayar = EXCLUDED.dibayar,
          retention_pool = EXCLUDED.retention_pool, computed_at = now()`;
    }
  }

  return {
    periode: opts.periode,
    am_dihitung: perAm.size,
    transaksi: hasil.length,
    tanpa_hpp: tanpaHpp,
    tanpa_aging: tanpaAging,
    total_am: totalAm,
    total_ho: totalHo,
    ditulis: !!opts.apply,
  };
}
