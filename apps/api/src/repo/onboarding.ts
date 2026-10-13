// F56 Onboarding Checklist Karyawan Baru — migrasi 213.
//
// Dua bagian, sengaja dipisah:
//   1. LOGIKA MURNI (templateMatches, dueDate, progress, audienceOf) — tanpa DB, diuji di onboarding.test.ts.
//   2. AKSES DB — merakit data lalu menyerahkannya ke (1).
//
// Keputusan desain (tercatat di docs/features/F56-onboarding-checklist.md):
//   - Isi checklist = DATA (onboarding_template), bukan kode. HRD mengedit lewat menu.
//   - Case dimulai HRD per karyawan (tabel `employee`, tempat roster_pending); butir template
//     yang cocok di-SNAPSHOT ke onboarding_item, jadi mengubah template tak menggeser case berjalan.
//   - Case selesai OTOMATIS saat tak ada butir 'belum'; membuka lagi butir = case kembali berjalan.
//   - Admin/superuser/Direktur melihat & menulis semua; HoD hanya karyawan cabang timnya; lainnya 403.
//   - Template hanya boleh diubah audiens "all".
//   - Tanpa notifikasi/scheduler: yang terlambat ditandai di layar (butir tenggat < hari ini).

import { db } from "../db.js";
import type { DataScope } from "./access-scope.js";

// ── Konstanta ────────────────────────────────────────────────────────────────
export const KATEGORI = ["akses_sistem", "training", "nda", "alat", "grup_wa"] as const;
export type Kategori = (typeof KATEGORI)[number];
export const ITEM_STATUS = ["belum", "selesai", "dilewati"] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];
export const CASE_STATUS = ["berjalan", "selesai", "dibatalkan"] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];

export const DUE_DAYS_MAX = 365;
const TEXT_MAX = 500;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export class OnboardingError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 422,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const wibDate = (now = Date.now()): string => new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);

// ── 1. Logika murni ──────────────────────────────────────────────────────────

export type Audience = "all" | "team";

/** Siapa boleh membaca/menulis. null = ditolak. HoD tanpa cabangScope DITOLAK (resolveScope
 *  memberi scope penuh pada HoD tanpa territory — jebakan untuk gerbang tulis). */
export function audienceOf(s: DataScope): Audience | null {
  if (!s.userId) return null;
  const role = String(s.role ?? "").trim().toLowerCase();
  if (s.superuser || role === "admin" || role === "direktur") return "all";
  if (s.cabangScope && s.cabangScope.length) return "team";
  return null;
}

export interface TemplateRule { dept: string | null; role_pattern: string | null }
export interface EmployeeRef { dept: string | null; role: string | null }

/** Butir berlaku bila dept (jika diisi) sama DAN pola jabatan (jika diisi) ada di role karyawan. */
export function templateMatches(t: TemplateRule, e: EmployeeRef): boolean {
  if (t.dept && t.dept !== e.dept) return false;
  const p = (t.role_pattern ?? "").trim().toLowerCase();
  if (p && !(e.role ?? "").toLowerCase().includes(p)) return false;
  return true;
}

