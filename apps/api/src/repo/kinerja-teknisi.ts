// Kinerja Teknisi (menu /kinerja-teknisi, grup Aftersales) — keputusan user 16 Nov 2026.
//
// Dua tampilan:
//   - Jadwal: per teknisi, gabungan PM jatuh tempo (maintenance_schedule), kunjungan rutin (jadwal_rutin),
//     jadwal install (install_schedule) dan tiket servis terbuka (service_ticket) — yang lewat waktu ikut tampil.
//   - Plan & Report: per pekerjaan dari teknisi_kerja_v (F175 #PLAN/#START/#REPORT, migrasi 323/325) —
//     durasi, SLA tiket (respon = tiket masuk → #START, selesai = tiket masuk → #REPORT), lewat ETA,
//     lokasi foto report, dan tanda kepatuhan; plus ringkasan per teknisi.
//
// Cakupan (ditegakkan DI SINI dari x-user-id, BFF hanya menggerbang menu):
//   - tanpa x-user-id (operator/service)          → semua teknisi
//   - admin / direktur / superuser / izin `kinerja-teknisi-semua` (HoD Aftersales lewat Akses Grup) → semua
//   - selain itu → hanya teknisi yang tertaut ke akunnya (app_user.am_id); tanpa tautan → kosong
import { db } from "../db.js";
import { effectivePermissions } from "./rbac.js";

export const FITUR_SEMUA = "kinerja-teknisi-semua";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Rentang tanggal maksimal per permintaan (hari). */
export const MAKS_RENTANG_HARI = 92;

export class KinerjaError extends Error {
  constructor(public status: 400 | 403, message: string) { super(message); }
}

export type CakupanKinerja = { semua: true } | { semua: false; amId: string | null };

export interface IdentitasKinerja {
  role: string | null;
  superuser: boolean;
  semuaView: boolean;
  amId: string | null;
}

/** Pure — diuji unit. */
export function putuskanCakupanKinerja(headerAda: boolean, u: IdentitasKinerja | null): CakupanKinerja {
  if (!headerAda) return { semua: true };
  if (!u) return { semua: false, amId: null };
  const role = (u.role ?? "").trim().toLowerCase();
  if (u.superuser || role === "admin" || role === "direktur" || u.semuaView) return { semua: true };
  return { semua: false, amId: u.amId?.trim() || null };
}

export async function cakupanKinerja(userId: string | undefined): Promise<CakupanKinerja> {
  if (userId === undefined) return putuskanCakupanKinerja(false, null);
  const id = userId.trim();
  if (!UUID_RE.test(id)) return putuskanCakupanKinerja(true, null);
  const sql = db();
  const [u] = await sql`SELECT role, am_id FROM app_user WHERE id = ${id}`;
  if (!u) return putuskanCakupanKinerja(true, null);
  const eff = await effectivePermissions(id);
  const p = eff.permissions[FITUR_SEMUA];
  return putuskanCakupanKinerja(true, {
    role: u.role ?? null, superuser: eff.superuser, semuaView: !!p && p.active && p.view, amId: u.am_id ?? null,
  });
}

/**
 * Filter teknisi efektif: cakupan terbatas → selalu teknisinya sendiri (param `teknisi` diabaikan);
 * cakupan semua → param `teknisi` (opsional). Mengembalikan undefined = semua teknisi,
 * null = tidak ada teknisi (akun tak tertaut) → hasil kosong.
 */
export function teknisiEfektif(c: CakupanKinerja, param: string | null | undefined): string | null | undefined {
  if (!c.semua) return c.amId;
  const p = (param ?? "").trim();
  return p ? p : undefined;
}

export function bacaRentang(dari: unknown, sampai: unknown, hariIni: string): { dari: string; sampai: string } {
  const d = typeof dari === "string" && dari ? dari : hariIni;
  const s = typeof sampai === "string" && sampai ? sampai : d;
  if (!TGL_RE.test(d) || Number.isNaN(Date.parse(d))) throw new KinerjaError(400, "dari harus YYYY-MM-DD");
  if (!TGL_RE.test(s) || Number.isNaN(Date.parse(s))) throw new KinerjaError(400, "sampai harus YYYY-MM-DD");
  if (s < d) throw new KinerjaError(400, "sampai tak boleh sebelum dari");
  const hari = (Date.parse(s) - Date.parse(d)) / 86_400_000;
  if (hari > MAKS_RENTANG_HARI) throw new KinerjaError(400, `rentang maksimal ${MAKS_RENTANG_HARI} hari`);
  return { dari: d, sampai: s };
}

