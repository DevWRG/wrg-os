import { db } from "../db.js";
import { namaUji } from "./wa-test-bypass.js";

// postgres.js parse kolom date/timestamptz jadi objek Date — String(dateObj)
// hasilnya verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString()
// aman dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoDate = (x: unknown): string => toIsoTs(x).slice(0, 10);

// `new Date()` JS TOLERAN overflow (mis. "2027-02-30" diam-diam jadi
// "2027-03-02", getTime() tetap valid) — round-trip lewat toISOString() utk
// pastikan tanggal yang masuk beneran ada di kalender. Pola sama isIsoDate()
// di repo/vehicle.ts & repo/maintenance.ts.
const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// F8 — Teknisi Readiness Board (AFTERSALES). Install scheduling + capacity +
// post-install reports. install_schedule FK ke installation_unit (F22).
// teknisi_report dipakai jalur manual DAN hook WA (#install/#servis/#training/
// #kalibrasi, lihat inbound.ts).
//
// Roster teknisi = master_user role Teknisi (migrasi 246, keputusan user
// 25 Okt 2026 — satu sumber dengan F154 Jadwal Teknisi). teknisi_capacity
// tinggal menyimpan KAPASITAS; nama/wa_number/aktif disalin trigger dari
// master_user (diubah lewat menu Users), wilayah dibaca dari teknisi_wilayah
// F154 (diatur di Jadwal Teknisi). Kolom teknisi_capacity.wilayah (175) mati.

export interface Teknisi {
  id: string;
  am_id: string | null;
  nama: string;
  wa_number: string | null;
  wilayah: string[];
  max_concurrent_jobs: number;
  aktif: boolean;
}

function mapTeknisi(r: Record<string, unknown>): Teknisi {
  return {
    id: String(r.id),
    am_id: r.am_id ? String(r.am_id) : null,
    nama: String(r.nama),
    wa_number: r.wa_number ? String(r.wa_number) : null,
    wilayah: Array.isArray(r.wilayah) ? (r.wilayah as string[]) : [],
    max_concurrent_jobs: Number(r.max_concurrent_jobs),
    aktif: Boolean(r.aktif),
  };
}

// Kolom teknisi + wilayah F154. Baris lama di luar master_user yang sudah
// nonaktif (dummy dev, isian manual pra-246) disembunyikan dari roster.
const KOLOM_TEKNISI = (sql: ReturnType<typeof db>) => sql`
  tc.id, tc.am_id, tc.nama, tc.wa_number, tc.max_concurrent_jobs, tc.aktif,
  COALESCE((SELECT array_agg(tw.wilayah ORDER BY tw.wilayah) FROM teknisi_wilayah tw
            WHERE tw.teknisi_id = tc.am_id), '{}') AS wilayah`;
const ROSTER_TAMPIL = (sql: ReturnType<typeof db>) => sql`(tc.am_id IS NOT NULL OR tc.aktif)`;