/** ISO date + N hari (kalender UTC, tanpa efek zona waktu). */
export function dueDate(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ProgressItem { status: ItemStatus; due_date: string }
export interface Progress { total: number; selesai: number; dilewati: number; belum: number; terlambat: number; persen: number }

/** Persen = butir yang sudah diputus (selesai + dilewati) ÷ total. Terlambat = belum & tenggat < hari ini. */
export function progress(items: ProgressItem[], today: string): Progress {
  const selesai = items.filter((i) => i.status === "selesai").length;
  const dilewati = items.filter((i) => i.status === "dilewati").length;
  const belum = items.filter((i) => i.status === "belum").length;
  const terlambat = items.filter((i) => i.status === "belum" && i.due_date < today).length;
  const total = items.length;
  return { total, selesai, dilewati, belum, terlambat, persen: total ? Math.round(((selesai + dilewati) / total) * 100) : 0 };
}

const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const clean = (v: unknown, max = TEXT_MAX): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export interface TemplateInput {
  kategori: Kategori; judul: string; keterangan: string | null; dept: string | null;
  role_pattern: string | null; due_days: number; pic: string | null; urut: number; aktif: boolean;
}

/** Validasi body template. `partial` = PATCH (field yang tak dikirim tak divalidasi/diubah). */
export function parseTemplate(b: Record<string, unknown>, partial: boolean): Partial<TemplateInput> {
  const out: Partial<TemplateInput> = {};
  const has = (k: string) => b[k] !== undefined;
  if (!partial || has("kategori")) {
    if (!KATEGORI.includes(b.kategori as Kategori)) throw new OnboardingError(400, `kategori harus salah satu: ${KATEGORI.join(", ")}`, "kategori");
    out.kategori = b.kategori as Kategori;
  }
  if (!partial || has("judul")) {
    const j = clean(b.judul, 200);
    if (!j) throw new OnboardingError(400, "judul wajib diisi", "judul");
    out.judul = j;
  }
  if (has("keterangan")) out.keterangan = clean(b.keterangan);
  if (has("dept")) out.dept = clean(b.dept, 60);
  if (has("role_pattern")) out.role_pattern = clean(b.role_pattern, 100);
  if (has("pic")) out.pic = clean(b.pic, 100);
  if (has("due_days")) {
    const n = Number(b.due_days);
    if (!Number.isInteger(n) || n < 0 || n > DUE_DAYS_MAX) throw new OnboardingError(400, `due_days harus bilangan bulat 0–${DUE_DAYS_MAX}`, "due_days");
    out.due_days = n;
  }
  if (has("urut")) {
    const n = Number(b.urut);
    if (!Number.isInteger(n)) throw new OnboardingError(400, "urut harus bilangan bulat", "urut");
    out.urut = n;
  }
  if (has("aktif")) {
    if (typeof b.aktif !== "boolean") throw new OnboardingError(400, "aktif harus true/false", "aktif");
    out.aktif = b.aktif;
  }
  return out;
}

// ── 2. Akses DB ──────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;

const need = (s: DataScope): Audience => {
  const a = audienceOf(s);
  if (!a) throw new OnboardingError(403, "tidak berwenang");
  return a;
};

/** Klausa batas cabang untuk audiens team (kolom cabang employee, huruf besar — selaras scopeOnClause). */
const teamClause = (sql: Sql, a: Audience, s: DataScope, col: ReturnType<Sql>) =>
  a === "team" ? sql`AND upper(btrim(${col})) = ANY(${(s.cabangScope ?? []).map((c) => c.trim().toUpperCase())}::text[])` : sql``;

export interface CaseRow {
  id: number; employee_id: string; nama: string; role: string | null; dept: string | null; cabang: string | null;
  tanggal_mulai: string; status: CaseStatus; catatan: string | null; created_by: string | null;
  created_at: string; selesai_at: string | null; progress: Progress;
}
export interface ItemRow {
  id: number; case_id: number; kategori: Kategori; judul: string; keterangan: string | null; pic: string | null;
  urut: number; due_date: string; status: ItemStatus; catatan: string | null; done_by: string | null; done_at: string | null;
  terlambat: boolean;
}

const mapItem = (r: Record<string, unknown>, today: string): ItemRow => ({
  id: Number(r.id), case_id: Number(r.case_id), kategori: r.kategori as Kategori, judul: String(r.judul),
  keterangan: r.keterangan ? String(r.keterangan) : null, pic: r.pic ? String(r.pic) : null, urut: Number(r.urut),
  due_date: String(r.due_date), status: r.status as ItemStatus, catatan: r.catatan ? String(r.catatan) : null,
  done_by: r.done_by ? String(r.done_by) : null, done_at: r.done_at ? String(r.done_at) : null,
  terlambat: r.status === "belum" && String(r.due_date) < today,
});

const mapCase = (r: Record<string, unknown>, items: ProgressItem[], today: string): CaseRow => ({
  id: Number(r.id), employee_id: String(r.employee_id), nama: String(r.nama), role: r.role ? String(r.role) : null,
  dept: r.dept ? String(r.dept) : null, cabang: r.cabang ? String(r.cabang) : null,
  tanggal_mulai: String(r.tanggal_mulai), status: r.status as CaseStatus, catatan: r.catatan ? String(r.catatan) : null,
  created_by: r.created_by ? String(r.created_by) : null, created_at: String(r.created_at),
  selesai_at: r.selesai_at ? String(r.selesai_at) : null, progress: progress(items, today),
});

const CASE_COLS = (sql: Sql) => sql`
  c.id, c.employee_id, e.nama, e.role, e.dept, e.cabang, c.tanggal_mulai::text AS tanggal_mulai,
  c.status, c.catatan, c.created_by, c.created_at::text AS created_at, c.selesai_at::text AS selesai_at`;

export async function listCases(scope: DataScope, status: string | null): Promise<CaseRow[]> {
  const a = need(scope);
  const sql = db();
  const today = wibDate();
  const st = CASE_STATUS.includes(status as CaseStatus) ? status : null;
  const rows = await sql`
    SELECT ${CASE_COLS(sql)} FROM onboarding_case c JOIN employee e ON e.id = c.employee_id
    WHERE true ${st ? sql`AND c.status = ${st}` : sql``} ${teamClause(sql, a, scope, sql`e.cabang`)}
    ORDER BY (c.status = 'berjalan') DESC, c.tanggal_mulai DESC, c.id DESC`;
  if (!rows.length) return [];
  const items = await sql`
    SELECT case_id, status, due_date::text AS due_date FROM onboarding_item WHERE case_id = ANY(${rows.map((r) => Number(r.id))}::bigint[])`;
  const byCase = new Map<number, ProgressItem[]>();
  for (const i of items) {
    const k = Number(i.case_id);
    byCase.set(k, [...(byCase.get(k) ?? []), { status: i.status as ItemStatus, due_date: String(i.due_date) }]);
  }
  return rows.map((r) => mapCase(r, byCase.get(Number(r.id)) ?? [], today));
}

export async function getCase(scope: DataScope, id: number): Promise<(CaseRow & { items: ItemRow[] }) | null> {
  const a = need(scope);
  const sql = db();
  const today = wibDate();
  const [r] = await sql`
    SELECT ${CASE_COLS(sql)} FROM onboarding_case c JOIN employee e ON e.id = c.employee_id
    WHERE c.id = ${id} ${teamClause(sql, a, scope, sql`e.cabang`)}`;
  if (!r) return null;
  const items = (await sql`
    SELECT id, case_id, kategori, judul, keterangan, pic, urut, due_date::text AS due_date, status, catatan, done_by, done_at::text AS done_at
    FROM onboarding_item WHERE case_id = ${id} ORDER BY kategori, urut, id`).map((x) => mapItem(x, today));
  return { ...mapCase(r, items, today), items };
}

export interface Candidate { id: string; nama: string; role: string | null; dept: string | null; cabang: string | null; roster_pending: boolean }

/** Karyawan yang belum punya onboarding berjalan. roster_pending (belum masuk roster) tampil dulu. */
export async function listCandidates(scope: DataScope): Promise<Candidate[]> {
  const a = need(scope);
  const sql = db();
  const rows = await sql`
    SELECT e.id, e.nama, e.role, e.dept, e.cabang, e.roster_pending FROM employee e
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_case c WHERE c.employee_id = e.id AND c.status = 'berjalan')
      ${teamClause(sql, a, scope, sql`e.cabang`)}
    ORDER BY e.roster_pending DESC, e.nama`;
  return rows.map((r) => ({
    id: String(r.id), nama: String(r.nama), role: r.role ? String(r.role) : null, dept: r.dept ? String(r.dept) : null,
    cabang: r.cabang ? String(r.cabang) : null, roster_pending: r.roster_pending === true,
  }));
}

export async function startCase(
  scope: DataScope,
  input: { employee_id?: unknown; tanggal_mulai?: unknown; catatan?: unknown },
  oleh: string | null,
): Promise<{ id: number; items: number }> {
  const a = need(scope);
  const employeeId = clean(input.employee_id, 100);
  if (!employeeId) throw new OnboardingError(400, "employee_id wajib diisi", "employee_id");
  const mulai = input.tanggal_mulai == null || input.tanggal_mulai === "" ? wibDate() : input.tanggal_mulai;
  if (!isIsoDate(mulai)) throw new OnboardingError(400, "tanggal_mulai harus YYYY-MM-DD", "tanggal_mulai");
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const [emp] = await tx`
        SELECT e.id, e.dept, e.role FROM employee e WHERE e.id = ${employeeId} ${teamClause(tx as unknown as Sql, a, scope, tx`e.cabang`)}`;
      if (!emp) throw new OnboardingError(404, "karyawan tidak ditemukan");
      const ref: EmployeeRef = { dept: emp.dept ? String(emp.dept) : null, role: emp.role ? String(emp.role) : null };
      const tpl = (await tx`
        SELECT id, kategori, judul, keterangan, dept, role_pattern, due_days, pic, urut
        FROM onboarding_template WHERE aktif ORDER BY kategori, urut, id`).filter((t) =>
        templateMatches({ dept: t.dept ? String(t.dept) : null, role_pattern: t.role_pattern ? String(t.role_pattern) : null }, ref));
      if (!tpl.length) throw new OnboardingError(422, "belum ada template checklist aktif yang cocok untuk jabatan ini");
      const [c] = await tx`
        INSERT INTO onboarding_case (employee_id, tanggal_mulai, catatan, created_by)
        VALUES (${employeeId}, ${mulai}, ${clean(input.catatan)}, ${oleh}) RETURNING id`;
      const caseId = Number(c.id);
      for (const t of tpl) {
        await tx`
          INSERT INTO onboarding_item (case_id, template_id, kategori, judul, keterangan, pic, urut, due_date)
          VALUES (${caseId}, ${Number(t.id)}, ${String(t.kategori)}, ${String(t.judul)}, ${t.keterangan ? String(t.keterangan) : null},
                  ${t.pic ? String(t.pic) : null}, ${Number(t.urut)}, ${dueDate(mulai, Number(t.due_days))})`;
      }
      return { id: caseId, items: tpl.length };
    });
  } catch (e) {
    // Indeks unik parsial onboarding_case_berjalan_uq: balapan dua klik "Mulai".
    if ((e as { code?: string })?.code === "23505") throw new OnboardingError(409, "karyawan ini sudah punya onboarding berjalan");
    throw e;
  }
}