export const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

// ───────────────────────── Daftar teknisi ─────────────────────────

export interface TeknisiRow { am_id: string; nama: string; aktif: boolean }

export async function daftarTeknisi(c: CakupanKinerja): Promise<TeknisiRow[]> {
  const sql = db();
  const filter = teknisiEfektif(c, null);
  if (filter === null) return [];
  const rows = await sql`
    SELECT am_id, COALESCE(NULLIF(panggilan, ''), nama) AS nama, aktif FROM master_user
    WHERE upper(btrim(coalesce(role, ''))) = 'TEKNISI' ${filter ? sql`AND am_id = ${filter}` : sql``}
    ORDER BY aktif DESC, nama`;
  return rows.map((r) => ({ am_id: String(r.am_id), nama: String(r.nama), aktif: !!r.aktif }));
}

// ───────────────────────── Jadwal ─────────────────────────

export type JenisJadwal = "PM" | "Kunjungan rutin" | "Install" | "Service";

export interface JadwalRow {
  tanggal: string;
  jenis: JenisJadwal;
  teknisi_id: string | null;
  teknisi_nama: string | null;
  faskes: string | null;
  alat: string | null;
  status: string;
  /** Tanggal sudah lewat tapi belum selesai. */
  terlambat: boolean;
  ref_id: string;
}

/**
 * Jadwal dalam rentang + yang LEWAT WAKTU tapi belum selesai (tanggal < dari, masih terbuka) —
 * supaya tunggakan tak hilang dari pandangan saat melihat minggu ini.
 */
