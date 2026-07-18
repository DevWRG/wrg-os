// F66 NPK Engine — lapisan data: kumpulkan input mentah per HoD (agregasi tim via
// cabang), hitung (npk-calc.ts), persist (058/059), dan baca scope-aware.
//
// Reuse pola JOIN sales-analytics.ts: accurate_invoice → accurate_salesman →
// master_user (am_id) → cabang. Row-level scope via access-scope.ts.
//
// KEJUJURAN DATA (lihat plan): hari ini hanya rocky/yogi punya mapping cabang di
// hod_territory. 6 HoD non-sales tak punya scope → aspek sales = 0/available:false.
// Sumber KSO/GP/CRM/coaching + target customer BELUM ADA → aspek itu selalu stub
// (available:false). Aspek yg dihitung real: Revenue (butuh target cabang) & AR
// (proxy umur `tanggal`, karena accurate_invoice tak punya due_date).

import { db } from "../db.js";
import { HODS } from "../hod-resolver.js";
import { calcNPK, ASPECT_ORDER, ASPECT_LABEL, DEFAULT_BOBOT, type AspectInput, type AspectKey, type NPKResult } from "../lib/npk-calc.js";
import type { DataScope } from "./access-scope.js";

export type Period = "S1" | "S2";

// Rentang tanggal semester. S1=Jan-Jun, S2=Jul-Des.
export function semesterRange(year: number, period: Period): { from: string; to: string } {
  return period === "S1"
    ? { from: `${year}-01-01`, to: `${year}-06-30` }
    : { from: `${year}-07-01`, to: `${year}-12-31` };
}

// Semester berjalan (utk default query). Bulan 1-6 → S1, else S2.
export function currentPeriod(now = new Date()): { year: number; period: Period } {
  return { year: now.getUTCFullYear(), period: now.getUTCMonth() < 6 ? "S1" : "S2" };
}

// Kurangi n hari dari tanggal ISO (utk cutoff AR>45).
function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Cabang yang jadi tanggung jawab satu HoD (dari hod_territory). Kosong utk HoD non-cabang.
async function hodCabangSet(sql: ReturnType<typeof db>, hodKey: string): Promise<string[]> {
  const rows = await sql<{ cabang: string }[]>`SELECT cabang FROM hod_territory WHERE hod_key = ${hodKey}`;
  return rows.map((r) => String(r.cabang)).filter(Boolean);
}

export interface GatherResult {
  input: AspectInput;
  avail: Partial<Record<AspectKey, boolean>>;
  meta: Record<string, unknown>; // → computed_from (audit + flag stub/proxy)
}

// Kumpulkan input 7 aspek utk satu HoD. Aspek tanpa sumber live → avail:false.
async function gatherAspectInput(
  sql: ReturnType<typeof db>,
  hodKey: string,
  cabang: string[],
  year: number,
  period: Period,
): Promise<GatherResult> {
  const { from, to } = semesterRange(year, period);
  const input: AspectInput = {
    revenue_actual: 0, revenue_target: 0,
    customer_active_count: 0, customer_target: 0,
    ar_over_45d: 0, ar_total: 0,
    kso_active: 0, kso_target: 0, kso_expired_no_renewal: 0,
    gp_actual: 0, gp_target: 0,
    call_coverage_pct: 0, area_coverage_pct: 0, new_cust_rate_pct: 0, timeliness_pct: 0,
    coaching_score: 0,
  };
  // Aspek yang memang belum punya sumber data live → selalu stub (SK butuh sumber ini,
  // tapi tabel KSO/GP/CRM-coverage/coaching + target customer belum ada di sistem).
  const avail: Partial<Record<AspectKey, boolean>> = {
    customer: false, kso: false, gp: false, crm: false, coaching: false,
  };
  const stubbed: AspectKey[] = ["customer", "kso", "gp", "crm", "coaching"];

  if (cabang.length === 0) {
    // HoD non-cabang (IVD/Finance/Medical/Aftersales/Acc/BD) → tak ada scope sales.
    avail.revenue = false;
    avail.ar = false;
    return {
      input,
      avail,
      meta: { cabang: [], reason: "hod_non_cabang", stubbed: [...stubbed, "revenue", "ar"] },
    };
  }

  // Revenue actual (netto = total−PPN) + customer aktif, scoped ke cabang tim + semester.
  const [rev] = await sql`
    SELECT COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS revenue,
           count(DISTINCT ai.customer_id)::int AS customers
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.tanggal BETWEEN ${from} AND ${to}
      AND COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) = ANY(${cabang}::text[])`;
  input.revenue_actual = Number(rev?.revenue ?? 0);
  input.customer_active_count = Number(rev?.customers ?? 0);

  // Revenue target: target cabang tahunan (Σ cabang tim) ÷2 utk semester.
  const [tgt] = await sql`
    SELECT COALESCE(sum(target),0)::float8 AS target
    FROM sales_target_cabang WHERE year = ${year} AND cabang = ANY(${cabang}::text[])`;
  input.revenue_target = Number(tgt?.target ?? 0) / 2;

  // AR: total outstanding (status OPEN) + proxy >45hr pakai umur `tanggal` (tak ada due_date).
  const cut45 = minusDays(to, 45);
  const [ar] = await sql`
    SELECT COALESCE(sum(ai.total),0)::float8 AS ar_total,
           COALESCE(sum(ai.total) FILTER (WHERE ai.tanggal < ${cut45}),0)::float8 AS ar_over45
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
    WHERE ai.status = 'OPEN'
      AND COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) = ANY(${cabang}::text[])`;
  input.ar_total = Number(ar?.ar_total ?? 0);
  input.ar_over_45d = Number(ar?.ar_over45 ?? 0);

  // Revenue butuh target utk di-skor; tanpa target → tak bisa dinilai (available:false).
  avail.revenue = input.revenue_target > 0;
  avail.ar = input.ar_total > 0;

  const stubbedNow = [...stubbed];
  if (!avail.revenue) stubbedNow.push("revenue");
  if (!avail.ar) stubbedNow.push("ar");

  return {
    input,
    avail,
    meta: {
      cabang,
      range: { from, to },
      revenue_actual: input.revenue_actual,
      revenue_target_year: Number(tgt?.target ?? 0),
      revenue_target_semester: input.revenue_target,
      customer_active_count: input.customer_active_count,
      customer_target_missing: true,
      ar_total: input.ar_total,
      ar_over_45d: input.ar_over_45d,
      ar_over45_proxy: true, // umur `tanggal`, bukan due_date
      stubbed: stubbedNow,
    },
  };
}