/** Ubah status butir. dilewati WAJIB beralasan. Case ikut: semua butir diputus → selesai; dibuka lagi → berjalan. */
export async function updateItem(
  scope: DataScope,
  itemId: number,
  input: { status?: unknown; catatan?: unknown },
  oleh: string | null,
): Promise<{ item: ItemRow; case_status: CaseStatus }> {
  const a = need(scope);
  if (!ITEM_STATUS.includes(input.status as ItemStatus)) throw new OnboardingError(400, `status harus salah satu: ${ITEM_STATUS.join(", ")}`, "status");
  const status = input.status as ItemStatus;
  const catatan = clean(input.catatan);
  if (status === "dilewati" && !catatan) throw new OnboardingError(400, "alasan wajib diisi bila butir dilewati", "catatan");
  const sql = db();
  const today = wibDate();
  return sql.begin(async (tx) => {
    const [it] = await tx`
      SELECT i.id, i.case_id, c.status AS case_status FROM onboarding_item i
      JOIN onboarding_case c ON c.id = i.case_id JOIN employee e ON e.id = c.employee_id
      WHERE i.id = ${itemId} ${teamClause(tx as unknown as Sql, a, scope, tx`e.cabang`)} FOR UPDATE OF i, c`;
    if (!it) throw new OnboardingError(404, "butir tidak ditemukan");
    if (it.case_status === "dibatalkan") throw new OnboardingError(409, "onboarding sudah dibatalkan");
    const [row] = await tx`
      UPDATE onboarding_item SET status = ${status}, catatan = ${catatan},
        done_by = ${status === "belum" ? null : oleh}, done_at = ${status === "belum" ? null : tx`now()`}
      WHERE id = ${itemId}
      RETURNING id, case_id, kategori, judul, keterangan, pic, urut, due_date::text AS due_date, status, catatan, done_by, done_at::text AS done_at`;
    const [{ open }] = await tx`SELECT count(*)::int AS open FROM onboarding_item WHERE case_id = ${Number(it.case_id)} AND status = 'belum'`;
    const next: CaseStatus = Number(open) === 0 ? "selesai" : "berjalan";
    if (next !== it.case_status) {
      try {
        await tx`UPDATE onboarding_case SET status = ${next}, selesai_at = ${next === "selesai" ? tx`now()` : null} WHERE id = ${Number(it.case_id)}`;
      } catch (e) {
        // Membuka lagi case selesai bentrok dengan case berjalan lain milik karyawan yang sama.
        if ((e as { code?: string })?.code === "23505") throw new OnboardingError(409, "karyawan ini sudah punya onboarding berjalan lain — selesaikan/batalkan dulu");
        throw e;
      }
    }
    return { item: mapItem(row, today), case_status: next };
  });
}

