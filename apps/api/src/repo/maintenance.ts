import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// F24 — Preventive Maintenance & Kalibrasi Schedule (AFTERSALES). 1 baris
// RECURRING per alat (FK ke installation_unit dari F22): reminder H-14 sebelum
// due_date, teknisi tandai selesai → reference_date/due_date di-ADVANCE ke
// siklus berikutnya (bukan bikin baris baru). Teknisi dipilih dari roster
// teknisi_capacity (teknisi_id, migrasi 207); teknisi_name/teknisi_wa_number
// = snapshot. Baris lama (pra-207) masih teks bebas tanpa teknisi_id.

// postgres.js parse kolom date/timestamptz jadi objek Date — String(dateObj)
// hasilnya verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString()
// aman dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoDate = (x: unknown): string => toIsoTs(x).slice(0, 10);

// `new Date()` JS TOLERAN overflow (mis. "2027-02-30" diam-diam jadi
// "2027-03-02", getTime() tetap valid) — round-trip lewat toISOString() utk
// pastikan tanggal yang masuk beneran ada di kalender. Pola sama isIsoDate()
// di repo/vehicle.ts & repo/ga-maintenance.ts.
const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export interface EligibleUnit {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  bast_at: string | null;
}

// Alat yang sudah BAST (F22) tapi belum punya schedule PM — sumber dropdown create.
export async function listEligibleUnits(): Promise<EligibleUnit[]> {
  const sql = db();
  const rows = await sql`
    SELECT iu.id, iu.alat_name, iu.serial_number, iu.customer_name, iu.cabang, iu.bast_at
    FROM installation_unit iu
    WHERE iu.bast_done = TRUE
      AND NOT EXISTS (SELECT 1 FROM maintenance_schedule ms WHERE ms.installation_unit_id = iu.id)
    ORDER BY iu.bast_at DESC
  `;
  return rows.map((r) => ({
    id: String(r.id),
    alat_name: String(r.alat_name),
    serial_number: r.serial_number ? String(r.serial_number) : null,
    customer_name: String(r.customer_name),
    cabang: r.cabang ? String(r.cabang) : null,
    bast_at: r.bast_at ? toIsoTs(r.bast_at) : null,
  }));
}

export interface MaintenanceInput {
  installation_unit_id: string;
  interval_bulan: number;
  reference_date?: string | null;
  // Teknisi dipilih dari roster teknisi_capacity (F8) — migrasi 207, keputusan
  // user 2026-10-13. Nama & nomor WA TIDAK diterima dari klien lagi: keduanya
  // di-snapshot dari roster, supaya beban PM selalu terhitung di Readiness
  // Board (dulu dicocokkan lewat nama ketikan bebas → "Galih" ≠ "Galih Aldy
  // Prasetyo" → beban hilang). Kosong = belum ditugaskan.
  teknisi_id?: string | null;
  teknisi_name?: string | null; // hanya untuk menolak klien lama yang masih kirim nama
}