export async function jadwalTeknisi(c: CakupanKinerja, q: { teknisi?: string | null; dari: string; sampai: string }): Promise<JadwalRow[]> {
  const filter = teknisiEfektif(c, q.teknisi);
  if (filter === null) return [];
  const sql = db();
  const hariIni = hariIniWib();
  const tek = (kolom: ReturnType<typeof sql>) => (filter ? sql`AND ${kolom} = ${filter}` : sql``);
  const rows = await sql`
    SELECT * FROM (
      SELECT ms.due_date AS tanggal, 'PM' AS jenis, tc.am_id AS teknisi_id,
             COALESCE(NULLIF(mt.panggilan, ''), mt.nama, tc.nama, ms.teknisi_name) AS teknisi_nama, iu.customer_name AS faskes,
             concat_ws(' · ', iu.alat_name, iu.serial_number) AS alat, ms.status, ms.id::text AS ref_id,
             true AS terbuka
      FROM maintenance_schedule ms
      JOIN installation_unit iu ON iu.id = ms.installation_unit_id
      LEFT JOIN teknisi_capacity tc ON tc.id = ms.teknisi_id
      LEFT JOIN master_user mt ON mt.am_id = tc.am_id
      WHERE ms.due_date <= ${q.sampai}::date ${tek(sql`tc.am_id`)}
      UNION ALL
      SELECT jr.tanggal, 'Kunjungan rutin', jr.teknisi_id, COALESCE(NULLIF(mu.panggilan, ''), mu.nama),
             ac.name, jsonb_array_length(COALESCE(jr.alat, '[]'::jsonb)) || ' alat', jr.status, jr.id::text,
             jr.status = 'rencana'
      FROM jadwal_rutin jr
      LEFT JOIN master_user mu ON mu.am_id = jr.teknisi_id
      LEFT JOIN accurate_customer ac ON ac.id = jr.account_id
      WHERE jr.status <> 'batal' AND jr.tanggal <= ${q.sampai}::date
        AND (jr.tanggal >= ${q.dari}::date OR jr.status = 'rencana') ${tek(sql`jr.teknisi_id`)}
      UNION ALL
      SELECT isch.scheduled_date, 'Install', tc.am_id, COALESCE(NULLIF(mt.panggilan, ''), mt.nama, tc.nama), iu.customer_name,
             concat_ws(' · ', iu.alat_name, iu.serial_number), isch.status, isch.id::text,
             isch.status = 'scheduled'
      FROM install_schedule isch
      JOIN installation_unit iu ON iu.id = isch.installation_unit_id
      LEFT JOIN teknisi_capacity tc ON tc.id = isch.teknisi_id
      LEFT JOIN master_user mt ON mt.am_id = tc.am_id
      WHERE isch.status <> 'cancelled' AND isch.scheduled_date <= ${q.sampai}::date
        AND (isch.scheduled_date >= ${q.dari}::date OR isch.status = 'scheduled') ${tek(sql`tc.am_id`)}
      UNION ALL
      SELECT (COALESCE(st.eta_at, st.created_at) AT TIME ZONE 'Asia/Jakarta')::date, 'Service', tc.am_id,
             COALESCE(NULLIF(mt.panggilan, ''), mt.nama, tc.nama, st.assigned_teknisi_name), st.customer_name, left(st.complaint_text, 80),
             st.status, st.id::text, true
      FROM service_ticket st
      LEFT JOIN teknisi_capacity tc ON tc.id = st.assigned_teknisi_id
      LEFT JOIN master_user mt ON mt.am_id = tc.am_id
      WHERE st.status = 'open' ${tek(sql`tc.am_id`)}
    ) j
    -- PM: hanya yang jatuh tempo di rentang ATAU sudah lewat (selalu "terbuka" sampai dikerjakan).
    WHERE NOT (jenis = 'PM' AND tanggal < ${q.dari}::date AND tanggal >= ${hariIni}::date)
    ORDER BY tanggal, jenis, teknisi_nama NULLS LAST
    LIMIT 2000`;
  return rows.map((r) => {
    const tanggal = String(r.tanggal instanceof Date ? r.tanggal.toISOString().slice(0, 10) : r.tanggal).slice(0, 10);
    return {
      tanggal, jenis: r.jenis as JenisJadwal, teknisi_id: r.teknisi_id ?? null, teknisi_nama: r.teknisi_nama ?? null,
      faskes: r.faskes ?? null, alat: r.alat ?? null, status: String(r.status), ref_id: String(r.ref_id),
      terlambat: !!r.terbuka && tanggal < hariIni,
    };
  });
}

// ───────────────────────── Plan & Report (kerja) ─────────────────────────

