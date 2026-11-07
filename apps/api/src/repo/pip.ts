// F70 Performance Improvement Plan (PIP) 90-Day Tracker — migrasi 236.
//
// Dua bagian, sengaja dipisah (pola onboarding.ts / F56):
//   1. LOGIKA MURNI (periode, delta skor, tanggal, parser input) — tanpa DB, diuji di pip.test.ts.
//   2. AKSES DB — merakit data lalu menyerahkannya ke (1).
//
// Keputusan (tercatat di docs/features/F70-pip-tracker.md):
//   - Employee (tabel `employee`) = pusat relasi. Raport 360 (master_user.am_id) dijembatani lewat
//     employee.am_id — SAMA dengan jembatan Karyawan 360. Tautan hanya lewat am_id eksplisit,
//     TANPA fallback kecocokan nama: salah orang di dokumen PIP jauh lebih mahal daripada "belum tertaut".
//   - Improvement = delta skor komposit Raport antar periode (getRaportList). TANPA ambang: yang
//     ditampilkan hanya selisih angkanya.
//   - PIP dibuka MANUAL; skor tidak memicu apa pun.
//   - Outcome graduate/extend/terminate dicatat oleh pengguna berizin — tanpa jenjang persetujuan.
//     extend = end_date baru yang diisi pengguna; tanpa batas jumlah/durasi.
//   - Akses = scope yang sudah ada (resolveScope), sama seperti /raport/*; menu & aksi tulis dijaga
//     BFF lewat izin fitur 'karyawan'. Tidak ada aturan akses baru.
//   - Jejak audit ke audit_log (append-only), satu transaksi dengan perubahan datanya.

import { createHash } from "node:crypto";
import { db } from "../db.js";
import type { DataScope } from "./access-scope.js";
import { getRaportList } from "./raport.js";

// ── Konstanta ────────────────────────────────────────────────────────────────
export const PIP_DURATION_DAYS = 90;
export const CASE_STATUS = ["aktif", "graduate", "terminate"] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];
export const OUTCOMES = ["graduate", "extend", "terminate"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const MILESTONE_STATUS = ["belum", "tercapai", "tidak_tercapai"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];

export const DEFAULT_PERIOD_COUNT = 4;
export const MAX_PERIOD_COUNT = 8;
const MAX_ITEMS = 20;
const TEXT_MAX = 2000;
const SHORT_MAX = 300;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const AUDIT_USE_CASE = "F70";

export class PipError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 422,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

// ── 1. Logika murni ──────────────────────────────────────────────────────────

export const wibDate = (now = Date.now()): string => new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);

// Date.parse dulu: bulan/hari mustahil (2026-13-01) menghasilkan Invalid Date, dan toISOString() melempar RangeError.
export const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** ISO date + N hari (kalender UTC, tanpa efek zona waktu). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Minggu ke-N sejak start (hari 0–6 = minggu 1). Tanggal sebelum start → 0 (ditolak pemanggil). */
export function weekNo(start: string, date: string): number {
  const d = daysBetween(start, date);
  return d < 0 ? 0 : Math.floor(d / 7) + 1;
}

/** Sisa hari sampai end_date (negatif = lewat). */
export const daysLeft = (end: string, today: string): number => daysBetween(today, end);