export interface MaintenanceRow {
  id: string;
  installation_unit_id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  interval_bulan: number;
  reference_date: string;
  due_date: string;
  teknisi_id: string | null;
  teknisi_name: string | null;
  teknisi_wa_number: string | null;
  status: string;
  notified_at: string | null;
  last_completed_at: string | null;
  last_note: string | null;
  completed_count: number;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): MaintenanceRow {
  return {
    id: String(r.id),
    installation_unit_id: String(r.installation_unit_id),
    alat_name: String(r.alat_name),
    serial_number: r.serial_number ? String(r.serial_number) : null,
    customer_name: String(r.customer_name),
    cabang: r.cabang ? String(r.cabang) : null,
    interval_bulan: Number(r.interval_bulan),
    reference_date: toIsoDate(r.reference_date),
    due_date: toIsoDate(r.due_date),
    teknisi_id: r.teknisi_id ? String(r.teknisi_id) : null,
    teknisi_name: r.teknisi_name ? String(r.teknisi_name) : null,
    teknisi_wa_number: r.teknisi_wa_number ? String(r.teknisi_wa_number) : null,
    status: String(r.status),
    notified_at: r.notified_at ? toIsoTs(r.notified_at) : null,
    last_completed_at: r.last_completed_at ? toIsoTs(r.last_completed_at) : null,
    last_note: r.last_note ? String(r.last_note) : null,
    completed_count: Number(r.completed_count),
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export interface MaintenanceActionResult {
  ok: boolean;
  error?: string;
}

export async function createSchedule(
  input: MaintenanceInput,
): Promise<MaintenanceRow | MaintenanceActionResult> {
  const sql = db();
  const units = await sql`
    SELECT id, bast_done, bast_at::text FROM installation_unit WHERE id = ${input.installation_unit_id}
  `;
  if (units.length === 0) return { ok: false, error: "alat (installation_unit) tidak ditemukan" };
  if (!units[0].bast_done) return { ok: false, error: "alat belum BAST — selesaikan lifecycle instalasi dulu" };

  const existing = await sql`
    SELECT id FROM maintenance_schedule WHERE installation_unit_id = ${input.installation_unit_id}
  `;
  if (existing.length > 0) return { ok: false, error: "alat ini sudah punya schedule PM/kalibrasi" };

  // Batas atas mencegah due_date korup: interval ekstrem (mis. 999999 bulan)
  // bikin hasil kalkulasi tanggal melampaui rentang yang bisa ditampilkan
  // benar (dikonfirmasi via curl 09-04: due_date jadi "+085359-12", bukan
  // tanggal valid). 120 bulan (10 tahun) generus utk siklus PM/kalibrasi alat
  // medis mana pun.
  if (!Number.isInteger(input.interval_bulan) || input.interval_bulan < 1 || input.interval_bulan > 120) {
    return { ok: false, error: "interval_bulan harus bilangan bulat 1-120" };
  }
  if (input.reference_date != null && !isIsoDate(input.reference_date)) {
    return { ok: false, error: `reference_date "${input.reference_date}" bukan tanggal valid (format YYYY-MM-DD)` };
  }

  const teknisiId = input.teknisi_id?.trim() || null;
  if (!teknisiId && input.teknisi_name?.trim()) {
    return { ok: false, error: "teknisi wajib dipilih dari roster (teknisi_id), bukan diketik — tambahkan dulu di Readiness Board kalau belum ada" };
  }
  let teknisiNama: string | null = null;
  let teknisiWa: string | null = null;
  if (teknisiId) {
    // uuid ngawur → Postgres 22P02; disaring dulu supaya pesannya terbaca (pola installation.ts).
    if (!/^[0-9a-f-]{36}$/i.test(teknisiId)) {
      return { ok: false, error: "teknisi_id bukan uuid yang sah — pilih dari daftar, jangan diketik" };
    }
    const [tek] = await sql`SELECT nama, wa_number, aktif FROM teknisi_capacity WHERE id = ${teknisiId}`;
    if (!tek) return { ok: false, error: "teknisi tak ada di roster" };
    if (!tek.aktif) return { ok: false, error: `teknisi "${String(tek.nama)}" sudah nonaktif — pilih yang aktif` };
    teknisiNama = String(tek.nama);
    teknisiWa = tek.wa_number ? String(tek.wa_number) : null;
  }
  const referenceDate = input.reference_date || String(units[0].bast_at).slice(0, 10);
  const rows = await sql`
    INSERT INTO maintenance_schedule
      (installation_unit_id, interval_bulan, reference_date, due_date, teknisi_id, teknisi_name, teknisi_wa_number)
    VALUES (
      ${input.installation_unit_id}, ${input.interval_bulan}, ${referenceDate},
      (${referenceDate}::date + (${input.interval_bulan} || ' months')::interval)::date,
      ${teknisiId}, ${teknisiNama}, ${teknisiWa}
    )
    RETURNING id
  `;
  const created = await getScheduleById(String(rows[0].id));
  return created as MaintenanceRow;
}

export async function listSchedules(status?: string): Promise<MaintenanceRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ms.*, iu.alat_name, iu.serial_number, iu.customer_name, iu.cabang
    FROM maintenance_schedule ms
    JOIN installation_unit iu ON iu.id = ms.installation_unit_id
    WHERE ${status ? sql`ms.status = ${status}` : sql`true`}
    ORDER BY ms.due_date ASC
  `;
  return rows.map(mapRow);
}

export async function getScheduleById(id: string): Promise<MaintenanceRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ms.*, iu.alat_name, iu.serial_number, iu.customer_name, iu.cabang
    FROM maintenance_schedule ms
    JOIN installation_unit iu ON iu.id = ms.installation_unit_id
    WHERE ms.id = ${id}
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

// Dipanggil cron sesudah WA sukses terkirim — idempotensi reminder H-14.
async function markNotified(id: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE maintenance_schedule SET status = 'notified', notified_at = now(), updated_at = now()
    WHERE id = ${id}
  `;
}

// Tandai 1 siklus selesai → ADVANCE ke siklus berikutnya (recurring, bukan baris baru).
export async function markDone(
  id: string,
  catatan?: string,
): Promise<MaintenanceActionResult & { next_due_date?: string }> {
  const sql = db();
  const rows = await sql`SELECT id, interval_bulan FROM maintenance_schedule WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "schedule tidak ditemukan" };
  const intervalBulan = Number(rows[0].interval_bulan);
  // Schedule ini RECURRING (tak ada status terminal "done" — selalu balik ke
  // 'scheduled' utk siklus berikutnya), jadi tak ada state buat dijadikan
  // guard klasik spt F26/F8. Debounce berbasis waktu: submit ganda dalam
  // 1 menit (double-click/double-submit, dikonfirmasi via curl 09-04
  // menggandakan completed_count tanpa progres nyata) ditolak; siklus PM
  // yang sungguhan tak pernah selesai 2x dalam semenit.
  const updated = await sql`
    UPDATE maintenance_schedule
    SET reference_date = current_date,
        due_date = (current_date + (${intervalBulan} || ' months')::interval)::date,
        status = 'scheduled',
        notified_at = NULL,
        last_completed_at = now(),
        last_note = ${catatan ?? null},
        completed_count = completed_count + 1,
        updated_at = now()
    WHERE id = ${id} AND (last_completed_at IS NULL OR last_completed_at < now() - interval '1 minute')
    RETURNING due_date::text
  `;
  if (updated.length === 0) {
    return { ok: false, error: "sudah ditandai selesai barusan — tunggu sebentar sebelum tandai lagi (cegah submit ganda)" };
  }
  return { ok: true, next_due_date: String(updated[0].due_date) };
}

// ── Cron: reminder H-14 ke teknisi per alat, retry-safe (gagal kirim → jangan markNotified). ──
// Jendelanya "jatuh tempo ≤ H+14 dan belum diingatkan", BUKAN `due_date = H+14`
// persis. Versi persis tak pernah benar-benar retry-safe: kalau kirim gagal
// (atau server mati) tepat di hari H-14, besoknya baris itu sudah H-13 dan tak
// terjaring lagi selamanya; jadwal yang dibuat kurang dari 14 hari sebelum
// jatuh tempo juga tak pernah diingatkan (uji dev 12 Okt 2026). Status
// 'notified' yang menjaga agar satu siklus cuma diingatkan sekali.
export async function runMaintenanceReminders(): Promise<{ count: number; notified_ids: string[] }> {
  const sql = db();
  const due = await sql`
    SELECT ms.*, iu.alat_name, iu.serial_number, iu.customer_name, iu.cabang,
      (ms.due_date - current_date) AS sisa_hari,
      NULLIF(btrim(tc.wa_number), '') AS wa_roster
    FROM maintenance_schedule ms
    JOIN installation_unit iu ON iu.id = ms.installation_unit_id
    LEFT JOIN teknisi_capacity tc ON tc.id = ms.teknisi_id
    WHERE ms.status = 'scheduled' AND ms.due_date <= current_date + 14
    ORDER BY ms.due_date
  `;
  const sisaHari = new Map(due.map((r) => [String(r.id), Number(r.sisa_hari)]));
  // Nomor WA diambil dari roster SAAT INI bila teknisinya tertaut (migrasi 207)
  // — nomor yang diganti di Readiness Board langsung berlaku; snapshot di
  // baris jadwal cuma cadangan untuk baris lama tanpa teknisi_id.
  const waRoster = new Map(due.map((r) => [String(r.id), r.wa_roster ? String(r.wa_roster) : null]));
  const notified: string[] = [];
  for (const row of due.map(mapRow)) {
    const target = waRoster.get(row.id) || row.teknisi_wa_number || process.env.MAINTENANCE_WA_TARGET || "";
    if (!target) continue; // tak ada tujuan jelas → skip (anti broadcast tak sengaja)
    const sisa = sisaHari.get(row.id) ?? 14;
    const kapan = sisa > 0 ? `H-${sisa}` : sisa === 0 ? "HARI INI" : `TERLAMBAT ${-sisa} hari`;
    const msg = [
      `🔧 *Reminder PM/Kalibrasi (${kapan})*`,
      `${row.alat_name}${row.serial_number ? ` (SN ${row.serial_number})` : ""}`,
      `${row.customer_name}${row.cabang ? ` — ${row.cabang}` : ""}`,
      `Jatuh tempo: ${row.due_date}`,
      `Teknisi: ${row.teknisi_name ?? "-"}`,
    ].join("\n");
    const gw = await sendViaWaGateway(target, msg);
    // gw.sent juga true di mode stub & dry-run (lihat wasend.ts) — tanpa gerbang
    // ini reminder ditandai terkirim walau WA tak pernah benar-benar dikirim.
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await markNotified(row.id);
      notified.push(row.id);
    }
    // gagal kirim (atau stub/dry-run) → dilewati, tetap 'scheduled', dicoba lagi run cron besok (retry-safe)
  }
  return { count: due.length, notified_ids: notified };
}