export async function cancelCase(scope: DataScope, id: number): Promise<{ ok: true }> {
  const a = need(scope);
  const sql = db();
  const rows = await sql`
    UPDATE onboarding_case c SET status = 'dibatalkan', selesai_at = NULL
    FROM employee e WHERE e.id = c.employee_id AND c.id = ${id} AND c.status = 'berjalan' ${teamClause(sql, a, scope, sql`e.cabang`)}
    RETURNING c.id`;
  if (rows.length) return { ok: true };
  const [x] = await sql`SELECT status FROM onboarding_case WHERE id = ${id}`;
  if (x && (await getCase(scope, id))) throw new OnboardingError(409, `hanya onboarding berjalan yang bisa dibatalkan (status: ${String(x.status)})`);
  throw new OnboardingError(404, "onboarding tidak ditemukan");
}

// ── Template (hanya audiens "all") ───────────────────────────────────────────

export interface TemplateRow extends TemplateInput { id: number; dept_label: string | null }

const needAll = (s: DataScope): void => {
  if (need(s) !== "all") throw new OnboardingError(403, "hanya HRD/admin yang boleh mengubah template");
};

export async function listTemplates(scope: DataScope): Promise<{ templates: TemplateRow[]; dept: { key: string; label: string }[] }> {
  needAll(scope);
  const sql = db();
  const rows = await sql`
    SELECT t.id, t.kategori, t.judul, t.keterangan, t.dept, d.label AS dept_label, t.role_pattern, t.due_days, t.pic, t.urut, t.aktif
    FROM onboarding_template t LEFT JOIN department d ON d.key = t.dept ORDER BY t.kategori, t.urut, t.id`;
  const dept = await sql`SELECT key, label FROM department ORDER BY label`;
  return {
    templates: rows.map((r) => ({
      id: Number(r.id), kategori: r.kategori as Kategori, judul: String(r.judul), keterangan: r.keterangan ? String(r.keterangan) : null,
      dept: r.dept ? String(r.dept) : null, dept_label: r.dept_label ? String(r.dept_label) : null,
      role_pattern: r.role_pattern ? String(r.role_pattern) : null, due_days: Number(r.due_days), pic: r.pic ? String(r.pic) : null,
      urut: Number(r.urut), aktif: r.aktif === true,
    })),
    dept: dept.map((d) => ({ key: String(d.key), label: String(d.label) })),
  };
}

