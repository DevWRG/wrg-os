// F118 Employee Profile Spine (+ F119 bobot BSC). Read model: daftar karyawan
// (grid dept/search) + profil lengkap (BSC objektif · OKR · KPI · PDCA · RACI ·
// Voice) + bobot BSC per-dept utk kalkulator skor (F119, dihitung di klien).

import { db } from "../db.js";
import { resolveHods, HODS } from "../hod-resolver.js";

export type Perspective = "fin" | "cust" | "proc" | "learn";

export interface EmployeeListItem {
  id: string; nama: string; dept: string | null; dept_label: string | null; dept_color: string | null;
  role: string | null; cabang: string | null; lokasi: string | null; roster_pending: boolean; kpi_count: number;
}

export async function listDepartments() {
  const rows = await db()`
    SELECT d.key, d.label, d.color,
           COALESCE(json_object_agg(w.perspective, w.weight) FILTER (WHERE w.perspective IS NOT NULL), '{}') AS weights,
           (SELECT count(*) FROM employee e WHERE e.dept = d.key)::int AS count
    FROM department d LEFT JOIN bsc_weight w ON w.dept = d.key
    GROUP BY d.key, d.label, d.color ORDER BY d.label`;
  return rows.map((r) => ({
    key: String(r.key), label: String(r.label), color: r.color ? String(r.color) : null,
    weights: (r.weights ?? {}) as Record<Perspective, number>, count: Number(r.count),
  }));
}

export async function listEmployees(): Promise<EmployeeListItem[]> {
  const rows = await db()`
    SELECT e.id, e.nama, e.dept, d.label AS dept_label, d.color AS dept_color, e.role, e.cabang, e.lokasi, e.roster_pending,
           (SELECT count(*) FROM kpi k WHERE k.employee_id = e.id)::int AS kpi_count
    FROM employee e LEFT JOIN department d ON d.key = e.dept
    ORDER BY d.label NULLS LAST, e.nama`;
  return rows.map((r) => ({
    id: String(r.id), nama: String(r.nama), dept: r.dept ? String(r.dept) : null,
    dept_label: r.dept_label ? String(r.dept_label) : null, dept_color: r.dept_color ? String(r.dept_color) : null,
    role: r.role ? String(r.role) : null, cabang: r.cabang ? String(r.cabang) : null,
    lokasi: r.lokasi ? String(r.lokasi) : null, roster_pending: r.roster_pending === true, kpi_count: Number(r.kpi_count),
  }));
}

