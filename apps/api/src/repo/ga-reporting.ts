import { db } from "../db.js";

// F141 — GA Reporting & Analytics Dashboard (konsolidasi F49 ATK+F54 Materai,
// F50 Kendaraan, F51 Dana Ops, F52 IT Asset, F53 Stiker Aset). KELIMA modul
// sumber ini masih di branch terpisah, BELUM merge ke dev/main saat F141
// dibuat — setiap query modul diisolasi try/catch: kalau tabelnya belum ada
// (relation does not exist), modul itu dilaporkan `available:false` alih-alih
// menjatuhkan seluruh dashboard (pola sama dgn AR aging di sales.ts
// salesOverview). Tidak ada tabel/migrasi baru — murni agregasi baca dari
// tabel modul lain begitu masing-masing sudah merge.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function gaDefaultRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 7 * 3600 * 1000); // WIB
  const to = now.toISOString().slice(0, 10);
  const from = `${to.slice(0, 7)}-01`; // awal bulan berjalan (WIB)
  return { from, to };
}

export function gaReportingRange(from?: string, to?: string): { from: string; to: string } {
  const d = gaDefaultRange();
  let f = from && ISO.test(from) ? from : d.from;
  let t = to && ISO.test(to) ? to : d.to;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

// Threshold cermin dari modul asal (belum bisa di-import langsung krn branch
// sumbernya belum merge): STNK due = H-30 (DEFAULT_STNK_ALERT_DAYS di F50
// vehicle.ts), expiring_soon vendor tidak relevan di sini.
const STNK_ALERT_DAYS = 30;

interface AtkSummary {
  available: boolean;
  current?: { active_items: number; low_stock_count: number };
  period?: {
    stock_in_qty: number;
    stock_out_qty: number;
    opname_count: number;
    opname_variance_qty: number;
    by_transaction_category: { barang: { stock_in_qty: number; stock_out_qty: number }; materai: { stock_in_qty: number; stock_out_qty: number } };
  };
}

async function atkSummary(from: string, to: string): Promise<AtkSummary> {
  const sql = db();
  try {
    const [levelRow] = await sql`
      SELECT
        count(*)::int AS active_items,
        count(*) FILTER (
          WHERE i.min_stock IS NOT NULL
            AND (COALESCE(m.stock_in, 0) - COALESCE(m.stock_out, 0)) < i.min_stock
        )::int AS low_stock_count
      FROM atk_item i
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN mv.movement_type = 'in' THEN mv.qty ELSE 0 END) AS stock_in,
          SUM(CASE WHEN mv.movement_type = 'out' THEN mv.qty ELSE 0 END) AS stock_out
        FROM atk_stock_movement mv WHERE mv.item_id = i.id
      ) m ON true
      WHERE i.is_active = true`;

    const catRows = await sql`
      SELECT i.transaction_category AS category,
        COALESCE(SUM(CASE WHEN m.movement_type = 'in' THEN m.qty ELSE 0 END), 0) AS stock_in_qty,
        COALESCE(SUM(CASE WHEN m.movement_type = 'out' THEN m.qty ELSE 0 END), 0) AS stock_out_qty
      FROM atk_stock_movement m
      JOIN atk_item i ON i.id = m.item_id
      WHERE m.movement_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY i.transaction_category`;

    const byCategory = { barang: { stock_in_qty: 0, stock_out_qty: 0 }, materai: { stock_in_qty: 0, stock_out_qty: 0 } };
    for (const r of catRows) {
      const key: "barang" | "materai" = String(r.category) === "materai" ? "materai" : "barang";
      byCategory[key] = { stock_in_qty: Number(r.stock_in_qty), stock_out_qty: Number(r.stock_out_qty) };
    }

    const [opnameRow] = await sql`
      SELECT count(*)::int AS opname_count, COALESCE(SUM(counted_qty - system_qty), 0) AS opname_variance_qty
      FROM atk_stock_opname WHERE opname_date BETWEEN ${from}::date AND ${to}::date`;

    return {
      available: true,
      current: {
        active_items: Number(levelRow?.active_items ?? 0),
        low_stock_count: Number(levelRow?.low_stock_count ?? 0),
      },
      period: {
        stock_in_qty: byCategory.barang.stock_in_qty + byCategory.materai.stock_in_qty,
        stock_out_qty: byCategory.barang.stock_out_qty + byCategory.materai.stock_out_qty,
        opname_count: Number(opnameRow?.opname_count ?? 0),
        opname_variance_qty: Number(opnameRow?.opname_variance_qty ?? 0),
        by_transaction_category: byCategory,
      },
    };
  } catch {
    // atk_item/atk_stock_movement/atk_stock_opname belum ada (F49/F54 belum merge)
    return { available: false };
  }
}

interface KendaraanSummary {
  available: boolean;
  current?: { total_vehicles: number; due_service_count: number; due_stnk_count: number };
  period?: { bbm_liter: number; bbm_cost: number };
}

async function kendaraanSummary(from: string, to: string): Promise<KendaraanSummary> {
  const sql = db();
  try {
    const [stateRow] = await sql`
      SELECT
        count(*) FILTER (WHERE active)::int AS total_vehicles,
        count(*) FILTER (
          WHERE active AND (current_km - COALESCE(last_service_km, 0)) >= service_interval_km
        )::int AS due_service_count,
        count(*) FILTER (
          WHERE active AND stnk_expiry IS NOT NULL AND stnk_expiry <= CURRENT_DATE + ${STNK_ALERT_DAYS}::int
        )::int AS due_stnk_count
      FROM vehicle`;

    const [bbmRow] = await sql`
      SELECT COALESCE(SUM(bbm_liter), 0) AS bbm_liter, COALESCE(SUM(bbm_cost), 0) AS bbm_cost
      FROM vehicle_log WHERE log_type = 'bbm' AND log_date BETWEEN ${from}::date AND ${to}::date`;

    return {
      available: true,
      current: {
        total_vehicles: Number(stateRow?.total_vehicles ?? 0),
        due_service_count: Number(stateRow?.due_service_count ?? 0),
        due_stnk_count: Number(stateRow?.due_stnk_count ?? 0),
      },
      period: { bbm_liter: Number(bbmRow?.bbm_liter ?? 0), bbm_cost: Number(bbmRow?.bbm_cost ?? 0) },
    };
  } catch {
    // vehicle/vehicle_log belum ada (F50 belum merge)
    return { available: false };
  }
}

interface DanaOpsSummary {
  available: boolean;
  current?: { in_progress_count: number; outstanding_amount: number };
  period?: { realized_count: number; realized_amount: number };
}

async function danaOpsSummary(from: string, to: string): Promise<DanaOpsSummary> {
  const sql = db();
  try {
    const [row] = await sql`
      WITH item_agg AS (
        SELECT dana_ops_id, COALESCE(SUM(amount), 0) AS amount_realized
        FROM dana_ops_item GROUP BY dana_ops_id
      )
      SELECT
        count(*) FILTER (WHERE d.status = 'in_progress')::int AS in_progress_count,
        COALESCE(SUM(d.amount_requested - COALESCE(i.amount_realized, 0)) FILTER (WHERE d.status = 'in_progress'), 0) AS outstanding_amount,
        count(*) FILTER (
          WHERE d.status = 'realized' AND d.realized_at::date BETWEEN ${from}::date AND ${to}::date
        )::int AS realized_count,
        COALESCE(SUM(i.amount_realized) FILTER (
          WHERE d.status = 'realized' AND d.realized_at::date BETWEEN ${from}::date AND ${to}::date
        ), 0) AS realized_amount
      FROM dana_ops d LEFT JOIN item_agg i ON i.dana_ops_id = d.id`;

    return {
      available: true,
      current: {
        in_progress_count: Number(row?.in_progress_count ?? 0),
        outstanding_amount: Number(row?.outstanding_amount ?? 0),
      },
      period: {
        realized_count: Number(row?.realized_count ?? 0),
        realized_amount: Number(row?.realized_amount ?? 0),
      },
    };
  } catch {
    // dana_ops/dana_ops_item belum ada (F51 belum merge)
    return { available: false };
  }
}

interface ItAssetSummary {
  available: boolean;
  current?: { open_count: number; in_progress_count: number; breach_active_count: number; breach_active_critical_count: number };
  period?: { resolved_count: number; breach_resolved_late_count: number };
}

async function itAssetSummary(from: string, to: string): Promise<ItAssetSummary> {
  const sql = db();
  try {
    const [row] = await sql`
      SELECT
        count(*) FILTER (WHERE t.status = 'open')::int AS open_count,
        count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress_count,
        count(*) FILTER (WHERE t.status <> 'resolved' AND t.sla_due_at < now())::int AS breach_active_count,
        count(*) FILTER (WHERE a.is_critical AND t.status <> 'resolved' AND t.sla_due_at < now())::int AS breach_active_critical_count,
        count(*) FILTER (
          WHERE t.status = 'resolved' AND t.resolved_at IS NOT NULL AND t.resolved_at::date BETWEEN ${from}::date AND ${to}::date
        )::int AS resolved_count,
        count(*) FILTER (
          WHERE t.status = 'resolved' AND t.resolved_at IS NOT NULL AND t.resolved_at > t.sla_due_at
            AND t.resolved_at::date BETWEEN ${from}::date AND ${to}::date
        )::int AS breach_resolved_late_count
      FROM it_ticket t JOIN it_asset a ON a.id = t.asset_id`;

    return {
      available: true,
      current: {
        open_count: Number(row?.open_count ?? 0),
        in_progress_count: Number(row?.in_progress_count ?? 0),
        breach_active_count: Number(row?.breach_active_count ?? 0),
        breach_active_critical_count: Number(row?.breach_active_critical_count ?? 0),
      },
      period: {
        resolved_count: Number(row?.resolved_count ?? 0),
        breach_resolved_late_count: Number(row?.breach_resolved_late_count ?? 0),
      },
    };
  } catch {
    // it_asset/it_ticket belum ada (F52 belum merge)
    return { available: false };
  }
}

interface AssetTagSummary {
  available: boolean;
  current?: { total_active: number; belum_diaudit_count: number; ditemukan_count: number; hilang_count: number };
  period?: { audit_count: number };
}

async function assetTagSummary(from: string, to: string): Promise<AssetTagSummary> {
  const sql = db();
  try {
    const [row] = await sql`
      SELECT
        count(*)::int AS total_active,
        count(*) FILTER (WHERE la.audited_at IS NULL)::int AS belum_diaudit_count,
        count(*) FILTER (WHERE la.audited_at IS NOT NULL AND la.found)::int AS ditemukan_count,
        count(*) FILTER (WHERE la.audited_at IS NOT NULL AND NOT la.found)::int AS hilang_count
      FROM asset_tag a
      LEFT JOIN LATERAL (
        SELECT audited_at, found FROM asset_tag_audit_log
        WHERE asset_tag_id = a.id ORDER BY audited_at DESC LIMIT 1
      ) la ON true
      WHERE a.active = true`;

    const [auditRow] = await sql`
      SELECT count(*)::int AS audit_count FROM asset_tag_audit_log
      WHERE audited_at::date BETWEEN ${from}::date AND ${to}::date`;

    return {
      available: true,
      current: {
        total_active: Number(row?.total_active ?? 0),
        belum_diaudit_count: Number(row?.belum_diaudit_count ?? 0),
        ditemukan_count: Number(row?.ditemukan_count ?? 0),
        hilang_count: Number(row?.hilang_count ?? 0),
      },
      period: { audit_count: Number(auditRow?.audit_count ?? 0) },
    };
  } catch {
    // asset_tag/asset_tag_audit_log belum ada (F53 belum merge)
    return { available: false };
  }
}

export async function gaReportingSummary(from: string, to: string) {
  const [atk, kendaraan, danaOps, itAsset, assetTag] = await Promise.all([
    atkSummary(from, to),
    kendaraanSummary(from, to),
    danaOpsSummary(from, to),
    itAssetSummary(from, to),
    assetTagSummary(from, to),
  ]);
  return {
    range: { from, to },
    atk,
    kendaraan,
    dana_ops: danaOps,
    it_asset: itAsset,
    asset_tag: assetTag,
  };
}
