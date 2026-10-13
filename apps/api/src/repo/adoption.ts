// F58 AI Champion / Training Adoption Tracker — pemakaian fitur per user.
//
// Dua bagian di berkas ini, sengaja dipisah:
//   1. LOGIKA MURNI (resolvePeriod, audienceOf, classifyAdoption) — tanpa DB, diuji di adoption.test.ts.
//   2. AKSES DB (recordUsage, getAdoption) — merakit data lalu menyerahkannya ke (1).
//
// Aturan bisnis (Direktur, 2026-10-13):
//   - Hanya untuk adopsi & training; BUKAN KPI/NPK.
//   - view & action dicatat terpisah; champion/laggard dinilai dari ACTION saja.
//   - Dibanding sesama jabatan yang berizin fitur itu (bukan seluruh perusahaan).
//   - Laggard = berizin tapi action nol/sangat jarang. Yang tak berizin tak pernah dihitung.
//   - Admin/superuser/Direktur lihat semua; HoD hanya timnya (cabangScope). Lainnya ditolak.
//   - Mulai dari nol saat aktif, tanpa backfill.

import { db } from "../db.js";
import { scopeOnClause, type DataScope } from "./access-scope.js";

// ── Konstanta (jangan hardcode di tengah kode) ─────────────────────────────────
export const ADOPTION_FEATURE_KEY = "adoption"; // = featureKey("/adoption"); tak menilai dirinya sendiri
export const USAGE_KINDS = ["view", "action"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const VIEW_THROTTLE_MINUTES = 30; // 1 event view per (user, fitur) per jendela ini
export const LAGGARD_MAX_ACTIONS = 2; // ≤ ini per periode = "sangat jarang"
export const CHAMPION_PERCENTILE = 75;
export const MIN_PEERS = 3; // di bawah ini tanpa label champion
export const GRACE_DAYS = 14; // akun baru tidak langsung dicap laggard
export const MIN_TRACKING_DAYS = 7; // data < ini → laggard belum dinilai
export const LIST_LIMIT_DEFAULT = 200;
export const LIST_LIMIT_MAX = 500;
const NO_TITLE = "(tanpa jabatan)";
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export class AdoptionError extends Error {
  constructor(message: string, public status: 400 | 403 | 503 = 400, public field?: string) {
    super(message);
  }
}

// ── 1. Logika murni ───────────────────────────────────────────────────────────

export interface Period { kind: "month" | "rolling30"; from: string; to: string; label: string; month: string | null } // [from, to) tanggal WIB

const RE_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Periode dari query. `today` = tanggal WIB hari ini (YYYY-MM-DD), disuntik agar bisa diuji. */
export function resolvePeriod(period: string | null | undefined, month: string | null | undefined, today: string): Period {
  const p = (period ?? "month").trim() || "month";
  if (p !== "month" && p !== "rolling30") throw new AdoptionError("period harus month atau rolling30", 400, "period");
  const t = new Date(`${today}T00:00:00Z`);
  if (p === "rolling30") {
    const from = new Date(t); from.setUTCDate(from.getUTCDate() - 29);
    const to = new Date(t); to.setUTCDate(to.getUTCDate() + 1);
    return { kind: "rolling30", from: ymd(from), to: ymd(to), label: "30 hari terakhir", month: null };
  }
  const m = (month ?? "").trim() || today.slice(0, 7);
  const mm = RE_MONTH.exec(m);
  if (!mm) throw new AdoptionError("month harus berformat YYYY-MM", 400, "month");
  if (m > today.slice(0, 7)) throw new AdoptionError("month tidak boleh di masa depan", 400, "month");
  const from = new Date(Date.UTC(Number(mm[1]), Number(mm[2]) - 1, 1));
  const to = new Date(Date.UTC(Number(mm[1]), Number(mm[2]), 1));
  return { kind: "month", from: ymd(from), to: ymd(to), label: m, month: m };
}

export type Audience = "all" | "team";

/** Siapa boleh membaca. null = ditolak. HoD tanpa cabangScope DITOLAK (bukan "lihat semua"):
 *  resolveScope mengembalikan scope penuh untuk HoD tanpa territory — itu jebakan untuk gate baca. */
export function audienceOf(s: DataScope): Audience | null {
  if (!s.userId) return null;
  const role = String(s.role ?? "").trim().toLowerCase();
  if (s.superuser || role === "admin" || role === "direktur") return "all";
  if (s.cabangScope && s.cabangScope.length) return "team";
  return null;
}

export type AdoptionLabel = "champion" | "laggard" | "normal" | "baru";

export interface AdoptionInput {
  user_id: string; title: string; feature_key: string; actions: number; views: number; grace: boolean;
}
export interface AdoptionClassified extends AdoptionInput { label: AdoptionLabel; peer_size: number }

/** Nilai ambang persentil-p dari array terurut naik: peringkat floor(p% × n)+1, sehingga
 *  "≥ ambang" kira-kira p% teratas (4 peer → 1 orang, 8 peer → 2 orang), bukan separuhnya. */
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const rank = Math.floor((p / 100) * sortedAsc.length) + 1;
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

/** Beri label per (user, fitur). Peer = sesama jabatan pada fitur yang sama, tanpa akun masa tenggang.
 *  - baru     : akun < GRACE_DAYS → tak dihitung (juga tak ikut statistik peer)
 *  - laggard  : actions ≤ LAGGARD_MAX_ACTIONS (nol termasuk). Tak butuh peer — "berizin tapi nyaris tak memakai".
 *  - champion : peer ≥ MIN_PEERS, actions > LAGGARD_MAX, ≥ persentil-75 peer, dan peer tidak seragam. */
export function classifyAdoption(rows: AdoptionInput[]): AdoptionClassified[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.grace) continue;
    const k = `${r.feature_key}\u0000${r.title}`;
    const arr = groups.get(k) ?? [];
    arr.push(r.actions);
    groups.set(k, arr);
  }
  const stats = new Map<string, { size: number; p: number; uniform: boolean }>();
  for (const [k, arr] of groups) {
    const sorted = [...arr].sort((a, b) => a - b);
    stats.set(k, { size: sorted.length, p: percentile(sorted, CHAMPION_PERCENTILE), uniform: sorted[0] === sorted[sorted.length - 1] });
  }
  return rows.map((r) => {
    if (r.grace) return { ...r, label: "baru", peer_size: 0 };
    const st = stats.get(`${r.feature_key}\u0000${r.title}`)!;
    let label: AdoptionLabel = "normal";
    if (r.actions <= LAGGARD_MAX_ACTIONS) label = "laggard";
    else if (st.size >= MIN_PEERS && !st.uniform && r.actions >= st.p) label = "champion";
    return { ...r, label, peer_size: st.size };
  });
}