/** N kuartal terakhir berakhir di kuartal berjalan, urut lama → baru (format raport 'YYYY-Qn'). */
export function recentQuarters(today: string, n = DEFAULT_PERIOD_COUNT): string[] {
  let y = Number(today.slice(0, 4));
  let q = Math.ceil(Number(today.slice(5, 7)) / 3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-Q${q}`);
    if (--q === 0) { q = 4; y -= 1; }
  }
  return out;
}

const PERIOD_RE = /^\d{4}-(Q[1-4]|H[12]|0[1-9]|1[0-2])$|^\d{4}$/;

/** Parse `?periods=a,b,c` (urutan lama → baru). Kosong → kuartal terakhir. Tak sah/terlalu banyak → 400. */
export function parsePeriods(raw: string | null | undefined, today: string): string[] {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return recentQuarters(today);
  if (list.length > MAX_PERIOD_COUNT) throw new PipError(400, `periods maksimal ${MAX_PERIOD_COUNT}`, "periods");
  for (const p of list) if (!PERIOD_RE.test(p)) throw new PipError(400, `periode tidak valid: ${p}`, "periods");
  return [...new Set(list)];
}

export interface ScorePoint { period: string; overall: number | null; delta: number | null }

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Delta tiap periode = skor − skor periode sebelumnya (urutan masukan). null bila salah satunya tak ada.
 *  Sengaja TANPA label membaik/memburuk atau ambang — hanya selisih angka. */
export function buildSeries(periods: string[], scores: Map<string, number | null>): ScorePoint[] {
  return periods.map((period, i) => {
    const cur = scores.get(period) ?? null;
    const prev = i > 0 ? (scores.get(periods[i - 1]) ?? null) : null;
    return { period, overall: cur, delta: cur != null && prev != null ? round2(cur - prev) : null };
  });
}

const clean = (v: unknown, max = TEXT_MAX): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

const required = (v: unknown, field: string, label: string, max = TEXT_MAX): string => {
  const s = clean(v, max);
  if (!s) throw new PipError(400, `${label} wajib diisi`, field);
  return s;
};

export interface GoalInput { goal: string; target: string | null }
export interface MilestoneInput { judul: string; due_date: string }

export function parseGoal(v: unknown): GoalInput {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { goal: required(o.goal, "goal", "goal", SHORT_MAX), target: clean(o.target, SHORT_MAX) };
}

export function parseMilestone(v: unknown, start: string): MilestoneInput {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (!isIsoDate(o.due_date)) throw new PipError(400, "due_date harus YYYY-MM-DD", "due_date");
  if (o.due_date < start) throw new PipError(400, "due_date tidak boleh sebelum tanggal mulai PIP", "due_date");
  return { judul: required(o.judul, "judul", "judul milestone", SHORT_MAX), due_date: o.due_date };
}

export interface OutcomeInput { outcome: Outcome; catatan: string; end_date: string | null }

/** Validasi outcome. extend WAJIB end_date baru (> end_date sekarang) — angkanya dari pengguna, tanpa batas bawaan. */
export function parseOutcome(b: Record<string, unknown>, currentEnd: string): OutcomeInput {
  if (!OUTCOMES.includes(b.outcome as Outcome)) throw new PipError(400, `outcome harus salah satu: ${OUTCOMES.join(", ")}`, "outcome");
  const outcome = b.outcome as Outcome;
  const catatan = required(b.catatan, "catatan", "catatan outcome");
  if (outcome !== "extend") return { outcome, catatan, end_date: null };
  if (!isIsoDate(b.end_date)) throw new PipError(400, "end_date baru wajib diisi (YYYY-MM-DD) untuk extend", "end_date");
  if (b.end_date <= currentEnd) throw new PipError(400, "end_date baru harus setelah end_date saat ini", "end_date");
  return { outcome, catatan, end_date: b.end_date };
}

// ── 2. Akses DB ──────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;

/** Baca: scope yang sama dengan /raport/*. AM murni hanya boleh data dirinya (amId), selain itu 403. */
function assertRead(s: DataScope, amId: string | null): void {
  if (s.amOnly && (!amId || s.amId !== amId)) throw new PipError(403, "tidak berwenang");
}

/** Tulis: wajib identitas sesi (pelaku audit); AM murni & peran viewer tidak boleh menulis. */
function assertWrite(s: DataScope): void {
  if (!s.userId || s.amOnly || String(s.role ?? "").trim().toLowerCase() === "viewer") throw new PipError(403, "tidak berwenang");
}

// Tulis ke audit_log (002_governance, append-only) — pola F60: agent_id 'A3' dipinjam (FK wajib,
// F70 bukan agen LLM; baris agent_registry baru hanya untuk 1 FK = overengineering).
async function logAudit(tx: Sql, caseId: number, eventType: string, actor: string | null, payload: Record<string, unknown>, decision: string | null = null): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify({ eventType, caseId, payload })).digest("hex");
  await tx`
    INSERT INTO audit_log (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES (${AUDIT_USE_CASE}, ${`f70-case-${caseId}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash},
            ${tx.json({ case_id: caseId, ...payload } as unknown as Parameters<Sql["json"]>[0])}, ${actor}, ${decision})`;
}

export interface CaseRow {
  id: number; employee_id: string; am_id: string | null; nama: string; role: string | null; dept: string | null; cabang: string | null;
  start_date: string; end_date: string; status: CaseStatus; alasan: string; outcome_note: string | null;
  closed_at: string | null; created_by: string | null; created_at: string;
  days_left: number | null; goals: number; milestones: number; milestones_tercapai: number; checkins: number; last_checkin: string | null;
}
export interface GoalRow { id: number; goal: string; target: string | null; created_by: string | null; created_at: string }
export interface MilestoneRow {
  id: number; judul: string; due_date: string; status: MilestoneStatus; catatan: string | null;
  decided_by: string | null; decided_at: string | null; terlambat: boolean;
}
export interface CheckinRow { id: number; week_no: number; checkin_date: string; catatan: string; created_by: string | null; created_at: string }
export interface TimelineRow { event_type: string; actor: string | null; decision: string | null; payload: unknown; occurred_at: string }

const str = (v: unknown): string | null => (v == null ? null : String(v));

const CASE_SELECT = (sql: Sql) => sql`
  c.id, c.employee_id, e.am_id, e.nama, e.role, e.dept, e.cabang,
  c.start_date::text AS start_date, c.end_date::text AS end_date, c.status, c.alasan, c.outcome_note,
  c.closed_at::text AS closed_at, c.created_by, c.created_at::text AS created_at,
  (SELECT count(*)::int FROM pip_goal g WHERE g.case_id = c.id) AS goals,
  (SELECT count(*)::int FROM pip_milestone m WHERE m.case_id = c.id) AS milestones,
  (SELECT count(*)::int FROM pip_milestone m WHERE m.case_id = c.id AND m.status = 'tercapai') AS milestones_tercapai,
  (SELECT count(*)::int FROM pip_checkin k WHERE k.case_id = c.id) AS checkins,
  (SELECT max(k.checkin_date)::text FROM pip_checkin k WHERE k.case_id = c.id) AS last_checkin`;

const mapCase = (r: Record<string, unknown>, today: string): CaseRow => ({
  id: Number(r.id), employee_id: String(r.employee_id), am_id: str(r.am_id), nama: String(r.nama), role: str(r.role),
  dept: str(r.dept), cabang: str(r.cabang), start_date: String(r.start_date), end_date: String(r.end_date),
  status: r.status as CaseStatus, alasan: String(r.alasan), outcome_note: str(r.outcome_note), closed_at: str(r.closed_at),
  created_by: str(r.created_by), created_at: String(r.created_at),
  days_left: r.status === "aktif" ? daysLeft(String(r.end_date), today) : null,
  goals: Number(r.goals), milestones: Number(r.milestones), milestones_tercapai: Number(r.milestones_tercapai),
  checkins: Number(r.checkins), last_checkin: str(r.last_checkin),
});

export async function listCases(scope: DataScope, status: string | null, amId: string | null = null): Promise<CaseRow[]> {
  assertRead(scope, amId);
  const sql = db();
  const st = CASE_STATUS.includes(status as CaseStatus) ? status : null;
  const rows = await sql`
    SELECT ${CASE_SELECT(sql)} FROM pip_case c JOIN employee e ON e.id = c.employee_id
    WHERE true ${st ? sql`AND c.status = ${st}` : sql``} ${amId ? sql`AND e.am_id = ${amId}` : sql``}
    ORDER BY (c.status = 'aktif') DESC, c.start_date DESC, c.id DESC`;
  const today = wibDate();
  return rows.map((r) => mapCase(r, today));
}

export interface CaseDetail extends CaseRow {
  goal_list: GoalRow[]; milestone_list: MilestoneRow[]; checkin_list: CheckinRow[]; timeline: TimelineRow[];
}

export async function getCase(scope: DataScope, id: number): Promise<CaseDetail | null> {
  const sql = db();
  const today = wibDate();
  const [r] = await sql`SELECT ${CASE_SELECT(sql)} FROM pip_case c JOIN employee e ON e.id = c.employee_id WHERE c.id = ${id}`;
  if (!r) return null;
  assertRead(scope, str(r.am_id));
  const [goals, miles, checks, timeline] = await Promise.all([
    sql`SELECT id, goal, target, created_by, created_at::text AS created_at FROM pip_goal WHERE case_id = ${id} ORDER BY seq, id`,
    sql`SELECT id, judul, due_date::text AS due_date, status, catatan, decided_by, decided_at::text AS decided_at
        FROM pip_milestone WHERE case_id = ${id} ORDER BY due_date, id`,
    sql`SELECT id, week_no, checkin_date::text AS checkin_date, catatan, created_by, created_at::text AS created_at
        FROM pip_checkin WHERE case_id = ${id} ORDER BY checkin_date, id`,
    sql`SELECT event_type, human_actor, decision, payload, to_char(occurred_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS occurred_at FROM audit_log
        WHERE use_case_id = ${AUDIT_USE_CASE} AND correlation_id = ${`f70-case-${id}`} ORDER BY occurred_at, id`,
  ]);
  return {
    ...mapCase(r, today),
    goal_list: goals.map((g) => ({ id: Number(g.id), goal: String(g.goal), target: str(g.target), created_by: str(g.created_by), created_at: String(g.created_at) })),
    milestone_list: miles.map((m) => ({
      id: Number(m.id), judul: String(m.judul), due_date: String(m.due_date), status: m.status as MilestoneStatus, catatan: str(m.catatan),
      decided_by: str(m.decided_by), decided_at: str(m.decided_at), terlambat: m.status === "belum" && String(m.due_date) < today,
    })),
    checkin_list: checks.map((k) => ({
      id: Number(k.id), week_no: Number(k.week_no), checkin_date: String(k.checkin_date), catatan: String(k.catatan),
      created_by: str(k.created_by), created_at: String(k.created_at),
    })),
    timeline: timeline.map((t) => ({ event_type: String(t.event_type), actor: str(t.human_actor), decision: str(t.decision), payload: t.payload, occurred_at: String(t.occurred_at) })),
  };
}

// ── Improvement (delta skor Raport antar periode) ────────────────────────────

export interface ImprovementRow {
  am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null;
  has_spine: boolean; series: ScorePoint[]; delta: number | null;
  pip: { id: number; start_date: string; end_date: string } | null;
}

async function collect(periods: string[]): Promise<{ meta: { key: string; label: string }[]; byAm: Map<string, ImprovementRow> }> {
  const lists = await Promise.all(periods.map((p) => getRaportList(p)));
  const meta = lists.map((l, i) => ({ key: periods[i], label: l.period_label }));
  const byAm = new Map<string, ImprovementRow>();
  const scores = new Map<string, Map<string, number | null>>();
  lists.forEach((l, i) => {
    for (const r of l.rows) {
      if (!byAm.has(r.am_id)) {
        byAm.set(r.am_id, { am_id: r.am_id, nama: r.nama, panggilan: r.panggilan, role: r.role, cabang: r.cabang, has_spine: r.has_spine, series: [], delta: null, pip: null });
        scores.set(r.am_id, new Map());
      }
      scores.get(r.am_id)!.set(periods[i], r.overall);
    }
  });
  const sql = db();
  const active = await sql`
    SELECT e.am_id, c.id, c.start_date::text AS start_date, c.end_date::text AS end_date
    FROM pip_case c JOIN employee e ON e.id = c.employee_id WHERE c.status = 'aktif' AND e.am_id IS NOT NULL`;
  const pipByAm = new Map(active.map((a) => [String(a.am_id), { id: Number(a.id), start_date: String(a.start_date), end_date: String(a.end_date) }]));
  for (const [am, row] of byAm) {
    row.series = buildSeries(periods, scores.get(am)!);
    row.delta = row.series[row.series.length - 1]?.delta ?? null;
    row.pip = pipByAm.get(am) ?? null;
  }
  return { meta, byAm };
}

export async function getImprovement(scope: DataScope, periodsRaw: string | null): Promise<{ periods: { key: string; label: string }[]; rows: ImprovementRow[] }> {
  assertRead(scope, null); // AM murni tak boleh melihat daftar semua (sama /raport/list)
  const periods = parsePeriods(periodsRaw, wibDate());
  const { meta, byAm } = await collect(periods);
  return { periods: meta, rows: [...byAm.values()] };
}

export interface EmployeeProfile { id: string; nama: string; panggilan: string | null; role: string | null; dept: string | null; dept_label: string | null; cabang: string | null; okr_objective: string | null }

/** Satu karyawan: profil (employee) + deret skor Raport + semua PIP-nya. Kunci = am_id (sama dengan /raport/:amId). */
export async function getEmployeeJourney(scope: DataScope, amId: string, periodsRaw: string | null): Promise<{
  employee: EmployeeProfile | null; periods: { key: string; label: string }[]; series: ScorePoint[]; delta: number | null; cases: CaseRow[];
}> {
  assertRead(scope, amId);
  const periods = parsePeriods(periodsRaw, wibDate());
  const sql = db();
  const [emp] = await sql`
    SELECT e.id, e.nama, e.panggilan, e.role, e.dept, d.label AS dept_label, e.cabang, e.okr_objective
    FROM employee e LEFT JOIN department d ON d.key = e.dept WHERE e.am_id = ${amId} ORDER BY e.id LIMIT 1`;
  const { meta, byAm } = await collect(periods);
  const row = byAm.get(amId);
  return {
    employee: emp
      ? { id: String(emp.id), nama: String(emp.nama), panggilan: str(emp.panggilan), role: str(emp.role), dept: str(emp.dept), dept_label: str(emp.dept_label), cabang: str(emp.cabang), okr_objective: str(emp.okr_objective) }
      : null,
    periods: meta, series: row?.series ?? [], delta: row?.delta ?? null,
    cases: await listCases(scope, null, amId),
  };
}

// ── Mutasi ───────────────────────────────────────────────────────────────────

const isUnique = (e: unknown) => (e as { code?: string })?.code === "23505";

export async function startCase(
  scope: DataScope,
  b: { am_id?: unknown; alasan?: unknown; start_date?: unknown; goals?: unknown; milestones?: unknown },
  oleh: string | null,
): Promise<{ id: number }> {
  assertWrite(scope);
  const amId = required(b.am_id, "am_id", "am_id", 100);
  const alasan = required(b.alasan, "alasan", "alasan PIP");
  const start = b.start_date == null || b.start_date === "" ? wibDate() : b.start_date;
  if (!isIsoDate(start)) throw new PipError(400, "start_date harus YYYY-MM-DD", "start_date");
  const goals = Array.isArray(b.goals) ? b.goals.map(parseGoal) : [];
  if (!goals.length) throw new PipError(400, "minimal satu improvement goal wajib diisi", "goals");
  const milestones = Array.isArray(b.milestones) ? b.milestones.map((m) => parseMilestone(m, start)) : [];
  if (goals.length > MAX_ITEMS || milestones.length > MAX_ITEMS) throw new PipError(400, `maksimal ${MAX_ITEMS} goal/milestone saat memulai`, "goals");
  const end = addDays(start, PIP_DURATION_DAYS);
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [emp] = await tx`SELECT id FROM employee WHERE am_id = ${amId} ORDER BY id LIMIT 1`;
      if (!emp) throw new PipError(422, "karyawan belum tertaut ke profil employee (am_id) — tautkan dulu di Kelola Profil");
      const [c] = await tx`
        INSERT INTO pip_case (employee_id, start_date, end_date, alasan, created_by)
        VALUES (${String(emp.id)}, ${start}, ${end}, ${alasan}, ${oleh}) RETURNING id`;
      const id = Number(c.id);
      for (const [i, g] of goals.entries()) {
        await tx`INSERT INTO pip_goal (case_id, goal, target, seq, created_by) VALUES (${id}, ${g.goal}, ${g.target}, ${i}, ${oleh})`;
      }
      for (const m of milestones) {
        await tx`INSERT INTO pip_milestone (case_id, judul, due_date, created_by) VALUES (${id}, ${m.judul}, ${m.due_date}, ${oleh})`;
      }
      await logAudit(t, id, "pip.started", oleh, { employee_id: String(emp.id), am_id: amId, start_date: start, end_date: end, alasan, goals: goals.length, milestones: milestones.length });
      return { id };
    });
  } catch (e) {
    // Indeks unik parsial pip_case_aktif_uq: sudah ada PIP aktif (juga balapan dua klik).
    if (isUnique(e)) throw new PipError(409, "karyawan ini sudah punya PIP aktif");
    throw e;
  }
}

/** Kunci baris case + tolak bila sudah ditutup. Mengembalikan baris case. */
async function lockActive(tx: Sql, id: number): Promise<{ id: number; start_date: string; end_date: string }> {
  const [c] = await tx`SELECT id, status, start_date::text AS start_date, end_date::text AS end_date FROM pip_case WHERE id = ${id} FOR UPDATE`;
  if (!c) throw new PipError(404, "PIP tidak ditemukan");
  if (c.status !== "aktif") throw new PipError(409, `PIP sudah ditutup (${String(c.status)})`);
  return { id: Number(c.id), start_date: String(c.start_date), end_date: String(c.end_date) };
}

export async function addGoal(scope: DataScope, id: number, b: unknown, oleh: string | null): Promise<{ id: number }> {
  assertWrite(scope);
  const g = parseGoal(b);
  return db().begin(async (tx) => {
    await lockActive(tx as unknown as Sql, id);
    const [r] = await tx`
      INSERT INTO pip_goal (case_id, goal, target, seq, created_by)
      VALUES (${id}, ${g.goal}, ${g.target}, (SELECT COALESCE(max(seq), -1) + 1 FROM pip_goal WHERE case_id = ${id}), ${oleh}) RETURNING id`;
    await logAudit(tx as unknown as Sql, id, "pip.goal_added", oleh, { goal_id: Number(r.id), goal: g.goal, target: g.target });
    return { id: Number(r.id) };
  });
}

export async function addMilestone(scope: DataScope, id: number, b: unknown, oleh: string | null): Promise<{ id: number }> {
  assertWrite(scope);
  return db().begin(async (tx) => {
    const c = await lockActive(tx as unknown as Sql, id);
    const m = parseMilestone(b, c.start_date);
    const [r] = await tx`INSERT INTO pip_milestone (case_id, judul, due_date, created_by) VALUES (${id}, ${m.judul}, ${m.due_date}, ${oleh}) RETURNING id`;
    await logAudit(tx as unknown as Sql, id, "pip.milestone_added", oleh, { milestone_id: Number(r.id), judul: m.judul, due_date: m.due_date });
    return { id: Number(r.id) };
  });
}

/** Putuskan milestone: tercapai / tidak_tercapai / belum (buka lagi). tidak_tercapai wajib beralasan. */
export async function decideMilestone(scope: DataScope, milestoneId: number, b: { status?: unknown; catatan?: unknown }, oleh: string | null): Promise<{ ok: true }> {
  assertWrite(scope);
  if (!MILESTONE_STATUS.includes(b.status as MilestoneStatus)) throw new PipError(400, `status harus salah satu: ${MILESTONE_STATUS.join(", ")}`, "status");
  const status = b.status as MilestoneStatus;
  const catatan = clean(b.catatan);
  if (status === "tidak_tercapai" && !catatan) throw new PipError(400, "alasan wajib diisi bila milestone tidak tercapai", "catatan");
  return db().begin(async (tx) => {
    const [m] = await tx`SELECT id, case_id, judul FROM pip_milestone WHERE id = ${milestoneId} FOR UPDATE`;
    if (!m) throw new PipError(404, "milestone tidak ditemukan");
    await lockActive(tx as unknown as Sql, Number(m.case_id));
    await tx`
      UPDATE pip_milestone SET status = ${status}, catatan = ${catatan},
        decided_by = ${status === "belum" ? null : oleh}, decided_at = ${status === "belum" ? null : tx`now()`}
      WHERE id = ${milestoneId}`;
    await logAudit(tx as unknown as Sql, Number(m.case_id), "pip.milestone_decided", oleh, { milestone_id: milestoneId, judul: String(m.judul), status, catatan }, status);
    return { ok: true as const };
  });
}

export async function addCheckin(scope: DataScope, id: number, b: { checkin_date?: unknown; catatan?: unknown }, oleh: string | null): Promise<{ id: number; week_no: number }> {
  assertWrite(scope);
  const catatan = required(b.catatan, "catatan", "catatan check-in");
  const today = wibDate();
  const date = b.checkin_date == null || b.checkin_date === "" ? today : b.checkin_date;
  if (!isIsoDate(date)) throw new PipError(400, "checkin_date harus YYYY-MM-DD", "checkin_date");
  if (date > today) throw new PipError(400, "checkin_date tidak boleh di masa depan", "checkin_date");
  return db().begin(async (tx) => {
    const c = await lockActive(tx as unknown as Sql, id);
    if (date < c.start_date) throw new PipError(400, "checkin_date tidak boleh sebelum tanggal mulai PIP", "checkin_date");
    const wk = weekNo(c.start_date, date);
    const [r] = await tx`INSERT INTO pip_checkin (case_id, week_no, checkin_date, catatan, created_by) VALUES (${id}, ${wk}, ${date}, ${catatan}, ${oleh}) RETURNING id`;
    await logAudit(tx as unknown as Sql, id, "pip.checkin_added", oleh, { checkin_id: Number(r.id), week_no: wk, checkin_date: date });
    return { id: Number(r.id), week_no: wk };
  });
}

/** Outcome: graduate/terminate menutup case; extend menggeser end_date (case tetap aktif). */
export async function setOutcome(scope: DataScope, id: number, b: Record<string, unknown>, oleh: string | null): Promise<{ status: CaseStatus; end_date: string }> {
  assertWrite(scope);
  return db().begin(async (tx) => {
    const c = await lockActive(tx as unknown as Sql, id);
    const o = parseOutcome(b, c.end_date);
    if (o.outcome === "extend") {
      await tx`UPDATE pip_case SET end_date = ${o.end_date} WHERE id = ${id}`;
    } else {
      await tx`UPDATE pip_case SET status = ${o.outcome}, outcome_note = ${o.catatan}, closed_at = now() WHERE id = ${id}`;
    }
    await logAudit(tx as unknown as Sql, id, `pip.outcome_${o.outcome}`, oleh, { outcome: o.outcome, catatan: o.catatan, end_date_sebelum: c.end_date, end_date_baru: o.end_date }, o.outcome);
    return { status: (o.outcome === "extend" ? "aktif" : o.outcome) as CaseStatus, end_date: o.end_date ?? c.end_date };
  });
}
