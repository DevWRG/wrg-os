// F66 NPK level AM/Sales — lapisan data: kumpulkan input 7 aspek per Account
// Manager, hitung (npk-calc.ts, formula SK Pasal 3 yang SAMA dengan jalur HoD),
// persist (078), dan baca scope-aware.
//
// Beda dengan repo/npk.ts (jalur HoD): subjek skor = `master_user.am_id`, bukan
// hod_key, dan agregasinya per-AM (mu.am_id) bukan per-cabang. Bobot, cap 120,
// dan predikat identik — supaya NPK AM dan NPK HoD bisa dibandingkan apple-to-apple.
//
// KEJUJURAN DATA. Aspek yang di-wire batch pertama:
//   - revenue  : accurate_invoice netto per AM ÷ sales_target_am (÷2 semester, pro-rata elapsed)
//   - customer : distinct customer bertransaksi ÷ sales_target_am.target_customer (÷2, TANPA pro-rata)
//   - ar       : proxy umur `tanggal` >45 hari (accurate_invoice tak punya due_date)
//   - crm      : compliance sales_plan (realisasi, coverage faskes, customer baru, ketepatan waktu)
// KSO/GP/Coaching belum punya tabel sumber di sistem → SELALU available:false.

import { db } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import {
  ageCutoff, elapsedFraction, ASPECT_ORDER, ASPECT_LABEL, DEFAULT_BOBOT,
  type AspectInput, type AspectKey, type NPKResult,
} from "../lib/npk-calc.js";
import { calcNpkSk } from "../lib/npk-sk.js";
import {
  isGolongan, targetCustomerSemester, targetNewCustomerSemester, type Golongan,
} from "../lib/npk-golongan.js";
import { semesterRange, type Period } from "./npk.js";
import type { DataScope } from "./access-scope.js";
import { isAmRole } from "./access-scope.js";

export interface AmSubject {
  am_id: string; nama: string; panggilan: string | null; cabang: string | null;
  golongan: Golongan | null; // SK Pasal 2.1 — penentu target customer & new-customer
}

// Roster AM yang di-skor: master_user aktif ber-role AM. Sumber yang sama dipakai
// scope (access-scope.isAmRole) supaya "siapa yang di-skor" = "siapa yang di-scope".
export async function listAmSubjects(sql: ReturnType<typeof db>): Promise<AmSubject[]> {
  const rows = await sql<{ am_id: string; nama: string | null; panggilan: string | null; cabang: string | null; role: string | null; golongan: string | null }[]>`
    SELECT am_id, nama, panggilan, NULLIF(cabang,'') AS cabang, role, golongan
    FROM master_user WHERE aktif IS NOT FALSE AND am_id IS NOT NULL
    ORDER BY nama NULLS LAST, am_id`;
  return rows
    .filter((r) => isAmRole(r.role))
    .map((r) => ({
      am_id: String(r.am_id),
      nama: r.nama || String(r.am_id),
      panggilan: r.panggilan ? String(r.panggilan) : null,
      cabang: r.cabang ? String(r.cabang) : null,
      golongan: isGolongan(r.golongan) ? r.golongan : null,
    }));
}

export interface GatherAmResult {
  input: AspectInput;
  avail: Partial<Record<AspectKey, boolean>>;
  meta: Record<string, unknown>; // → computed_from (audit + flag stub/proxy)
}