export async function listTeknisiCapacity(): Promise<Teknisi[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${KOLOM_TEKNISI(sql)} FROM teknisi_capacity tc
    WHERE ${ROSTER_TAMPIL(sql)} ORDER BY tc.aktif DESC, tc.nama`;
  return rows.map(mapTeknisi);
}

// Auto-provision teknisi per pushname WA (idempoten, keyed nama karena UNIQUE) —
// dipanggil HANYA dari inbound.ts saat grup bypass aktif (wa-test-bypass.ts).
// Tiap orang di grup uji dapat baris sendiri (bukan berbagi satu identitas).
//
// Namanya WAJIB lewat namaUji() → `[UJI] <pushname>`. Baris ini tak punya am_id
// (di luar master_user), dan prefiks itu yang membuat sinkron 246 tidak
// menonaktifkannya — juga satu-satunya pembeda dari teknisi sungguhan di
// Readiness Board, dropdown penugasan tiket, dan saat pembersihan
// (`WHERE nama LIKE '[UJI] %'`). Lihat catatan FK di wa-test-bypass.ts.
export async function ensureBypassTeknisi(pushname: string, waNumber?: string | null): Promise<Teknisi> {
  const sql = db();
  const nama = namaUji(pushname);
  const [row] = await sql`
    INSERT INTO teknisi_capacity (nama, wa_number, aktif)
    VALUES (${nama}, ${waNumber ?? null}, true)
    ON CONFLICT (nama) DO UPDATE SET aktif = true, wa_number = EXCLUDED.wa_number
    RETURNING id
  `;
  const [t] = await sql`SELECT ${KOLOM_TEKNISI(sql)} FROM teknisi_capacity tc WHERE tc.id = ${row.id}`;
  return mapTeknisi(t);
}

// Hanya kapasitas yang diubah di sini. Nama/WA/aktif ikut master_user (menu
// Users), wilayah ikut Jadwal Teknisi — klien lama yang masih mengirimnya
// ditolak jelas, bukan diabaikan diam-diam.
export interface UpdateTeknisiInput {
  max_concurrent_jobs?: number;
  nama?: unknown;
  wa_number?: unknown;
  wilayah?: unknown;
  aktif?: unknown;
}

export async function updateTeknisiCapacity(
  id: string,
  input: UpdateTeknisiInput,
): Promise<Teknisi | { ok: false; error: string }> {
  const sql = db();
  if (input.nama !== undefined || input.wa_number !== undefined || input.aktif !== undefined) {
    return { ok: false, error: "nama, No. WA, dan status aktif teknisi diubah di menu Users (master user role Teknisi)" };
  }
  if (input.wilayah !== undefined) {
    return { ok: false, error: "wilayah teknisi diatur di menu Jadwal Teknisi" };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "id teknisi tidak valid" };
  const maxJobs = input.max_concurrent_jobs;
  // DB CHECK cuma > 0, tak ada batas atas — 1 teknisi realistisnya tak mungkin
  // pegang ratusan job bersamaan (pola sama F24 interval_bulan, QA 2026-09-07).
  if (maxJobs === undefined || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 50) {
    return { ok: false, error: "max_concurrent_jobs harus bilangan bulat 1-50" };
  }
  const rows = await sql`
    UPDATE teknisi_capacity SET max_concurrent_jobs = ${maxJobs}, updated_at = now()
    WHERE id = ${id} RETURNING id`;
  if (!rows.length) return { ok: false, error: "teknisi tidak ditemukan" };
  const [t] = await sql`SELECT ${KOLOM_TEKNISI(sql)} FROM teknisi_capacity tc WHERE tc.id = ${id}`;
  return mapTeknisi(t);
}

// Nama dinormalisasi untuk dibandingkan PERSIS: huruf kecil + spasi dirapikan.
// Pure — dipakai matchTeknisi (lewat SQL yang setara) & diuji unit.
export function normNamaTeknisi(s: string | null | undefined): string {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Identitas pengirim laporan teknisi (#install/#servis/#training/#kalibrasi).
// Dulu `nama ILIKE '%pushname%'` = POTONGAN nama: pushname "a" / "jar" dari grup
// sembarang lolos sebagai "Teknisi Fajar" (uji dev 11 Okt 2026). Keputusan user
// (opsi a): sah kalau pushname SAMA PERSIS dengan nama di roster (dinormalisasi)
// atau dengan panggilan master_user-nya (246), ATAU lewat chat PRIBADI dari
// nomor yang tercatat (di grup `sender_jid` = JID grup, nomor orangnya tak
// ada). Cocok ke >1 teknisi = ambigu → null.
export async function matchTeknisi(input: {
  pushname: string | null;
  senderJid: string | null;
  groupJid: string | null;
}): Promise<Teknisi | null> {
  const sql = db();
  const nama = normNamaTeknisi(input.pushname);
  if (nama) {
    const rows = await sql`
      SELECT ${KOLOM_TEKNISI(sql)} FROM teknisi_capacity tc
      LEFT JOIN master_user mu ON mu.am_id = tc.am_id
      WHERE tc.aktif = TRUE
        AND (lower(regexp_replace(btrim(tc.nama), '[[:space:]]+', ' ', 'g')) = ${nama}
          OR lower(regexp_replace(btrim(coalesce(mu.panggilan, '')), '[[:space:]]+', ' ', 'g')) = ${nama})
      LIMIT 2
    `;
    if (rows.length === 1) return mapTeknisi(rows[0]);
  }
  const isDm = !String(input.groupJid ?? "").endsWith("@g.us");
  const nomor = String(input.senderJid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
  if (isDm && nomor.length >= 9) {
    const rows = await sql`
      SELECT ${KOLOM_TEKNISI(sql)} FROM teknisi_capacity tc
      WHERE tc.aktif = TRUE AND regexp_replace(regexp_replace(coalesce(tc.wa_number, ''), '[^0-9]', '', 'g'), '^0', '62') = ${nomor.replace(/^0/, "62")}
      LIMIT 2
    `;
    if (rows.length === 1) return mapTeknisi(rows[0]);
  }
  return null;
}

export interface TeknisiReadiness extends Teknisi {
  capacity_used: number;
  capacity_available: number;
}

// Kapasitas terpakai = install_schedule 'scheduled' (F8 sendiri) + maintenance_schedule
// (F24) 'scheduled'/'notified' milik teknisi ini. Sejak migrasi 207 PM tertaut
// lewat teknisi_id (wajib pilih roster); baris lama tanpa teknisi_id masih
// dihitung lewat kecocokan nama persis seperti dulu. Rumus yang SAMA dipakai
// gerbang kapasitas createInstallSchedule — ubah keduanya bersamaan.
export async function getReadinessBoard(): Promise<TeknisiReadiness[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${KOLOM_TEKNISI(sql)},
      (SELECT COUNT(*) FROM install_schedule ins WHERE ins.teknisi_id = tc.id AND ins.status = 'scheduled') AS install_load,
      (SELECT COUNT(*) FROM maintenance_schedule ms
         WHERE (ms.teknisi_id = tc.id OR (ms.teknisi_id IS NULL AND ms.teknisi_name = tc.nama))
           AND ms.status IN ('scheduled','notified')) AS pm_load
    FROM teknisi_capacity tc
    WHERE ${ROSTER_TAMPIL(sql)}
    ORDER BY tc.aktif DESC, tc.nama
  `;
  return rows.map((r) => {
    const t = mapTeknisi(r);
    const used = Number(r.install_load) + Number(r.pm_load);
    return { ...t, capacity_used: used, capacity_available: Math.max(0, t.max_concurrent_jobs - used) };
  });
}