// Compute batch NPK 8 HoD utk satu semester. Idempoten (upsert 058 + replace 059).
export async function computeNpk(opts: { year: number; period: Period }): Promise<{ computed: number; year: number; period: Period }> {
  const sql = db();
  const { year, period } = opts;
  let computed = 0;
  for (const hod of HODS) {
    const cabang = await hodCabangSet(sql, hod.key);
    const g = await gatherAspectInput(sql, hod.key, cabang, year, period);
    const res: NPKResult = calcNPK(g.input, DEFAULT_BOBOT, g.avail);
    await sql`
      INSERT INTO npk_score_semester (hod_key, year, period, npk, predikat, computed_from, computed_at)
      VALUES (${hod.key}, ${year}, ${period}, ${res.npk}, ${res.predikat}, ${sql.json(g.meta as Parameters<typeof sql.json>[0])}, now())
      ON CONFLICT (hod_key, year, period) DO UPDATE
        SET npk = EXCLUDED.npk, predikat = EXCLUDED.predikat,
            computed_from = EXCLUDED.computed_from, computed_at = now()`;
    await sql`DELETE FROM npk_aspect_score WHERE hod_key = ${hod.key} AND year = ${year} AND period = ${period}`;
    for (const a of res.aspects) {
      await sql`
        INSERT INTO npk_aspect_score (hod_key, year, period, aspect, raw, capped, weight, contribution, available)
        VALUES (${hod.key}, ${year}, ${period}, ${a.key},
                ${round2(a.raw)}, ${round2(a.capped)}, ${a.bobot}, ${round2(a.contribution)}, ${a.available})`;
    }
    computed += 1;
  }
  return { computed, year, period };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Baca (scope-aware) ────────────────────────────────────────────

export interface NpkAspectRow {
  key: AspectKey; label: string; weight: number;
  raw: number | null; capped: number | null; contribution: number | null; available: boolean;
}
export interface NpkRow {
  hod_key: string; hod_name: string; role: string; user_id: string | null;
  npk: number; predikat: string;
  available_count: number;
  aspects: Record<AspectKey, { capped: number | null; available: boolean }>;
  computed_at: string | null;
}

// Nama HoD dari app_user (via hod_key) → fallback HODS[].name.
async function hodNameMap(sql: ReturnType<typeof db>): Promise<Record<string, { name: string; user_id: string }>> {
  const rows = await sql<{ hod_key: string; id: string; name: string | null; email: string }[]>`
    SELECT hod_key, id, name, email FROM app_user WHERE hod_key IS NOT NULL`;
  const map: Record<string, { name: string; user_id: string }> = {};
  for (const r of rows) map[String(r.hod_key)] = { name: r.name || r.email, user_id: String(r.id) };
  return map;
}

// Tentukan hod_key mana yang boleh dilihat scope ini.
//   superuser/admin → semua HoD;  HoD → hanya diri;  lainnya → kosong (HR sensitif).
function visibleHods(scope: DataScope | undefined): string[] | "all" {
  if (!scope || scope.superuser) return "all";
  if (scope.hodKey) return [scope.hodKey];
  return [];
}

export async function getNpkScores(scope: DataScope | undefined, year: number, period: Period) {
  const sql = db();
  const vis = visibleHods(scope);
  const nameMap = await hodNameMap(sql);

  const heads = await sql<{ hod_key: string; npk: number; predikat: string; computed_at: string | null }[]>`
    SELECT hod_key, npk::float8 AS npk, predikat, computed_at::text AS computed_at
    FROM npk_score_semester WHERE year = ${year} AND period = ${period}`;
  const headByKey = Object.fromEntries(heads.map((h) => [h.hod_key, h]));

  const aspRows = await sql<{ hod_key: string; aspect: AspectKey; capped: number | null; available: boolean }[]>`
    SELECT hod_key, aspect, capped::float8 AS capped, available
    FROM npk_aspect_score WHERE year = ${year} AND period = ${period}`;
  const aspByHod: Record<string, Record<string, { capped: number | null; available: boolean }>> = {};
  for (const a of aspRows) {
    (aspByHod[a.hod_key] ??= {})[a.aspect] = { capped: a.capped == null ? null : Number(a.capped), available: a.available };
  }

  const keys = vis === "all" ? HODS.map((h) => h.key) : vis;
  const rows: NpkRow[] = keys.map((key) => {
    const hod = HODS.find((h) => h.key === key);
    const head = headByKey[key];
    const asp = aspByHod[key] ?? {};
    const aspects = Object.fromEntries(
      ASPECT_ORDER.map((k) => [k, asp[k] ?? { capped: null, available: false }]),
    ) as Record<AspectKey, { capped: number | null; available: boolean }>;
    return {
      hod_key: key,
      hod_name: nameMap[key]?.name || hod?.name || key,
      role: hod?.role || "HoD",
      user_id: nameMap[key]?.user_id ?? null,
      npk: head ? Number(head.npk) : 0,
      predikat: head?.predikat ?? "buruk",
      available_count: ASPECT_ORDER.filter((k) => aspects[k].available).length,
      aspects,
      computed_at: head?.computed_at ?? null,
    };
  });

  return {
    year, period,
    scope: vis === "all" ? ("all" as const) : ("self" as const),
    computed: heads.length > 0,
    aspect_order: ASPECT_ORDER,
    aspect_label: ASPECT_LABEL,
    rows,
  };
}

// Detail 1 HoD (self atau admin). `ref` = app_user.id ATAU hod_key. 403 bila lintas-HoD.
export async function getNpkDetail(scope: DataScope | undefined, ref: string, year: number, period: Period) {
  const sql = db();
  // Resolusi ref → hod_key. ref bisa app_user.id (UUID, dari halaman self) ATAU hod_key
  // langsung (drilldown admin). Cek hod_key dulu; app_user hanya bila ref berbentuk UUID
  // (kolom id bertipe uuid → cast non-UUID akan error).
  let hodKey: string | null = null;
  if (HODS.some((h) => h.key === ref)) {
    hodKey = ref;
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const [byUser] = await sql<{ hod_key: string | null }[]>`SELECT hod_key FROM app_user WHERE id = ${ref}`;
    if (byUser?.hod_key) hodKey = String(byUser.hod_key);
  }
  if (!hodKey) throw Object.assign(new Error("HoD tidak ditemukan"), { status: 404 });

  // Guard scope: superuser bebas; HoD hanya diri.
  if (!(scope?.superuser) && scope?.hodKey && scope.hodKey !== hodKey) {
    throw Object.assign(new Error("HoD hanya boleh membuka NPK sendiri"), { status: 403 });
  }
  if (!(scope?.superuser) && !scope?.hodKey) {
    throw Object.assign(new Error("akses ditolak"), { status: 403 });
  }

  const nameMap = await hodNameMap(sql);
  const hod = HODS.find((h) => h.key === hodKey);
  const [head] = await sql<{ npk: number; predikat: string; computed_from: unknown; computed_at: string | null }[]>`
    SELECT npk::float8 AS npk, predikat, computed_from, computed_at::text AS computed_at
    FROM npk_score_semester WHERE hod_key = ${hodKey} AND year = ${year} AND period = ${period}`;
  const asp = await sql<{ aspect: AspectKey; raw: number | null; capped: number | null; weight: number; contribution: number | null; available: boolean }[]>`
    SELECT aspect, raw::float8 AS raw, capped::float8 AS capped, weight, contribution::float8 AS contribution, available
    FROM npk_aspect_score WHERE hod_key = ${hodKey} AND year = ${year} AND period = ${period}`;
  const aspByKey = Object.fromEntries(asp.map((a) => [a.aspect, a]));

  const aspects: NpkAspectRow[] = ASPECT_ORDER.map((k) => {
    const a = aspByKey[k];
    return {
      key: k, label: ASPECT_LABEL[k], weight: DEFAULT_BOBOT[k],
      raw: a?.raw == null ? null : Number(a.raw),
      capped: a?.capped == null ? null : Number(a.capped),
      contribution: a?.contribution == null ? null : Number(a.contribution),
      available: a?.available ?? false,
    };
  });

  return {
    hod_key: hodKey,
    hod_name: nameMap[hodKey]?.name || hod?.name || hodKey,
    role: hod?.role || "HoD",
    year, period,
    npk: head ? Number(head.npk) : 0,
    predikat: head?.predikat ?? "buruk",
    available_count: aspects.filter((a) => a.available).length,
    computed: !!head,
    computed_at: head?.computed_at ?? null,
    computed_from: head?.computed_from ?? null,
    aspects,
  };
}