// ── 2. Akses DB ───────────────────────────────────────────────────────────────

const wibToday = (): string => new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);

export interface RecordResult { recorded: boolean; reason?: "throttled" | "unknown_user_or_feature" }

/** Catat satu event. user_id HARUS dari sesi (BFF → x-user-id), bukan dari body.
 *  Satu statement: validasi user aktif + fitur aktif, dan throttle view, semua di SQL. */
export async function recordUsage(userId: string, featureKey: string, kind: string): Promise<RecordResult> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new AdoptionError("user tidak valid", 403, "user_id");
  if (!(USAGE_KINDS as readonly string[]).includes(kind)) throw new AdoptionError("kind harus view atau action", 400, "kind");
  const key = featureKey.trim();
  if (!key || key.length > 80 || key === ADOPTION_FEATURE_KEY) throw new AdoptionError("feature_key tidak valid", 400, "feature_key");
  const sql = db();
  const rows = await sql`
    INSERT INTO feature_usage_event (user_id, feature_key, kind)
    SELECT u.id, f.key, ${kind}
    FROM app_user u, feature f
    WHERE u.id = ${userId} AND u.active AND f.key = ${key} AND f.active
      AND (${kind} <> 'view' OR NOT EXISTS (
        SELECT 1 FROM feature_usage_event e
        WHERE e.user_id = u.id AND e.feature_key = f.key AND e.kind = 'view'
          AND e.occurred_at > now() - make_interval(mins => ${VIEW_THROTTLE_MINUTES}::int)))
    RETURNING id`;
  if (rows.length) return { recorded: true };
  const [ok] = await sql`
    SELECT 1 FROM app_user u, feature f WHERE u.id = ${userId} AND u.active AND f.key = ${key} AND f.active`;
  return ok ? { recorded: false, reason: "throttled" } : { recorded: false, reason: "unknown_user_or_feature" };
}

