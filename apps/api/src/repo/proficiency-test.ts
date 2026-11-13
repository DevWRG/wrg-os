import { db } from "../db.js";

// F25 Uji Profisiensi Document Registry (Aftersales/Teknis) — sertifikat per
// RS, tracking ED (annual renewal). Tabel flat, bukan header+item (satu baris
// = satu sertifikat/kejadian), pola sama dgn atk_stock_movement F49.
// date/timestamptz eksplisit ::text di SELECT/RETURNING — pola sama dgn
// atk-master.ts/atk-stock.ts (postgres.js balikin objek Date tanpa cast).
//
// Status ED (valid/expiring_soon/expired) dihitung di sini (JS), bukan kolom
// tersimpan — pola computed yg sama dgn "telat" F39/"stok rendah" F49.
// Threshold "expiring_soon" = ambang berapa hari sebelum ED yg dianggap
// "segera berakhir" — diasumsikan 60 hari (dua bulan), belum ada arahan
// eksplisit dari Direktur/board soal ini. Gampang diubah, satu angka di
// EXPIRING_SOON_THRESHOLD_DAYS di bawah.
//
// TIDAK ada job scheduler/WA reminder baru utk fitur ini — computed status di
// UI sudah memenuhi kebutuhan "reminder" tanpa perlu target broadcast WA yg
// harus ditentukan user (bukan diinferensi agent, lihat CLAUDE.md). Kalau nanti
// mau reminder aktif via WA, ikuti pola anti-broadcast F38 (repo/stock-batch.ts
// runEdWatch): default tanpa target = tidak terkirim, target di-set eksplisit
// oleh Direktur lewat env var baru, bukan diasumsikan agent.

export const EXPIRING_SOON_THRESHOLD_DAYS = 60;

export type ProficiencyTestStatus = "valid" | "expiring_soon" | "expired";

export interface ProficiencyTestRow {
  id: string;
  rs_name: string;
  test_name: string;
  provider: string | null;
  cert_number: string | null;
  issued_date: string | null;
  expired_date: string;
  cabang: string | null;
  pic: string | null;
  notes: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  has_file: boolean;
  days_to_expiry: number;
  status: ProficiencyTestStatus;
  created_at: string;
  updated_at: string;
}

function computeStatus(daysToExpiry: number): ProficiencyTestStatus {
  if (daysToExpiry < 0) return "expired";
  if (daysToExpiry <= EXPIRING_SOON_THRESHOLD_DAYS) return "expiring_soon";
  return "valid";
}

// SENGAJA tanpa file_data di SELECT list biasa (listAtkStockLevels-style) —
// payload list bisa berat kalau ikut bawa isi bytea tiap baris. Konsumen yg
// perlu isi file panggil getProficiencyTestFile() terpisah.
function rowCols(sql: ReturnType<typeof db>) {
  return sql`
    id, rs_name, test_name, provider, cert_number,
    issued_date::text, expired_date::text, cabang, pic, notes,
    file_name, file_mime, file_size, (file_data IS NOT NULL) AS has_file,
    (expired_date - CURRENT_DATE) AS days_to_expiry,
    created_at::text, updated_at::text
  `;
}