// F120 RACI Matrix global — proses (baris) × karyawan (kolom, dikelompokkan dept),
// sel = role_type (R/A/C/I atau gabungan A/R). Proses diurut by jumlah assignment
// (proses inti di atas); karyawan diurut dept→nama (sama spt listEmployees).
export async function getRaciMatrix() {
  const rows = await db()`
    SELECT ra.process, ra.employee_id, ra.role_type, ra.note,
           e.nama, e.role, e.dept, d.label AS dept_label, d.color AS dept_color
    FROM raci_assignment ra
    JOIN employee e ON e.id = ra.employee_id
    LEFT JOIN department d ON d.key = e.dept
    ORDER BY d.label NULLS LAST, e.nama`;
  const procCount = new Map<string, number>();
  const peopleMap = new Map<string, { id: string; nama: string; role: string | null; dept: string | null; dept_label: string | null; dept_color: string | null }>();
  const cells: { process: string; employee_id: string; role_type: string; note: string | null }[] = [];
  for (const r of rows) {
    const process = String(r.process);
    const eid = String(r.employee_id);
    procCount.set(process, (procCount.get(process) ?? 0) + 1);
    if (!peopleMap.has(eid)) {
      peopleMap.set(eid, {
        id: eid, nama: String(r.nama), role: r.role ? String(r.role) : null,
        dept: r.dept ? String(r.dept) : null, dept_label: r.dept_label ? String(r.dept_label) : null,
        dept_color: r.dept_color ? String(r.dept_color) : null,
      });
    }
    cells.push({ process, employee_id: eid, role_type: String(r.role_type), note: r.note ? String(r.note) : null });
  }
  const processes = [...procCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
  return { processes, people: [...peopleMap.values()], cells };
}

export async function getEmployee(id: string) {
  const sql = db();
  const [e] = await sql`
    SELECT e.*, d.label AS dept_label, d.color AS dept_color,
           COALESCE((SELECT json_object_agg(w.perspective, w.weight) FROM bsc_weight w WHERE w.dept = e.dept), '{}') AS weights
    FROM employee e LEFT JOIN department d ON d.key = e.dept WHERE e.id = ${id}`;
  if (!e) return null;
  const [tools, tasks, bsc, kr, kpis, pdca, raci, voice] = await Promise.all([
    sql`SELECT tool FROM employee_tool WHERE employee_id = ${id} ORDER BY seq`,
    sql`SELECT task FROM employee_task WHERE employee_id = ${id} ORDER BY seq`,
    sql`SELECT perspective, objective FROM bsc_objective WHERE employee_id = ${id} ORDER BY perspective, seq`,
    sql`SELECT key_result FROM okr_key_result WHERE employee_id = ${id} ORDER BY seq`,
    sql`SELECT id::text, name, target, frequency, perspective, lower_better FROM kpi WHERE employee_id = ${id} ORDER BY seq`,
    sql`SELECT plan_step, do_step, check_step, act_step FROM pdca_cycle WHERE employee_id = ${id} ORDER BY seq LIMIT 1`,
    sql`SELECT process, role_type, note FROM raci_assignment WHERE employee_id = ${id} ORDER BY seq`,
    sql`SELECT kind, content FROM voice_item WHERE employee_id = ${id} ORDER BY kind, seq`,
  ]);
  const bscByP: Record<string, string[]> = { fin: [], cust: [], proc: [], learn: [] };
  for (const b of bsc) (bscByP[String(b.perspective)] ??= []).push(String(b.objective));
  const p = pdca[0];
  return {
    id: String(e.id), nama: String(e.nama), dept: e.dept ? String(e.dept) : null,
    dept_label: e.dept_label ? String(e.dept_label) : null, dept_color: e.dept_color ? String(e.dept_color) : null,
    role: e.role ? String(e.role) : null, atasan_raw: e.atasan_raw ? String(e.atasan_raw) : null,
    lokasi: e.lokasi ? String(e.lokasi) : null, masa: e.masa ? String(e.masa) : null,
    panggilan: e.panggilan ? String(e.panggilan) : null, cabang: e.cabang ? String(e.cabang) : null,
    whatsapp: e.whatsapp ? String(e.whatsapp) : null, roster_pending: e.roster_pending === true,
    quote: e.quote ? String(e.quote) : null, okr_objective: e.okr_objective ? String(e.okr_objective) : null,
    weights: (e.weights ?? {}) as Record<Perspective, number>,
    tools: tools.map((r) => String(r.tool)),
    tasks: tasks.map((r) => String(r.task)),
    bsc: bscByP,
    okr_kr: kr.map((r) => String(r.key_result)),
    kpi: kpis.map((r) => ({ id: String(r.id), name: String(r.name), target: r.target ? String(r.target) : null, frequency: r.frequency ? String(r.frequency) : null, perspective: r.perspective ? String(r.perspective) : null, lower_better: r.lower_better === true })),
    pdca: p ? { plan: p.plan_step ? String(p.plan_step) : null, do: p.do_step ? String(p.do_step) : null, check: p.check_step ? String(p.check_step) : null, act: p.act_step ? String(p.act_step) : null } : null,
    raci: raci.map((r) => ({ process: String(r.process), role_type: String(r.role_type), note: r.note ? String(r.note) : null })),
    pain: voice.filter((r) => r.kind === "pain").map((r) => String(r.content)),
    idea: voice.filter((r) => r.kind === "idea").map((r) => String(r.content)),
  };
}

// F119b — persistensi pengukuran KPI per periode (kpi_measurement, migrasi 055).
export interface MeasurementInput { kpi_id: string | number; achievement_pct: number; actual?: string | null; note?: string | null }

export async function getMeasurements(employeeId: string, period: string) {
  const rows = await db()`
    SELECT m.kpi_id::text AS kpi_id, m.achievement_pct::float8 AS achievement_pct, m.actual, m.note
    FROM kpi_measurement m JOIN kpi k ON k.id = m.kpi_id
    WHERE k.employee_id = ${employeeId} AND m.period = ${period}`;
  return rows.map((r) => ({
    kpi_id: String(r.kpi_id), achievement_pct: Number(r.achievement_pct),
    actual: r.actual ? String(r.actual) : null, note: r.note ? String(r.note) : null,
  }));
}

// Upsert (kpi_id, period). Hanya KPI milik karyawan ybs yang diterima (validasi
// ownership) — cegah nulis measurement ke KPI orang lain.
export async function saveMeasurements(employeeId: string, period: string, items: MeasurementInput[]) {
  const sql = db();
  const owned = new Set((await sql`SELECT id::text FROM kpi WHERE employee_id = ${employeeId}`).map((r) => String(r.id)));
  let saved = 0;
  for (const it of items) {
    const kid = String(it.kpi_id);
    const pct = Number(it.achievement_pct);
    if (!owned.has(kid) || !Number.isFinite(pct)) continue;
    await sql`
      INSERT INTO kpi_measurement (kpi_id, period, achievement_pct, actual, note, updated_at)
      VALUES (${Number(kid)}, ${period}, ${pct}, ${it.actual ?? null}, ${it.note ?? null}, now())
      ON CONFLICT (kpi_id, period) DO UPDATE
        SET achievement_pct = EXCLUDED.achievement_pct, actual = EXCLUDED.actual, note = EXCLUDED.note, updated_at = now()`;
    saved++;
  }
  return { saved, period, skipped: items.length - saved };
}

// F118b — CRUD core karyawan (edit field inti + tambah + hapus). Sub-koleksi
// (KPI/BSC/RACI/dst) belum di-CRUD di sini. id = slug (auto dari nama saat create).
export interface EmployeeWrite {
  nama: string; dept?: string | null; role?: string | null; atasan_raw?: string | null;
  lokasi?: string | null; masa?: string | null; panggilan?: string | null; cabang?: string | null;
  whatsapp?: string | null; roster_pending?: boolean; okr_objective?: string | null; quote?: string | null;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "emp";
}

export async function createEmployee(data: EmployeeWrite): Promise<{ id: string }> {
  const sql = db();
  const base = slugify(data.nama);
  let id = base, n = 1;
  while ((await sql`SELECT 1 FROM employee WHERE id = ${id}`).length) id = `${base}-${++n}`;
  await sql`
    INSERT INTO employee (id, nama, dept, role, atasan_raw, lokasi, masa, panggilan, cabang, whatsapp, roster_pending, okr_objective, quote)
    VALUES (${id}, ${data.nama}, ${data.dept ?? null}, ${data.role ?? null}, ${data.atasan_raw ?? null}, ${data.lokasi ?? null},
            ${data.masa ?? null}, ${data.panggilan ?? null}, ${data.cabang ?? null}, ${data.whatsapp ?? null},
            ${data.roster_pending ?? false}, ${data.okr_objective ?? null}, ${data.quote ?? null})`;
  return { id };
}

export async function updateEmployee(id: string, data: EmployeeWrite): Promise<{ updated: boolean }> {
  const r = await db()`
    UPDATE employee SET
      nama = ${data.nama}, dept = ${data.dept ?? null}, role = ${data.role ?? null}, atasan_raw = ${data.atasan_raw ?? null},
      lokasi = ${data.lokasi ?? null}, masa = ${data.masa ?? null}, panggilan = ${data.panggilan ?? null},
      cabang = ${data.cabang ?? null}, whatsapp = ${data.whatsapp ?? null}, roster_pending = ${data.roster_pending ?? false},
      okr_objective = ${data.okr_objective ?? null}, quote = ${data.quote ?? null}
    WHERE id = ${id}`;
  return { updated: r.count > 0 };
}

// Hapus karyawan — child (kpi/bsc/okr/pdca/raci/voice/tool/task + kpi_measurement)
// ikut terhapus via ON DELETE CASCADE.
export async function deleteEmployee(id: string): Promise<{ deleted: boolean }> {
  const r = await db()`DELETE FROM employee WHERE id = ${id}`;
  return { deleted: r.count > 0 };
}

// F118c — replace SEMUA sub-koleksi profil (transaksional). Koleksi tanpa dependen
// (tools/tasks/OKR-KR/BSC/PDCA/RACI/Voice) delete+reinsert. KPI id-aware (UPDATE yg
// ber-id, INSERT yg baru, DELETE yg dibuang) supaya kpi_measurement (F119b) yang
// ter-taut ke KPI lama TIDAK ikut ke-cascade-hapus.
export interface SpineDetail {
  tools: string[]; tasks: string[]; okr_kr: string[]; pain: string[]; idea: string[];
  bsc: { fin: string[]; cust: string[]; proc: string[]; learn: string[] };
  pdca: { plan: string | null; do: string | null; check: string | null; act: string | null } | null;
  kpi: { id?: string | null; name: string; target?: string | null; frequency?: string | null; perspective?: string | null; lower_better?: boolean }[];
  raci: { process: string; role_type: string; note?: string | null }[];
}

export async function replaceEmployeeDetail(id: string, d: SpineDetail): Promise<{ ok: boolean }> {
  const sql = db();
  if (!(await sql`SELECT 1 FROM employee WHERE id = ${id}`).length) return { ok: false };
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
  await sql.begin(async (tx) => {
    // ── list sederhana: delete + reinsert ──
    await tx`DELETE FROM employee_tool WHERE employee_id = ${id}`;
    { const arr = clean(d.tools); for (let i = 0; i < arr.length; i++) await tx`INSERT INTO employee_tool (employee_id, tool, seq) VALUES (${id}, ${arr[i]}, ${i})`; }
    await tx`DELETE FROM employee_task WHERE employee_id = ${id}`;
    { const arr = clean(d.tasks); for (let i = 0; i < arr.length; i++) await tx`INSERT INTO employee_task (employee_id, task, seq) VALUES (${id}, ${arr[i]}, ${i})`; }
    await tx`DELETE FROM okr_key_result WHERE employee_id = ${id}`;
    { const arr = clean(d.okr_kr); for (let i = 0; i < arr.length; i++) await tx`INSERT INTO okr_key_result (employee_id, key_result, seq) VALUES (${id}, ${arr[i]}, ${i})`; }
    await tx`DELETE FROM bsc_objective WHERE employee_id = ${id}`;
    for (const p of ["fin", "cust", "proc", "learn"] as const) {
      const arr = clean(d.bsc?.[p] ?? []);
      for (let i = 0; i < arr.length; i++) await tx`INSERT INTO bsc_objective (employee_id, perspective, objective, seq) VALUES (${id}, ${p}, ${arr[i]}, ${i})`;
    }
    await tx`DELETE FROM voice_item WHERE employee_id = ${id}`;
    { const arr = clean(d.pain); for (let i = 0; i < arr.length; i++) await tx`INSERT INTO voice_item (employee_id, kind, content, seq) VALUES (${id}, 'pain', ${arr[i]}, ${i})`; }
    { const arr = clean(d.idea); for (let i = 0; i < arr.length; i++) await tx`INSERT INTO voice_item (employee_id, kind, content, seq) VALUES (${id}, 'idea', ${arr[i]}, ${i})`; }
    await tx`DELETE FROM pdca_cycle WHERE employee_id = ${id}`;
    const pd = d.pdca;
    if (pd && (pd.plan || pd.do || pd.check || pd.act)) {
      await tx`INSERT INTO pdca_cycle (employee_id, plan_step, do_step, check_step, act_step, seq) VALUES (${id}, ${pd.plan ?? null}, ${pd.do ?? null}, ${pd.check ?? null}, ${pd.act ?? null}, 0)`;
    }
    await tx`DELETE FROM raci_assignment WHERE employee_id = ${id}`;
    { let s = 0; for (const r of d.raci ?? []) { if (r.process?.trim() && r.role_type?.trim()) { await tx`INSERT INTO raci_assignment (employee_id, process, role_type, note, seq) VALUES (${id}, ${r.process.trim()}, ${r.role_type.trim()}, ${r.note?.trim() || null}, ${s++})`; } } }
    // ── KPI: id-aware (jaga kpi_measurement) ──
    const rows = (d.kpi ?? []).filter((k) => k.name?.trim());
    const keep = rows.filter((k) => k.id).map((k) => String(k.id));
    if (keep.length) await tx`DELETE FROM kpi WHERE employee_id = ${id} AND id::text <> ALL(${keep})`;
    else await tx`DELETE FROM kpi WHERE employee_id = ${id}`;
    for (let i = 0; i < rows.length; i++) {
      const k = rows[i];
      const persp = k.perspective && ["fin", "cust", "proc", "learn"].includes(k.perspective) ? k.perspective : null;
      if (k.id) {
        await tx`UPDATE kpi SET name = ${k.name.trim()}, target = ${k.target ?? null}, frequency = ${k.frequency ?? null}, perspective = ${persp}, lower_better = ${k.lower_better ?? false}, seq = ${i} WHERE id = ${Number(k.id)} AND employee_id = ${id}`;
      } else {
        await tx`INSERT INTO kpi (employee_id, name, target, frequency, perspective, lower_better, seq) VALUES (${id}, ${k.name.trim()}, ${k.target ?? null}, ${k.frequency ?? null}, ${persp}, ${k.lower_better ?? false}, ${i})`;
      }
    }
  });
  return { ok: true };
}

// F128 Voice of Employee (tab Kendala & Usulan) — agregat pain/idea lintas karyawan (+dept) untuk
// surface tema/keluhan org-wide. Read-only; sumber voice_item (spine F118).
export async function getVoiceAggregate() {
  const rows = await db()`
    SELECT v.kind, v.content, v.employee_id, e.nama, e.dept, d.label AS dept_label, d.color AS dept_color
    FROM voice_item v
    JOIN employee e ON e.id = v.employee_id
    LEFT JOIN department d ON d.key = e.dept
    ORDER BY d.label NULLS LAST, e.nama, v.kind, v.seq`;
  return {
    items: rows.map((r) => ({
      kind: String(r.kind), content: String(r.content), employee_id: String(r.employee_id), nama: String(r.nama),
      dept: r.dept ? String(r.dept) : null, dept_label: r.dept_label ? String(r.dept_label) : null, dept_color: r.dept_color ? String(r.dept_color) : null,
    })),
  };
}

// F121 — jalankan HoD resolver atas atasan_raw semua karyawan (read-only preview).
// status: resolved (1 HoD) · ambiguous (multi-HOD) · none (perlu review manual).
// Foundation utk populate hod_key + Org Chart reporting-line (ORG_OPTIMAL).
export async function getHodResolution() {
  const emps = await db()`
    SELECT e.id, e.nama, e.atasan_raw, d.label AS dept_label
    FROM employee e LEFT JOIN department d ON d.key = e.dept
    ORDER BY d.label NULLS LAST, e.nama`;
  const nameByKey = Object.fromEntries(HODS.map((h) => [h.key, h.name]));
  const rows = emps.map((e) => {
    const raw = e.atasan_raw ? String(e.atasan_raw) : "";
    const keys = raw ? resolveHods(raw) : [];
    const status = keys.length === 1 ? "resolved" : keys.length > 1 ? "ambiguous" : "none";
    return {
      id: String(e.id), nama: String(e.nama), dept_label: e.dept_label ? String(e.dept_label) : null,
      atasan_raw: raw, hod_keys: keys, hod_names: keys.map((k) => nameByKey[k] ?? k), status,
    };
  });
  const summary = {
    total: rows.length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    ambiguous: rows.filter((r) => r.status === "ambiguous").length,
    none: rows.filter((r) => r.status === "none").length,
  };
  return { rows, summary, hods: HODS.map((h) => ({ key: h.key, name: h.name, role: h.role })) };
}