export interface AdoptionRow extends AdoptionClassified {
  feature_name: string; name: string | null; email: string; cabang: string | null; on_leave: boolean;
}
export interface FeatureSummary {
  feature_key: string; feature_name: string; eligible: number; champions: number; laggards: number; baru: number;
  actions: number; views: number; top: string[];
}
export interface AdoptionResult {
  empty: boolean; insufficient: boolean; partial: boolean; tracking_since: string | null;
  period: Period; audience: Audience; rows: AdoptionRow[];
}

export interface AdoptionFilter { feature?: string | null; title?: string | null; q?: string | null }

/** Semua (user × fitur) yang berizin AKSI menurut matriks Akses Grup, dengan hitungan event periode itu.
 *  Superuser dikecualikan (bypass matriks → tak ada "hak" yang bisa dibandingkan). User nonaktif keluar.
 *  Scope HoD ditempel lewat scopeOnClause (satu definisi dgn repo lain). */
export async function getAdoption(scope: DataScope, p: Period, f: AdoptionFilter = {}): Promise<AdoptionResult> {
  const audience = audienceOf(scope);
  if (!audience) throw new AdoptionError("tidak berwenang", 403);
  // Audience 'all' = tanpa batas baris, walau akunnya sendiri berperan AM (amOnly) — ini gerbang baca tracker, bukan data sales.
  const rowScope: DataScope = audience === "all" ? { ...scope, amOnly: false, cabangScope: null } : scope;
  const sql = db();
  const [meta] = await sql`SELECT min(occurred_at)::text AS since FROM feature_usage_event`;
  const trackingSince = meta?.since ? String(meta.since) : null;
  const base = { period: p, audience, tracking_since: trackingSince };
  if (!trackingSince) return { ...base, empty: true, insufficient: true, partial: true, rows: [] };

  const fromTs = sql`(${p.from}::date)::timestamp AT TIME ZONE 'Asia/Jakarta'`;
  const toTs = sql`(${p.to}::date)::timestamp AT TIME ZONE 'Asia/Jakarta'`;
  const today = wibToday();
  const feat = f.feature?.trim() || null;
  const title = f.title?.trim() || null;
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;

  const rows = await sql`
    SELECT u.id::text AS user_id, u.email, u.name,
           COALESCE(NULLIF(btrim(u.title), ''), ${NO_TITLE}) AS title,
           NULLIF(btrim(mu.cabang), '') AS cabang,
           ap.feature_key, ft.name AS feature_name,
           COALESCE(ev.actions, 0)::int AS actions, COALESCE(ev.views, 0)::int AS views,
           (u.created_at > now() - make_interval(days => ${GRACE_DAYS}::int)) AS grace,
           EXISTS (SELECT 1 FROM user_leave l WHERE l.am_id = u.am_id AND ${today}::date BETWEEN l.start_date AND l.end_date) AS on_leave
    FROM app_user u
    JOIN app_user_group ug ON ug.user_id = u.id
    JOIN access_permission ap ON ap.group_id = ug.group_id
    JOIN feature ft ON ft.key = ap.feature_key AND ft.active
    LEFT JOIN master_user mu ON mu.am_id = u.am_id
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.kind = 'action') AS actions, count(*) FILTER (WHERE e.kind = 'view') AS views
      FROM feature_usage_event e
      WHERE e.user_id = u.id AND e.feature_key = ap.feature_key AND e.occurred_at >= ${fromTs} AND e.occurred_at < ${toTs}
    ) ev ON true
    WHERE u.active AND ap.feature_key <> ${ADOPTION_FEATURE_KEY}
      AND NOT EXISTS (SELECT 1 FROM app_user_group sg JOIN access_group sag ON sag.id = sg.group_id
                      WHERE sg.user_id = u.id AND sag.superuser)
      ${scopeOnClause(sql, rowScope, sql`u.am_id`, sql`NULLIF(mu.cabang,'')`)}
    GROUP BY u.id, u.email, u.name, u.title, u.created_at, u.am_id, mu.cabang, ap.feature_key, ft.name, ev.actions, ev.views
    HAVING bool_or(ap.active AND ap.can_view AND (ap.can_create OR ap.can_edit OR ap.can_delete))
    ORDER BY ft.name, u.name`;

  const meta2 = new Map<string, { feature_name: string; name: string | null; email: string; cabang: string | null; on_leave: boolean }>();
  const inputs: AdoptionInput[] = rows.map((r) => {
    meta2.set(`${r.user_id}\u0000${r.feature_key}`, {
      feature_name: String(r.feature_name), name: r.name ? String(r.name) : null, email: String(r.email),
      cabang: r.cabang ? String(r.cabang) : null, on_leave: r.on_leave === true,
    });
    return { user_id: String(r.user_id), title: String(r.title), feature_key: String(r.feature_key), actions: Number(r.actions), views: Number(r.views), grace: r.grace === true };
  });
  // Filter dipasang SETELAH klasifikasi: peer harus dihitung dari semua yang berizin, bukan dari hasil saring.
  let out: AdoptionRow[] = classifyAdoption(inputs).map((c) => ({ ...c, ...meta2.get(`${c.user_id}\u0000${c.feature_key}`)! }));
  if (feat) out = out.filter((r) => r.feature_key === feat);
  if (title) out = out.filter((r) => r.title === title);
  if (q) {
    const needle = q.replace(/%/g, "").toLowerCase();
    out = out.filter((r) => `${r.name ?? ""} ${r.email}`.toLowerCase().includes(needle));
  }

  const sinceMs = Date.parse(trackingSince);
  const trackingDays = Number.isFinite(sinceMs) ? Math.floor((Date.now() - sinceMs) / 86400000) : 0;
  const insufficient = trackingDays < MIN_TRACKING_DAYS;
  const partial = Date.parse(`${p.from}T00:00:00+07:00`) < sinceMs;
  // Data pemakaian belum cukup → jangan cap siapa pun laggard (hari pertama semua orang "nol action").
  if (insufficient) out = out.map((r) => (r.label === "laggard" ? { ...r, label: "normal" as const } : r));
  return { ...base, empty: false, insufficient, partial, rows: out };
}