function mapRow(r: Record<string, unknown>): ProficiencyTestRow {
  const daysToExpiry = Number(r.days_to_expiry);
  return {
    id: String(r.id),
    rs_name: String(r.rs_name),
    test_name: String(r.test_name),
    provider: r.provider != null ? String(r.provider) : null,
    cert_number: r.cert_number != null ? String(r.cert_number) : null,
    issued_date: r.issued_date != null ? String(r.issued_date) : null,
    expired_date: String(r.expired_date),
    cabang: r.cabang != null ? String(r.cabang) : null,
    pic: r.pic != null ? String(r.pic) : null,
    notes: r.notes != null ? String(r.notes) : null,
    file_name: r.file_name != null ? String(r.file_name) : null,
    file_mime: r.file_mime != null ? String(r.file_mime) : null,
    file_size: r.file_size != null ? Number(r.file_size) : null,
    has_file: Boolean(r.has_file),
    days_to_expiry: daysToExpiry,
    status: computeStatus(daysToExpiry),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export interface ProficiencyTestFile {
  file_name: string;
  file_mime: string;
  file_data: Buffer;
}

export interface ProficiencyTestInput {
  rs_name: string;
  test_name: string;
  provider?: string | null;
  cert_number?: string | null;
  issued_date?: string | null;
  expired_date: string;
  cabang?: string | null;
  pic?: string | null;
  notes?: string | null;
  // file_base64/file_name/file_mime dikirim bertiga atau tidak sama sekali —
  // divalidasi di layer route (index.ts), bukan di sini.
  file_base64?: string | null;
  file_name?: string | null;
  file_mime?: string | null;
}

// Tanggal YYYY-MM-DD yang benar-benar ada di kalender (2026-02-30 ditolak).
export function tanggalSah(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// Validasi + rapikan body POST (lengkap=true) / PATCH (lengkap=false) sebelum
// sampai ke SQL — dulu tanggal salah format jadi 500 yg membocorkan pesan
// Postgres, dan PATCH bisa mengosongkan rs_name/test_name (uji fungsional
// 12 Nov). Field wajib yg DIKIRIM harus terisi setelah trim; issued_date
// kosong/"" = null (opsional); expired_date wajib tanggal sah.
export function rapikanProficiencyTest<T extends ProficiencyTestUpdate>(
  body: T,
  lengkap: boolean,
): { ok: true; data: T } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body harus objek JSON" };
  const data = { ...body };
  for (const k of ["rs_name", "test_name"] as const) {
    const v: unknown = data[k];
    if (v === undefined && !lengkap) continue;
    if (typeof v !== "string" || !v.trim()) return { ok: false, error: `${k} wajib diisi` };
    data[k] = v.trim();
  }
  const exp: unknown = data.expired_date;
  if (exp !== undefined || lengkap) {
    if (typeof exp !== "string" || !exp.trim()) return { ok: false, error: "expired_date wajib diisi" };
    if (!tanggalSah(exp.trim())) return { ok: false, error: "expired_date harus tanggal sah format YYYY-MM-DD" };
    data.expired_date = exp.trim();
  }
  const iss: unknown = data.issued_date;
  if (iss !== undefined) {
    if (iss === null || (typeof iss === "string" && !iss.trim())) data.issued_date = null;
    else if (typeof iss !== "string" || !tanggalSah(iss.trim())) return { ok: false, error: "issued_date harus tanggal sah format YYYY-MM-DD" };
    else data.issued_date = iss.trim();
  }
  return { ok: true, data };
}

export async function listProficiencyTests(): Promise<ProficiencyTestRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${rowCols(sql)}
    FROM proficiency_test_document
    ORDER BY expired_date ASC, created_at DESC
  `;
  return rows.map(mapRow);
}

export async function getProficiencyTest(id: string): Promise<ProficiencyTestRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${rowCols(sql)}
    FROM proficiency_test_document
    WHERE id = ${id}
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function getProficiencyTestFile(id: string): Promise<ProficiencyTestFile | null> {
  const sql = db();
  const rows = await sql`
    SELECT file_name, file_mime, file_data
    FROM proficiency_test_document
    WHERE id = ${id} AND file_data IS NOT NULL
  `;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    file_name: String(r.file_name ?? "sertifikat"),
    file_mime: String(r.file_mime ?? "application/octet-stream"),
    file_data: r.file_data as Buffer,
  };
}

export async function createProficiencyTest(t: ProficiencyTestInput): Promise<ProficiencyTestRow> {
  const sql = db();
  const fileBuf = t.file_base64 ? Buffer.from(t.file_base64, "base64") : null;
  const rows = await sql`
    INSERT INTO proficiency_test_document (
      rs_name, test_name, provider, cert_number, issued_date, expired_date,
      cabang, pic, notes, file_name, file_mime, file_size, file_data
    ) VALUES (
      ${t.rs_name}, ${t.test_name}, ${t.provider ?? null}, ${t.cert_number ?? null},
      ${t.issued_date ?? null}, ${t.expired_date},
      ${t.cabang ?? null}, ${t.pic ?? null}, ${t.notes ?? null},
      ${fileBuf ? t.file_name ?? null : null}, ${fileBuf ? t.file_mime ?? null : null},
      ${fileBuf ? fileBuf.length : null}, ${fileBuf}
    )
    RETURNING id
  `;
  const created = await getProficiencyTest(String(rows[0].id));
  if (!created) throw new Error("gagal membaca dokumen uji profisiensi setelah dibuat");
  return created;
}

export interface ProficiencyTestUpdate {
  rs_name?: string;
  test_name?: string;
  provider?: string | null;
  cert_number?: string | null;
  issued_date?: string | null;
  expired_date?: string;
  cabang?: string | null;
  pic?: string | null;
  notes?: string | null;
  // Kirim ketiganya utk ganti file sertifikat; kalau tak dikirim (undefined),
  // file lama TIDAK berubah — beda dari field text lain yg pola undefined
  // = "tak diubah" (konsisten, cuma ditegaskan krn 3 kolom sekaligus).
  file_base64?: string | null;
  file_name?: string | null;
  file_mime?: string | null;
}

export async function updateProficiencyTest(id: string, f: ProficiencyTestUpdate): Promise<ProficiencyTestRow | null> {
  const sql = db();
  const fileBuf = f.file_base64 ? Buffer.from(f.file_base64, "base64") : undefined;
  const rows = await sql`
    UPDATE proficiency_test_document SET
      rs_name      = COALESCE(${f.rs_name ?? null}, rs_name),
      test_name    = COALESCE(${f.test_name ?? null}, test_name),
      provider     = ${f.provider !== undefined ? f.provider : sql`provider`},
      cert_number  = ${f.cert_number !== undefined ? f.cert_number : sql`cert_number`},
      issued_date  = ${f.issued_date !== undefined ? f.issued_date : sql`issued_date`},
      expired_date = COALESCE(${f.expired_date ?? null}, expired_date),
      cabang       = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      pic          = ${f.pic !== undefined ? f.pic : sql`pic`},
      notes        = ${f.notes !== undefined ? f.notes : sql`notes`},
      file_name    = ${fileBuf !== undefined ? f.file_name ?? null : sql`file_name`},
      file_mime    = ${fileBuf !== undefined ? f.file_mime ?? null : sql`file_mime`},
      file_size    = ${fileBuf !== undefined ? fileBuf.length : sql`file_size`},
      file_data    = ${fileBuf !== undefined ? fileBuf : sql`file_data`},
      updated_at   = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getProficiencyTest(id) : null;
}

export async function deleteProficiencyTest(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM proficiency_test_document WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