export interface InstallScheduleRow {
  id: string;
  installation_unit_id: string;
  alat_name: string;
  customer_name: string;
  teknisi_id: string | null;
  teknisi_nama: string | null;
  scheduled_date: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function mapSchedule(r: Record<string, unknown>): InstallScheduleRow {
  return {
    id: String(r.id),
    installation_unit_id: String(r.installation_unit_id),
    alat_name: String(r.alat_name),
    customer_name: String(r.customer_name),
    teknisi_id: r.teknisi_id ? String(r.teknisi_id) : null,
    teknisi_nama: r.teknisi_nama ? String(r.teknisi_nama) : null,
    scheduled_date: toIsoDate(r.scheduled_date),
    status: String(r.status),
    note: r.note ? String(r.note) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export interface CreateScheduleInput {
  installation_unit_id: string;
  teknisi_id?: string | null;
  scheduled_date: string;
  note?: string | null;
}

export async function createInstallSchedule(
  input: CreateScheduleInput,
): Promise<InstallScheduleRow | { ok: false; error: string }> {
  const sql = db();
  if (!isIsoDate(input.scheduled_date)) {
    return { ok: false, error: `scheduled_date "${input.scheduled_date}" bukan tanggal valid (format YYYY-MM-DD)` };
  }
  // Semua cek + INSERT dalam SATU transaksi, dengan baris unit (dan teknisi)
  // dikunci FOR UPDATE. Dulu cek-lalu-INSERT polos: 5 POST paralel untuk unit
  // yang sama → 5 jadwal aktif, dan kuota teknisi bisa dilewati lewat paralel
  // juga (uji dev 12 Okt 2026). Kunci unit menyerialkan "sudah punya jadwal
  // aktif?", kunci teknisi menyerialkan hitungan kapasitas.
  const r = await sql.begin(async (tx) => {
    const [unit] = await tx`
      SELECT id, bast_done,
        ${input.scheduled_date}::date < (now() AT TIME ZONE 'Asia/Jakarta')::date AS lampau
      FROM installation_unit WHERE id = ${input.installation_unit_id} FOR UPDATE
    `;
    if (!unit) return { ok: false as const, error: "alat (installation_unit) tidak ditemukan" };
    // Alat yang sudah BAST sudah terpasang & diserahterimakan — jadwal instalasi
    // baru untuknya hanya memakan kapasitas teknisi. Unit yang belum BAST (status
    // apa pun, termasuk draft) tetap boleh: menjadwalkan jauh hari itu wajar.
    if (unit.bast_done) {
      return { ok: false as const, error: "alat ini sudah BAST — instalasinya selesai, tak perlu dijadwalkan lagi" };
    }
    if (unit.lampau) {
      return { ok: false as const, error: `scheduled_date ${input.scheduled_date} sudah lewat — jadwal instalasi harus hari ini atau sesudahnya` };
    }
    // Tanpa guard ini, submit ganda/paralel bikin 2 jadwal terpisah utk unit &
    // tanggal yang sama — teknisi dijadwalkan 2x utk kerjaan sama, readiness
    // board double-count kapasitas (ditemukan QA jalur tulis 2026-09-07).
    const existingSchedule = await tx`
      SELECT id FROM install_schedule WHERE installation_unit_id = ${input.installation_unit_id} AND status = 'scheduled'
    `;
    if (existingSchedule.length > 0) {
      return { ok: false as const, error: "alat ini sudah punya jadwal instalasi aktif (status scheduled)" };
    }
    if (input.teknisi_id) {
      const [tek] = await tx`
        SELECT id, nama, aktif, max_concurrent_jobs FROM teknisi_capacity WHERE id = ${input.teknisi_id} FOR UPDATE`;
      if (!tek) return { ok: false as const, error: "teknisi tidak ditemukan" };
      if (!tek.aktif) return { ok: false as const, error: `teknisi "${tek.nama}" sudah nonaktif — pilih teknisi lain` };
      // Kapasitas dihitung dengan rumus yang SAMA dengan getReadinessBoard()
      // (jadwal install 'scheduled' + PM F24 milik teknisi ini) supaya
      // angka penolakan = angka yang terlihat di board.
      const [beban] = await tx`
        SELECT
          (SELECT COUNT(*) FROM install_schedule ins WHERE ins.teknisi_id = ${tek.id} AND ins.status = 'scheduled')
          + (SELECT COUNT(*) FROM maintenance_schedule ms
               WHERE (ms.teknisi_id = ${tek.id} OR (ms.teknisi_id IS NULL AND ms.teknisi_name = ${tek.nama}))
                 AND ms.status IN ('scheduled','notified'))
          AS used
      `;
      if (Number(beban.used) >= Number(tek.max_concurrent_jobs)) {
        return {
          ok: false as const,
          error: `kapasitas teknisi "${tek.nama}" penuh (${Number(beban.used)}/${Number(tek.max_concurrent_jobs)} pekerjaan aktif) — pilih teknisi lain atau selesaikan jadwal yang ada`,
        };
      }
    }
    const [row] = await tx`
      INSERT INTO install_schedule (installation_unit_id, teknisi_id, scheduled_date, note)
      VALUES (${input.installation_unit_id}, ${input.teknisi_id ?? null}, ${input.scheduled_date}, ${input.note ?? null})
      RETURNING id
    `;
    return { ok: true as const, id: String(row.id) };
  });
  if (!r.ok) return r;
  return (await getScheduleById(r.id)) as InstallScheduleRow;
}

async function getScheduleById(id: string): Promise<InstallScheduleRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ins.*, iu.alat_name, iu.customer_name, tc.nama AS teknisi_nama
    FROM install_schedule ins
    JOIN installation_unit iu ON iu.id = ins.installation_unit_id
    LEFT JOIN teknisi_capacity tc ON tc.id = ins.teknisi_id
    WHERE ins.id = ${id}
  `;
  return rows.length ? mapSchedule(rows[0]) : null;
}

export async function listInstallSchedule(status?: string): Promise<InstallScheduleRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ins.*, iu.alat_name, iu.customer_name, tc.nama AS teknisi_nama
    FROM install_schedule ins
    JOIN installation_unit iu ON iu.id = ins.installation_unit_id
    LEFT JOIN teknisi_capacity tc ON tc.id = ins.teknisi_id
    WHERE ${status ? sql`ins.status = ${status}` : sql`true`}
    ORDER BY ins.scheduled_date ASC
  `;
  return rows.map(mapSchedule);
}

export async function updateScheduleStatus(
  id: string,
  status: "done" | "cancelled",
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`
    UPDATE install_schedule SET status = ${status}, updated_at = now()
    WHERE id = ${id} AND status = 'scheduled'
    RETURNING id
  `;
  if (rows.length === 0) {
    const exists = await sql`SELECT status FROM install_schedule WHERE id = ${id}`;
    if (exists.length === 0) return { ok: false, error: "schedule tidak ditemukan" };
    return { ok: false, error: `schedule sudah ${exists[0].status}` };
  }
  return { ok: true };
}

export interface TeknisiReportRow {
  id: string;
  teknisi_id: string | null;
  teknisi_nama: string | null;
  report_type: string;
  body: string;
  source: string;
  group_jid: string | null;
  wa_message_id: string | null;
  installation_unit_id: string | null;
  created_at: string;
}

function mapReport(r: Record<string, unknown>): TeknisiReportRow {
  return {
    id: String(r.id),
    teknisi_id: r.teknisi_id ? String(r.teknisi_id) : null,
    teknisi_nama: r.teknisi_nama ? String(r.teknisi_nama) : null,
    report_type: String(r.report_type),
    body: String(r.body),
    source: String(r.source),
    group_jid: r.group_jid ? String(r.group_jid) : null,
    wa_message_id: r.wa_message_id ? String(r.wa_message_id) : null,
    installation_unit_id: r.installation_unit_id ? String(r.installation_unit_id) : null,
    created_at: toIsoTs(r.created_at),
  };
}

export interface CreateReportInput {
  teknisi_id?: string | null;
  report_type: string;
  body: string;
  source?: "manual" | "wa";
  group_jid?: string | null;
  wa_message_id?: string | null;
  installation_unit_id?: string | null;
}

export async function createTeknisiReport(input: CreateReportInput): Promise<TeknisiReportRow> {
  const sql = db();

  // Idempotensi jalur WA — sama pola F26 (wa_message_id UNIQUE).
  if (input.wa_message_id) {
    const existing = await sql`
      SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
      LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
      WHERE tr.wa_message_id = ${input.wa_message_id}
    `;
    if (existing.length) return mapReport(existing[0]);
  }

  const rows = await sql`
    INSERT INTO teknisi_report (teknisi_id, report_type, body, source, group_jid, wa_message_id, installation_unit_id)
    VALUES (
      ${input.teknisi_id ?? null}, ${input.report_type}, ${input.body}, ${input.source ?? "manual"},
      ${input.group_jid ?? null}, ${input.wa_message_id ?? null}, ${input.installation_unit_id ?? null}
    )
    RETURNING id
  `;
  const created = await sql`
    SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
    LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
    WHERE tr.id = ${rows[0].id}
  `;
  return mapReport(created[0]);
}

export async function listTeknisiReports(reportType?: string): Promise<TeknisiReportRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
    LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
    WHERE ${reportType ? sql`tr.report_type = ${reportType}` : sql`true`}
    ORDER BY tr.created_at DESC
  `;
  return rows.map(mapReport);
}