export function summarizeByFeature(rows: AdoptionRow[]): FeatureSummary[] {
  const m = new Map<string, FeatureSummary>();
  for (const r of rows) {
    const s = m.get(r.feature_key) ?? { feature_key: r.feature_key, feature_name: r.feature_name, eligible: 0, champions: 0, laggards: 0, baru: 0, actions: 0, views: 0, top: [] };
    s.eligible++; s.actions += r.actions; s.views += r.views;
    if (r.label === "champion") { s.champions++; s.top.push(r.name ?? r.email); }
    else if (r.label === "laggard") s.laggards++;
    else if (r.label === "baru") s.baru++;
    m.set(r.feature_key, s);
  }
  return [...m.values()].map((s) => ({ ...s, top: s.top.slice(0, 3) })).sort((a, b) => b.laggards - a.laggards || a.feature_name.localeCompare(b.feature_name));
}

/** Daftar "perlu training": laggard saja, yang paling parah (action terendah) dulu; yang sedang cuti ditandai bukan dibuang. */
export function trainingNeeds(rows: AdoptionRow[], limit: number): AdoptionRow[] {
  const cap = Math.min(LIST_LIMIT_MAX, Math.max(1, Math.floor(limit) || LIST_LIMIT_DEFAULT));
  return rows.filter((r) => r.label === "laggard").sort((a, b) => a.actions - b.actions || a.feature_name.localeCompare(b.feature_name) || String(a.name).localeCompare(String(b.name))).slice(0, cap);
}