// Kumpulkan input 7 aspek untuk satu AM pada satu semester.
async function gatherAmInput(
  sql: ReturnType<typeof db>,
  am: AmSubject,
  year: number,
  period: Period,
  now: Date,
): Promise<GatherAmResult> {
  const { from, to } = semesterRange(year, period);
  const elapsed = elapsedFraction(from, to, now);
  const input: AspectInput = {
    revenue_actual: 0, revenue_target: 0,
    customer_active_count: 0, customer_target: 0,
    ar_over_45d: 0, ar_total: 0,
    kso_active: 0, kso_target: 0, kso_expired_no_renewal: 0,
    gp_actual: 0, gp_target: 0,
    call_coverage_pct: 0, area_coverage_pct: 0, new_cust_rate_pct: 0, timeliness_pct: 0,
    coaching_score: 0,
  };
  // Belum ada sumber data di sistem → selalu stub (bukan skor 0 yang dianggap nyata).
  const avail: Partial<Record<AspectKey, boolean>> = { kso: false, gp: false, coaching: false };
  const stubbed: AspectKey[] = ["kso", "gp", "coaching"];

  // ── Revenue + Customer aktif (faktur Accurate ter-atribusi ke AM ini) ──
  const [rev] = await sql`
    SELECT COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)),0)::float8 AS revenue,
           count(DISTINCT ai.customer_id)::int AS customers
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id = ${am.am_id}`;
  input.revenue_actual = Number(rev?.revenue ?? 0);
  input.customer_active_count = Number(rev?.customers ?? 0);

  // Target revenue & customer per AM (tahunan) → ÷2 untuk semester.
  const [tgt] = await sql<{ target: number; target_customer: number }[]>`
    SELECT COALESCE(target,0)::float8 AS target, COALESCE(target_customer,0)::float8 AS target_customer
    FROM sales_target_am WHERE year = ${year} AND am_id = ${am.am_id}`;
  const revTargetSemester = Number(tgt?.target ?? 0) / 2;
  // Revenue DI-PRO-RATA ke porsi semester yang sudah berjalan (FLOW — actual juga
  // baru terkumpul sampai hari ini). Pola identik jalur HoD.
  input.revenue_target = revTargetSemester * elapsed;

  // Target customer: SK Pasal 3.1 baris 2 bilang "target per level golongan", jadi
  // GOLONGAN yang kanonik (Pasal 2.1: AM-0 10 · AM-1 20 · AM-2 28 · AM-3 35 · AM-4 45).
  // `sales_target_am.target_customer` tetap dihormati sebagai OVERRIDE manual bila
  // diisi >0 — dipakai untuk AM yang targetnya memang disepakati beda dari levelnya.
  // Customer TIDAK di-pro-rata (STOCK, front-loaded) — lihat catatan panjang di repo/npk.ts.
  const custOverride = Number(tgt?.target_customer ?? 0);
  const custDariGolongan = targetCustomerSemester(am.golongan);
  const custTargetSemester = custOverride > 0 ? custOverride : (custDariGolongan ?? 0);
  input.customer_target = custTargetSemester;

  // ── AR: outstanding OPEN milik AM ini + proxy >45 hari dari umur `tanggal` ──
  const cut45 = ageCutoff(to, now, 45);
  const [ar] = await sql`
    SELECT COALESCE(sum(ai.total),0)::float8 AS ar_total,
           COALESCE(sum(ai.total) FILTER (WHERE ai.tanggal < ${cut45}),0)::float8 AS ar_over45
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' AND mu.am_id = ${am.am_id}`;
  input.ar_total = Number(ar?.ar_total ?? 0);
  input.ar_over_45d = Number(ar?.ar_over45 ?? 0);

  // ── CRM/Presales dari sales_plan (F3 DSPR + F16 Visit) ──
  // Empat sub-metrik; tiga pertama berskala 0-10, `timeliness` 0-100 — itu skala
  // yang diharapkan rawScores() di npk-calc.ts (lihat kasus uji SK Pasal 3.5:
  // 8/7/6/80 → (80+70+60+80)/4 = 72,5). Jangan kirim persen mentah ke tiga yang pertama.
  // Baris tanpa customer_name TETAP dihitung untuk realisasi & ketepatan waktu —
  // dua metrik itu tak butuh nama faskes. Hanya metrik berbasis faskes (coverage
  // & customer baru) yang menyaringnya lewat NULLIF di dalam count(DISTINCT …).
  // Menyaring di WHERE (versi awal) bikin SELURUH aspek CRM nol pada AM yang plan-nya
  // tak ber-nama-customer, seolah dia tak pernah kunjungan.
  const [plan] = await sql<{
    total: number; reported: number; on_time: number;
    cust_planned: number; cust_visited: number; cust_new: number;
  }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE sp.reported)::int AS reported,
           count(*) FILTER (WHERE NOT sp.is_late_plan)::int AS on_time,
           count(DISTINCT NULLIF(sp.customer_name,''))::int AS cust_planned,
           count(DISTINCT NULLIF(sp.customer_name,'')) FILTER (WHERE sp.reported)::int AS cust_visited,
           count(DISTINCT NULLIF(sp.customer_name,'')) FILTER (
             WHERE sp.reported AND NOT EXISTS (
               SELECT 1 FROM sales_plan prev
               WHERE prev.am_id = sp.am_id AND prev.customer_name = sp.customer_name
                 AND prev.tanggal < ${from}))::int AS cust_new
    FROM sales_plan sp
    WHERE sp.am_id = ${am.am_id} AND sp.tanggal BETWEEN ${from} AND ${to}`;
  const planTotal = Number(plan?.total ?? 0);
  const custPlanned = Number(plan?.cust_planned ?? 0);
  const custNew = Number(plan?.cust_new ?? 0);
  const ratio10 = (num: number, den: number): number => (den > 0 ? Math.min(10, (num / den) * 10) : 0);
  input.call_coverage_pct = ratio10(Number(plan?.reported ?? 0), planTotal);
  input.area_coverage_pct = ratio10(Number(plan?.cust_visited ?? 0), custPlanned);
  // New Customer Rate: penyebutnya TARGET per golongan (SK Tabel 6: Jr=1, Sr=2,
  // Region=3 per bulan → ×6 utk semester), bukan jumlah faskes yang kebetulan
  // direncanakan. Tanpa golongan, jatuh balik ke penyebut lama (proxy).
  const targetNew = targetNewCustomerSemester(am.golongan);
  input.new_cust_rate_pct = targetNew ? ratio10(custNew, targetNew) : ratio10(custNew, custPlanned);
  input.timeliness_pct = planTotal > 0 ? (Number(plan?.on_time ?? 0) / planTotal) * 100 : 0;

  // Aspek butuh denominator untuk bisa di-skor; tanpa itu → available:false.
  avail.revenue = input.revenue_target > 0;
  avail.customer = input.customer_target > 0;
  avail.ar = input.ar_total > 0;
  avail.crm = planTotal > 0;

  const stubbedNow = [...stubbed];
  for (const k of ["revenue", "customer", "ar", "crm"] as AspectKey[]) if (!avail[k]) stubbedNow.push(k);

  return {
    input,
    avail,
    meta: {
      am_id: am.am_id,
      nama: am.nama,
      cabang: am.cabang,
      golongan: am.golongan,
      scoring: "sk_tabel_3_2",   // penanda metode: tabel berjenjang SK, bukan linier
      range: { from, to },
      elapsed_pct: Math.round(elapsed * 1000) / 10,
      revenue_actual: input.revenue_actual,
      revenue_target_year: Number(tgt?.target ?? 0),
      revenue_target_semester: revTargetSemester,       // target semester PENUH (audit SK)
      revenue_target_prorata: input.revenue_target,     // yang dipakai men-skor
      customer_active_count: input.customer_active_count,
      customer_target_semester: custTargetSemester,     // dipakai men-skor apa adanya (stock)
      customer_target_sumber: custOverride > 0 ? "override_sales_target_am" : (custDariGolongan ? "golongan_sk_2_1" : "tidak_ada"),
      customer_target_golongan: custDariGolongan,
      customer_target_override: custOverride > 0 ? custOverride : null,
      customer_target_missing: input.customer_target <= 0,
      crm_new_customer_target: targetNew,
      ar_total: input.ar_total,
      ar_over_45d: input.ar_over_45d,
      ar_over45_proxy: true,                            // umur `tanggal`, bukan due_date
      ar_cutoff: cut45,
      crm_plan_total: planTotal,
      crm_plan_reported: Number(plan?.reported ?? 0),
      crm_plan_on_time: Number(plan?.on_time ?? 0),
      crm_customer_planned: custPlanned,
      crm_customer_visited: Number(plan?.cust_visited ?? 0),
      crm_customer_new: Number(plan?.cust_new ?? 0),
      stubbed: stubbedNow,
    },
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Compute batch NPK semua AM untuk satu semester. Idempoten (upsert + replace aspek).
export async function computeNpkAm(opts: { year: number; period: Period; now?: Date }): Promise<{ computed: number; year: number; period: Period }> {
  const sql = db();
  const { year, period } = opts;
  const now = opts.now ?? new Date();
  const subjects = await listAmSubjects(sql);
  let computed = 0;
  for (const am of subjects) {
    const g = await gatherAmInput(sql, am, year, period, now);
    // Tabel berjenjang SK Pasal 3.2 — BUKAN calcNPK() linier yang dipakai jalur HoD.
    // Konsekuensi yang disengaja: selama jalur HoD belum ikut pindah, angka NPK AM
    // dan NPK HoD memakai metode berbeda dan tidak sebanding. Lihat lib/npk-sk.ts.
    const res: NPKResult = calcNpkSk(g.input, g.avail);
    await sql`
      INSERT INTO npk_am_score_semester (am_id, year, period, npk, predikat, computed_from, computed_at)
      VALUES (${am.am_id}, ${year}, ${period}, ${res.npk}, ${res.predikat}, ${sql.json(g.meta as Parameters<typeof sql.json>[0])}, now())
      ON CONFLICT (am_id, year, period) DO UPDATE
        SET npk = EXCLUDED.npk, predikat = EXCLUDED.predikat,
            computed_from = EXCLUDED.computed_from, computed_at = now()`;
    await sql`DELETE FROM npk_am_aspect_score WHERE am_id = ${am.am_id} AND year = ${year} AND period = ${period}`;
    for (const a of res.aspects) {
      await sql`
        INSERT INTO npk_am_aspect_score (am_id, year, period, aspect, raw, capped, weight, contribution, available)
        VALUES (${am.am_id}, ${year}, ${period}, ${a.key},
                ${round2(a.raw)}, ${round2(a.capped)}, ${a.bobot}, ${round2(a.contribution)}, ${a.available})`;
    }
    computed += 1;
  }
  return { computed, year, period };
}

// ── Baca (scope-aware) ────────────────────────────────────────────

export interface NpkAmRow {
  am_id: string; am_name: string; panggilan: string | null; cabang: string | null;
  npk: number; predikat: string;
  available_count: number;
  aspects: Record<AspectKey, { capped: number | null; available: boolean }>;
  computed_at: string | null;
}

// Siapa yang boleh dilihat scope ini — INI aturan role yang diminta:
//   admin/superuser → semua AM
//   HoD (hod_key)   → semua AM (keputusan pemilik produk: HoD melihat seluruh
//                     sales, bukan hanya cabang timnya — beda dari scope Visits/AR
//                     yang dibatasi hod_territory)
//   staff AM        → HANYA dirinya sendiri
//   selain itu      → kosong (NPK = data HR, default tertutup)
export function visibleAms(scope: DataScope | undefined): string[] | "all" {
  if (!scope) return "all"; // tanpa identitas (mis. panggilan service-token) → tak dibatasi
  if (scope.superuser) return "all";
  if (scope.hodKey) return "all";
  if (scope.amOnly && scope.amId) return [scope.amId];
  return [];
}

export async function getNpkAmScores(scope: DataScope | undefined, year: number, period: Period) {
  const sql = db();
  const vis = visibleAms(scope);
  const subjects = await listAmSubjects(sql);
  const allowed = vis === "all" ? subjects : subjects.filter((s) => vis.includes(s.am_id));

  const heads = await sql<{ am_id: string; npk: number; predikat: string; computed_at: string | null }[]>`
    SELECT am_id, npk::float8 AS npk, predikat, computed_at::text AS computed_at
    FROM npk_am_score_semester WHERE year = ${year} AND period = ${period}`;
  const headByAm = Object.fromEntries(heads.map((h) => [h.am_id, h]));

  const aspRows = await sql<{ am_id: string; aspect: AspectKey; capped: number | null; available: boolean }[]>`
    SELECT am_id, aspect, capped::float8 AS capped, available
    FROM npk_am_aspect_score WHERE year = ${year} AND period = ${period}`;
  const aspByAm: Record<string, Record<string, { capped: number | null; available: boolean }>> = {};
  for (const a of aspRows) {
    (aspByAm[a.am_id] ??= {})[a.aspect] = { capped: a.capped == null ? null : Number(a.capped), available: a.available };
  }

  const rows: NpkAmRow[] = allowed.map((s) => {
    const head = headByAm[s.am_id];
    const asp = aspByAm[s.am_id] ?? {};
    const aspects = Object.fromEntries(
      ASPECT_ORDER.map((k) => [k, asp[k] ?? { capped: null, available: false }]),
    ) as Record<AspectKey, { capped: number | null; available: boolean }>;
    return {
      am_id: s.am_id,
      am_name: s.nama,
      panggilan: s.panggilan,
      cabang: s.cabang,
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

export interface NpkAmAspectRow {
  key: AspectKey; label: string; weight: number;
  raw: number | null; capped: number | null; contribution: number | null; available: boolean;
}

// Detail 1 AM. `ref` = master_user.am_id ATAU app_user.id (UUID, dari halaman self).
// 403 bila scope tak mengizinkan AM tsb (staff AM buka AM lain).
export async function getNpkAmDetail(scope: DataScope | undefined, ref: string, year: number, period: Period) {
  const sql = db();
  const subjects = await listAmSubjects(sql);

  // Resolusi ref → am_id. Cek am_id dulu; app_user hanya bila ref berbentuk UUID
  // (app_user.id bertipe uuid → cast non-UUID melempar error di Postgres).
  let amId: string | null = subjects.some((s) => s.am_id === ref) ? ref : null;
  if (!amId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const [byUser] = await sql<{ am_id: string | null }[]>`SELECT am_id FROM app_user WHERE id = ${ref}`;
    if (byUser?.am_id) amId = String(byUser.am_id);
  }
  if (!amId) throw Object.assign(new Error("AM tidak ditemukan"), { status: 404 });

  const vis = visibleAms(scope);
  if (vis !== "all" && !vis.includes(amId)) {
    throw Object.assign(new Error("Anda hanya boleh membuka NPK sendiri"), { status: 403 });
  }

  const subj = subjects.find((s) => s.am_id === amId);
  const [head] = await sql<{ npk: number; predikat: string; computed_from: unknown; computed_at: string | null }[]>`
    SELECT npk::float8 AS npk, predikat, computed_from, computed_at::text AS computed_at
    FROM npk_am_score_semester WHERE am_id = ${amId} AND year = ${year} AND period = ${period}`;
  const asp = await sql<{ aspect: AspectKey; raw: number | null; capped: number | null; weight: number; contribution: number | null; available: boolean }[]>`
    SELECT aspect, raw::float8 AS raw, capped::float8 AS capped, weight, contribution::float8 AS contribution, available
    FROM npk_am_aspect_score WHERE am_id = ${amId} AND year = ${year} AND period = ${period}`;
  const aspByKey = Object.fromEntries(asp.map((a) => [a.aspect, a]));

  const aspects: NpkAmAspectRow[] = ASPECT_ORDER.map((k) => {
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
    am_id: amId,
    am_name: subj?.nama ?? amId,
    cabang: subj?.cabang ?? null,
    role: "AM",
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