export interface KerjaRow {
  plan_item_id: number;
  teknisi_id: string;
  teknisi_nama: string | null;
  tanggal: string;
  urut: number;
  jenis: string;
  faskes: string | null;
  di_luar_plan: boolean;
  plan_telat: boolean;
  started_at: string | null;
  selesai_at: string | null;
  status_report: string | null;
  durasi_menit: number | null;
  report_tanpa_start: boolean;
  start_tanpa_report: boolean;
  tanpa_laporan: boolean;
  berlokasi: boolean;
  lokasi_alamat: string | null;
  jumlah_foto: number;
  sla_respon_menit: number | null;
  sla_selesai_menit: number | null;
  /** Tiket selesai melewati ETA (atau masih terbuka & ETA sudah lewat) — target SLA = ETA tiket. */
  lewat_eta: boolean | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export async function kerjaTeknisi(c: CakupanKinerja, q: { teknisi?: string | null; dari: string; sampai: string }): Promise<KerjaRow[]> {
  const filter = teknisiEfektif(c, q.teknisi);
  if (filter === null) return [];
  const sql = db();
  const rows = await sql`
    SELECT v.*, COALESCE(NULLIF(mu.panggilan, ''), mu.nama) AS teknisi_nama, t.eta_at
    FROM teknisi_kerja_v v
    LEFT JOIN master_user mu ON mu.am_id = v.teknisi_id
    LEFT JOIN service_ticket t ON t.id = v.service_ticket_id
    WHERE v.tanggal BETWEEN ${q.dari}::date AND ${q.sampai}::date ${filter ? sql`AND v.teknisi_id = ${filter}` : sql``}
    ORDER BY v.tanggal DESC, teknisi_nama, v.urut
    LIMIT 3000`;
  const sekarang = Date.now();
  return rows.map((r) => {
    const eta = r.eta_at ? new Date(r.eta_at as string).getTime() : null;
    const selesai = r.selesai_at ? new Date(r.selesai_at as string).getTime() : null;
    const lewat = eta == null ? null : selesai != null ? selesai > eta : sekarang > eta;
    return {
      plan_item_id: Number(r.plan_item_id), teknisi_id: String(r.teknisi_id), teknisi_nama: r.teknisi_nama ?? null,
      tanggal: String(r.tanggal instanceof Date ? r.tanggal.toISOString().slice(0, 10) : r.tanggal).slice(0, 10),
      urut: Number(r.urut), jenis: String(r.jenis), faskes: r.faskes_teks ?? null, di_luar_plan: !!r.di_luar_plan,
      plan_telat: !!r.plan_telat, started_at: iso(r.started_at), selesai_at: iso(r.selesai_at),
      status_report: r.status_report ?? null, durasi_menit: num(r.durasi_menit),
      report_tanpa_start: !!r.report_tanpa_start, start_tanpa_report: !!r.start_tanpa_report,
      tanpa_laporan: r.tidak_realisasi_at != null && r.selesai_at == null,
      berlokasi: !!r.berlokasi, lokasi_alamat: r.lokasi_alamat ?? null, jumlah_foto: Number(r.jumlah_foto ?? 0),
      sla_respon_menit: num(r.sla_respon_menit), sla_selesai_menit: num(r.sla_selesai_menit), lewat_eta: lewat,
    };
  });
}

export interface RingkasanTeknisi {
  teknisi_id: string;
  teknisi_nama: string | null;
  pekerjaan: number;
  di_luar_plan: number;
  dimulai: number;
  dilaporkan: number;
  selesai: number;
  report_tanpa_start: number;
  start_tanpa_report: number;
  tanpa_laporan: number;
  hari_plan_telat: number;
  report_berlokasi: number;
  rata_durasi_menit: number | null;
  tiket: number;
  rata_sla_respon_menit: number | null;
  rata_sla_selesai_menit: number | null;
  lewat_eta: number;
}

const rata = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Pure — diuji unit. Satu baris per teknisi, urut nama. */
export function ringkasKerja(rows: KerjaRow[]): RingkasanTeknisi[] {
  const per = new Map<string, KerjaRow[]>();
  for (const r of rows) per.set(r.teknisi_id, [...(per.get(r.teknisi_id) ?? []), r]);
  return [...per.entries()].map(([teknisi_id, xs]) => {
    const dilaporkan = xs.filter((x) => x.selesai_at != null);
    const tiket = xs.filter((x) => x.sla_respon_menit != null || x.sla_selesai_menit != null || x.lewat_eta != null);
    return {
      teknisi_id, teknisi_nama: xs[0].teknisi_nama,
      pekerjaan: xs.length,
      di_luar_plan: xs.filter((x) => x.di_luar_plan).length,
      dimulai: xs.filter((x) => x.started_at != null).length,
      dilaporkan: dilaporkan.length,
      selesai: xs.filter((x) => x.status_report === "Selesai").length,
      report_tanpa_start: xs.filter((x) => x.report_tanpa_start).length,
      start_tanpa_report: xs.filter((x) => x.start_tanpa_report).length,
      tanpa_laporan: xs.filter((x) => x.tanpa_laporan).length,
      hari_plan_telat: new Set(xs.filter((x) => x.plan_telat && !x.di_luar_plan).map((x) => x.tanggal)).size,
      report_berlokasi: dilaporkan.filter((x) => x.berlokasi).length,
      rata_durasi_menit: rata(xs.map((x) => x.durasi_menit).filter((v): v is number => v != null)),
      tiket: tiket.length,
      rata_sla_respon_menit: rata(tiket.map((x) => x.sla_respon_menit).filter((v): v is number => v != null)),
      rata_sla_selesai_menit: rata(tiket.map((x) => x.sla_selesai_menit).filter((v): v is number => v != null)),
      lewat_eta: tiket.filter((x) => x.lewat_eta === true).length,
    };
  }).sort((a, b) => (a.teknisi_nama ?? a.teknisi_id).localeCompare(b.teknisi_nama ?? b.teknisi_id));
}