async function assertDept(sql: Sql, dept: string | null | undefined): Promise<void> {
  if (!dept) return;
  const [d] = await sql`SELECT 1 FROM department WHERE key = ${dept}`;
  if (!d) throw new OnboardingError(400, "departemen tidak dikenal", "dept");
}

export async function createTemplate(scope: DataScope, body: Record<string, unknown>): Promise<{ id: number }> {
  needAll(scope);
  const t = parseTemplate(body, false) as TemplateInput;
  const sql = db();
  await assertDept(sql, t.dept);
  const [r] = await sql`
    INSERT INTO onboarding_template (kategori, judul, keterangan, dept, role_pattern, due_days, pic, urut, aktif)
    VALUES (${t.kategori}, ${t.judul}, ${t.keterangan ?? null}, ${t.dept ?? null}, ${t.role_pattern ?? null},
            ${t.due_days ?? 7}, ${t.pic ?? null}, ${t.urut ?? 0}, ${t.aktif ?? true})
    RETURNING id`;
  return { id: Number(r.id) };
}

/** PATCH parsial; hanya field yang dikirim yang berubah. Case berjalan tak terpengaruh (snapshot). */
export async function updateTemplate(scope: DataScope, id: number, body: Record<string, unknown>): Promise<{ ok: true }> {
  needAll(scope);
  const t = parseTemplate(body, true);
  const keys = Object.keys(t);
  if (!keys.length) throw new OnboardingError(400, "tidak ada field yang diubah");
  const sql = db();
  await assertDept(sql, t.dept);
  const rows = await sql`UPDATE onboarding_template SET ${sql(t as Record<string, unknown>, ...keys)} WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new OnboardingError(404, "template tidak ditemukan");
  return { ok: true };
}
