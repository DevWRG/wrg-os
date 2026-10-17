import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { db } from "../db.js";

// F33 Kas Station Reconcile Harian Cabang. Station = kas cabang (kunci = teks
// `cabang` huruf besar). Alur: kas harian (kas_station_harian + _transaksi) →
// roll-up mingguan Senin–Minggu (kas_station_rekap, snapshot) → station
// mengajukan → pusat approve/reject → realisasi dana (lihat 234_kas_station.sql).
//
// Yang SENGAJA tidak ditetapkan di sini karena belum ada keputusan bisnis:
// toleransi selisih, tenggat pengisian/pengajuan, rumus nominal pengajuan /
// realisasi (realisasi_nominal diisi manual), pembatasan cabang per user.
// saldo_akhir tidak disimpan — dihitung dari saldo_awal + masuk − keluar.

export const JENIS_TRANSAKSI = ["masuk", "keluar"] as const;
export type JenisTransaksi = (typeof JENIS_TRANSAKSI)[number];

export const STATUS_REKAP = ["draft", "submitted", "approved", "rejected"] as const;
export type StatusRekap = (typeof STATUS_REKAP)[number];

export type AksiRekap = "submit" | "approve" | "reject" | "realisasi";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const HARI_MS = 24 * 60 * 60 * 1000;
const HARI_PER_MINGGU = 7;
const BATAS_HARI_RENTANG = 366;
const LIMIT_DEFAULT = 200;
const LIMIT_MAKS = 1000;

// Submit ganda dalam hitungan detik (klik dobel / panggilan API berulang) —
// jaring pengaman seperti GAP-06 di F51; bukan larangan permanen.
const DUPLICATE_SUBMIT_WINDOW_SECONDS = 10;

export class KasStationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "KasStationError";
  }
}

// ───────────────────────── Logika murni (diuji tanpa DB) ─────────────────────────

export const normCabang = (s: unknown): string => (typeof s === "string" ? s.trim().toUpperCase() : "");

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const wibHariIni = (now: number = Date.now()): string =>
  new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);

// Batas bawah tahun data kas: menolak tahun 0000/0001 (Postgres `date` tak mendukung tahun 0 → 500)
// dan salah ketik seperti 0026. Bukan aturan bisnis, hanya penjaga kewarasan input.
const TAHUN_MINIMUM = 2000;

// Postgres menolak byte NUL (0x00) di teks → 500 dengan pesan internal; tolak lebih awal sebagai 400.
export function mengandungNul(v: unknown): boolean {
  if (typeof v === "string") return v.includes("\u0000");
  if (Array.isArray(v)) return v.some(mengandungNul);
  if (v !== null && typeof v === "object") return Object.entries(v).some(([k, x]) => k.includes("\u0000") || mengandungNul(x));
  return false;
}

// YYYY-MM-DD yang benar-benar ada di kalender (31-02 ditolak) dan tahunnya ≥ TAHUN_MINIMUM.
export function parseTanggal(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number(v.slice(0, 4)) < TAHUN_MINIMUM) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function tambahHari(tanggal: string, n: number): string {
  return new Date(new Date(`${tanggal}T00:00:00Z`).getTime() + n * HARI_MS).toISOString().slice(0, 10);
}

export const isSenin = (tanggal: string): boolean => new Date(`${tanggal}T00:00:00Z`).getUTCDay() === 1;

export function awalMinggu(tanggal: string): string {
  const dow = new Date(`${tanggal}T00:00:00Z`).getUTCDay(); // 0=Minggu
  return tambahHari(tanggal, -((dow + 6) % 7));
}

// Nominal uang: angka hingga 2 desimal, batas atas mengikuti numeric(16,2).
// 1 triliun per nominal: jumlah ribuan baris pun tetap muat di numeric(16,2) (maks ±10^14).
const NOMINAL_MAKS = 1_000_000_000_000;
const TRANSAKSI_MAKS_PER_REQUEST = 200;
export function parseNominal(v: unknown, label: string, opts: { min: "nol" | "positif" }): number {
  // String hanya boleh desimal polos — Number() sendiri menerima "0x10", "1e3", " " dsb.
  const n = typeof v === "string" ? (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new KasStationError(400, `${label} harus berupa angka`);
  if (round2(n) !== n) throw new KasStationError(400, `${label} maksimal 2 angka desimal`);
  if (opts.min === "positif" ? n <= 0 : n < 0) {
    throw new KasStationError(400, opts.min === "positif" ? `${label} harus lebih dari 0` : `${label} tidak boleh negatif`);
  }
  if (n > NOMINAL_MAKS) throw new KasStationError(400, `${label} terlalu besar`);
  return n;
}

export const hitungSaldoAkhir = (saldoAwal: number, masuk: number, keluar: number): number =>
  round2(saldoAwal + masuk - keluar);

// Selisih = fisik − hitungan sistem. null bila saldo fisik belum diisi.
export const hitungSelisih = (saldoFisik: number | null, saldoAkhir: number): number | null =>
  saldoFisik == null ? null : round2(saldoFisik - saldoAkhir);

export interface BarisHarian {
  tanggal: string;
  saldo_awal: number;
  total_masuk: number;
  total_keluar: number;
  saldo_fisik: number | null;
}

export interface RekapSnapshot {
  jumlah_hari: number;
  saldo_awal: number;
  total_masuk: number;
  total_keluar: number;
  saldo_akhir: number;
  total_selisih: number;
  jumlah_hari_selisih: number;
}

// Roll-up harian → mingguan. null bila tidak ada data (rekap kosong tak boleh dibuat).
export function rollupMinggu(rows: BarisHarian[]): RekapSnapshot | null {
  if (!rows.length) return null;
  const urut = [...rows].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const akhir = urut[urut.length - 1];
  let masuk = 0, keluar = 0, selisih = 0, hariSelisih = 0;
  for (const r of urut) {
    masuk += r.total_masuk;
    keluar += r.total_keluar;
    const s = hitungSelisih(r.saldo_fisik, hitungSaldoAkhir(r.saldo_awal, r.total_masuk, r.total_keluar));
    if (s != null) {
      selisih += s;
      if (s !== 0) hariSelisih += 1;
    }
  }
  return {
    jumlah_hari: urut.length,
    saldo_awal: urut[0].saldo_awal,
    total_masuk: round2(masuk),
    total_keluar: round2(keluar),
    saldo_akhir: hitungSaldoAkhir(akhir.saldo_awal, akhir.total_masuk, akhir.total_keluar),
    total_selisih: round2(selisih),
    jumlah_hari_selisih: hariSelisih,
  };
}

// Tanggal di minggu rekap yang tidak punya catatan (kalender, info saja — bukan penghalang).
// `sampai` = batas atas (hari ini WIB): tanggal yang belum tiba tidak dihitung "tanpa catatan".
export function hariTanpaCatatan(periodeAwal: string, tanggalAda: string[], sampai?: string): string[] {
  const ada = new Set(tanggalAda);
  const hasil: string[] = [];
  for (let i = 0; i < HARI_PER_MINGGU; i++) {
    const t = tambahHari(periodeAwal, i);
    if (sampai && t > sampai) break;
    if (!ada.has(t)) hasil.push(t);
  }
  return hasil;
}

// Mesin status rekap. null = transisi tidak sah.
export function statusSesudah(status: StatusRekap, aksi: AksiRekap): StatusRekap | null {
  switch (aksi) {
    case "submit": return status === "draft" || status === "rejected" ? "submitted" : null;
    case "approve": return status === "submitted" ? "approved" : null;
    case "reject": return status === "submitted" ? "rejected" : null;
    case "realisasi": return status === "approved" ? "approved" : null;
  }
}

// ───────────────────────── Tipe & mapper ─────────────────────────

export interface TransaksiRow {
  id: string;
  harian_id: string;
  jenis: JenisTransaksi;
  nominal: number;
  uraian: string;
  bukti_ref: string | null;
  created_by: string | null;
  created_at: string;
}

export interface HarianRow {
  id: string;
  cabang: string;
  tanggal: string;
  saldo_awal: number;
  total_masuk: number;
  total_keluar: number;
  saldo_akhir: number;
  saldo_fisik: number | null;
  selisih: number | null;
  keterangan: string | null;
  jumlah_transaksi: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Sudah masuk rekap submitted/approved → tidak boleh diubah. */
  terkunci: boolean;
  /** Hanya entri terakhir station yang boleh diubah (rantai saldo awal), dan tidak terkunci. */
  bisa_diubah: boolean;
}

export interface RekapRow extends RekapSnapshot {
  id: string;
  cabang: string;
  periode_awal: string;
  periode_akhir: string;
  status: StatusRekap;
  submit_count: number;
  submitted_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  realisasi_nominal: number | null;
  realisasi_by: string | null;
  realisasi_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RekapDetail extends RekapRow {
  harian: (HarianRow & { transaksi: TransaksiRow[] })[];
  hari_tanpa_catatan: string[];
}

const str = (v: unknown): string | null => (v != null ? String(v) : null);
const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v != null ? Number(v) : null);

function mapTransaksi(r: Record<string, unknown>): TransaksiRow {
  return {
    id: String(r.id),
    harian_id: String(r.harian_id),
    jenis: r.jenis as JenisTransaksi,
    nominal: num(r.nominal),
    uraian: String(r.uraian),
    bukti_ref: str(r.bukti_ref),
    created_by: str(r.created_by),
    created_at: String(r.created_at),
  };
}

function mapHarian(r: Record<string, unknown>): HarianRow {
  const saldo_awal = num(r.saldo_awal);
  const total_masuk = num(r.total_masuk);
  const total_keluar = num(r.total_keluar);
  const saldo_akhir = hitungSaldoAkhir(saldo_awal, total_masuk, total_keluar);
  const saldo_fisik = numOrNull(r.saldo_fisik);
  const terkunci = r.terkunci === true;
  return {
    id: String(r.id),
    cabang: String(r.cabang),
    tanggal: String(r.tanggal),
    saldo_awal,
    total_masuk,
    total_keluar,
    saldo_akhir,
    saldo_fisik,
    selisih: hitungSelisih(saldo_fisik, saldo_akhir),
    keterangan: str(r.keterangan),
    jumlah_transaksi: Number(r.jumlah_transaksi ?? 0),
    created_by: str(r.created_by),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    terkunci,
    bisa_diubah: r.terakhir === true && !terkunci,
  };
}

function mapRekap(r: Record<string, unknown>): RekapRow {
  return {
    id: String(r.id),
    cabang: String(r.cabang),
    periode_awal: String(r.periode_awal),
    periode_akhir: String(r.periode_akhir),
    status: r.status as StatusRekap,
    jumlah_hari: Number(r.jumlah_hari),
    saldo_awal: num(r.saldo_awal),
    total_masuk: num(r.total_masuk),
    total_keluar: num(r.total_keluar),
    saldo_akhir: num(r.saldo_akhir),
    total_selisih: num(r.total_selisih),
    jumlah_hari_selisih: Number(r.jumlah_hari_selisih ?? 0),
    submit_count: Number(r.submit_count ?? 0),
    submitted_by: str(r.submitted_by),
    submitted_at: str(r.submitted_at),
    decided_by: str(r.decided_by),
    decided_at: str(r.decided_at),
    decision_note: str(r.decision_note),
    realisasi_nominal: numOrNull(r.realisasi_nominal),
    realisasi_by: str(r.realisasi_by),
    realisasi_at: str(r.realisasi_at),
    created_by: str(r.created_by),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

// ───────────────────────── SQL ─────────────────────────

type Tx = TransactionSql<Record<string, unknown>>;

// date/timestamptz eksplisit ::text, tanpa SELECT * — postgres.js membalikkan
// objek Date untuk kolom date (jebakan yang sama di F39/F60/F51).
const HARIAN_SELECT = `
  h.id, h.cabang, h.tanggal::text AS tanggal, h.saldo_awal, h.saldo_fisik, h.keterangan,
  h.created_by, h.created_at::text AS created_at, h.updated_at::text AS updated_at,
  COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'masuk'), 0) AS total_masuk,
  COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'keluar'), 0) AS total_keluar,
  COUNT(t.id) AS jumlah_transaksi,
  (h.tanggal = (SELECT MAX(x.tanggal) FROM kas_station_harian x WHERE x.cabang = h.cabang)) AS terakhir,
  EXISTS (
    SELECT 1 FROM kas_station_rekap r
    WHERE r.cabang = h.cabang AND r.status IN ('submitted','approved')
      AND h.tanggal BETWEEN r.periode_awal AND r.periode_akhir
  ) AS terkunci
`;

const REKAP_SELECT = `
  id, cabang, periode_awal::text AS periode_awal, periode_akhir::text AS periode_akhir, status,
  jumlah_hari, saldo_awal, total_masuk, total_keluar, saldo_akhir, total_selisih, jumlah_hari_selisih,
  submit_count, submitted_by, submitted_at::text AS submitted_at, decided_by, decided_at::text AS decided_at,
  decision_note, realisasi_nominal, realisasi_by, realisasi_at::text AS realisasi_at,
  created_by, created_at::text AS created_at, updated_at::text AS updated_at
`;

async function lockCabang(tx: Tx, cabang: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`kas-station:${cabang}`}))`;
}

async function cabangDikenal(sql: Tx, cabang: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM master_user WHERE upper(btrim(cabang)) = ${cabang}
    UNION ALL
    SELECT 1 FROM hod_territory WHERE upper(btrim(cabang)) = ${cabang}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function logAudit(
  tx: Tx, eventType: string, actor: string | null | undefined, payload: Record<string, unknown>, decision: string,
): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  // agent_id 'A3' dipinjam seperti F11/F60: bukan agen LLM, tapi FK agent_registry wajib terisi.
  await tx`
    INSERT INTO audit_log (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES ('D1', ${`f33-${hash.slice(0, 8)}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash},
            ${tx.json(payload as unknown as Parameters<typeof tx.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

const ACTOR_MAKS = 100; // audit_log.human_actor = varchar(100)

function aktor(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length > ACTOR_MAKS) throw new KasStationError(400, `actor maksimal ${ACTOR_MAKS} karakter`);
  return t || null;
}

function teksOpsional(v: unknown, label: string, maks: number): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new KasStationError(400, `${label} harus berupa teks`);
  const t = v.trim();
  if (t.length > maks) throw new KasStationError(400, `${label} maksimal ${maks} karakter`);
  return t || null;
}

function uraianWajib(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new KasStationError(400, "uraian wajib diisi");
  const t = v.trim();
  if (t.length > 500) throw new KasStationError(400, "uraian maksimal 500 karakter");
  return t;
}

function jenisValid(v: unknown): JenisTransaksi {
  if (!JENIS_TRANSAKSI.includes(v as JenisTransaksi)) {
    throw new KasStationError(400, `jenis harus salah satu dari ${JENIS_TRANSAKSI.join(", ")}`);
  }
  return v as JenisTransaksi;
}

function cabangWajib(v: unknown): string {
  const c = normCabang(v);
  if (!c) throw new KasStationError(400, "cabang wajib diisi");
  if (c.length > 100) throw new KasStationError(400, "cabang terlalu panjang");
  return c;
}

function tanggalWajib(v: unknown, label: string): string {
  const t = parseTanggal(v);
  if (!t) throw new KasStationError(400, `${label} harus berformat YYYY-MM-DD dan tanggal yang valid`);
  return t;
}

function limitValid(v: number | undefined): number {
  if (v == null) return LIMIT_DEFAULT;
  if (!Number.isInteger(v) || v < 1) throw new KasStationError(400, "limit harus bilangan bulat ≥ 1");
  return Math.min(v, LIMIT_MAKS);
}

// ───────────────────────── Baca ─────────────────────────

export async function listCabang(): Promise<string[]> {
  const sql = db();
  const rows = await sql`
    SELECT DISTINCT c FROM (
      SELECT upper(btrim(cabang)) AS c FROM master_user WHERE cabang IS NOT NULL
      UNION
      SELECT upper(btrim(cabang)) AS c FROM hod_territory WHERE cabang IS NOT NULL
    ) x WHERE c <> '' ORDER BY c
  `;
  return rows.map((r) => String(r.c));
}

export interface ListHarianOpts { cabang?: string; dari?: string; sampai?: string; limit?: number }

export async function listHarian(opts: ListHarianOpts = {}): Promise<HarianRow[]> {
  const sql = db();
  const cabang = opts.cabang ? normCabang(opts.cabang) : null;
  const dari = opts.dari ? tanggalWajib(opts.dari, "dari") : null;
  const sampai = opts.sampai ? tanggalWajib(opts.sampai, "sampai") : null;
  if (dari && sampai && dari > sampai) throw new KasStationError(400, "dari tidak boleh setelah sampai");
  if (dari && sampai && (Date.parse(sampai) - Date.parse(dari)) / HARI_MS > BATAS_HARI_RENTANG) {
    throw new KasStationError(400, `rentang maksimal ${BATAS_HARI_RENTANG} hari`);
  }
  const limit = limitValid(opts.limit);
  const rows = await sql`
    SELECT ${sql.unsafe(HARIAN_SELECT)}
    FROM kas_station_harian h
    LEFT JOIN kas_station_transaksi t ON t.harian_id = h.id
    WHERE ${cabang ? sql`h.cabang = ${cabang}` : sql`true`}
      AND ${dari ? sql`h.tanggal >= ${dari}` : sql`true`}
      AND ${sampai ? sql`h.tanggal <= ${sampai}` : sql`true`}
    GROUP BY h.id
    ORDER BY h.tanggal DESC, h.cabang ASC
    LIMIT ${limit}
  `;
  return rows.map(mapHarian);
}

async function fetchHarian(sql: Tx, id: string): Promise<(HarianRow & { transaksi: TransaksiRow[] }) | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(HARIAN_SELECT)}
    FROM kas_station_harian h
    LEFT JOIN kas_station_transaksi t ON t.harian_id = h.id
    WHERE h.id = ${id}
    GROUP BY h.id
  `;
  if (!rows.length) return null;
  const trx = await sql`
    SELECT id, harian_id, jenis, nominal, uraian, bukti_ref, created_by, created_at::text AS created_at
    FROM kas_station_transaksi WHERE harian_id = ${id} ORDER BY created_at ASC, id ASC
  `;
  return { ...mapHarian(rows[0]), transaksi: trx.map(mapTransaksi) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getHarian(id: string): Promise<(HarianRow & { transaksi: TransaksiRow[] }) | null> {
  if (!UUID_RE.test(id)) return null;
  return db().begin((tx) => fetchHarian(tx, id));
}

export interface ListRekapOpts { cabang?: string; status?: string; limit?: number }

export async function listRekap(opts: ListRekapOpts = {}): Promise<RekapRow[]> {
  const sql = db();
  const cabang = opts.cabang ? normCabang(opts.cabang) : null;
  if (opts.status && !STATUS_REKAP.includes(opts.status as StatusRekap)) {
    throw new KasStationError(400, `status harus salah satu dari ${STATUS_REKAP.join(", ")}`);
  }
  const limit = limitValid(opts.limit);
  const rows = await sql`
    SELECT ${sql.unsafe(REKAP_SELECT)} FROM kas_station_rekap
    WHERE ${cabang ? sql`cabang = ${cabang}` : sql`true`}
      AND ${opts.status ? sql`status = ${opts.status}` : sql`true`}
    ORDER BY periode_awal DESC, cabang ASC
    LIMIT ${limit}
  `;
  return rows.map(mapRekap);
}

export async function getRekap(id: string): Promise<RekapDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const sql = db();
  const rows = await sql`SELECT ${sql.unsafe(REKAP_SELECT)} FROM kas_station_rekap WHERE id = ${id}`;
  if (!rows.length) return null;
  const rekap = mapRekap(rows[0]);
  const harianRows = await sql`
    SELECT ${sql.unsafe(HARIAN_SELECT)}
    FROM kas_station_harian h
    LEFT JOIN kas_station_transaksi t ON t.harian_id = h.id
    WHERE h.cabang = ${rekap.cabang} AND h.tanggal BETWEEN ${rekap.periode_awal} AND ${rekap.periode_akhir}
    GROUP BY h.id
    ORDER BY h.tanggal ASC
  `;
  const harian = harianRows.map(mapHarian);
  const trx = harian.length
    ? await sql`
        SELECT id, harian_id, jenis, nominal, uraian, bukti_ref, created_by, created_at::text AS created_at
        FROM kas_station_transaksi WHERE harian_id IN ${sql(harian.map((h) => h.id))}
        ORDER BY created_at ASC, id ASC`
    : [];
  const perHarian = new Map<string, TransaksiRow[]>();
  for (const t of trx.map(mapTransaksi)) perHarian.set(t.harian_id, [...(perHarian.get(t.harian_id) ?? []), t]);
  return {
    ...rekap,
    harian: harian.map((h) => ({ ...h, transaksi: perHarian.get(h.id) ?? [] })),
    hari_tanpa_catatan: hariTanpaCatatan(rekap.periode_awal, harian.map((h) => h.tanggal), wibHariIni()),
  };
}

// ───────────────────────── Tulis: kas harian ─────────────────────────

export interface TransaksiInput { jenis: unknown; nominal: unknown; uraian: unknown; bukti_ref?: unknown }

export interface HarianInput {
  cabang: unknown;
  tanggal: unknown;
  saldo_awal?: unknown;
  saldo_fisik?: unknown;
  keterangan?: unknown;
  transaksi?: TransaksiInput[];
  created_by?: string | null;
}

interface TransaksiValid { jenis: JenisTransaksi; nominal: number; uraian: string; bukti_ref: string | null }

function validTransaksi(t: TransaksiInput): TransaksiValid {
  if (t == null || typeof t !== "object") throw new KasStationError(400, "transaksi tidak valid");
  return {
    jenis: jenisValid(t.jenis),
    nominal: parseNominal(t.nominal, "nominal", { min: "positif" }),
    uraian: uraianWajib(t.uraian),
    bukti_ref: teksOpsional(t.bukti_ref, "bukti_ref", 500),
  };
}

async function totalHarian(tx: Tx, harianId: string): Promise<{ masuk: number; keluar: number }> {
  const [r] = await tx`
    SELECT COALESCE(SUM(nominal) FILTER (WHERE jenis = 'masuk'), 0) AS masuk,
           COALESCE(SUM(nominal) FILTER (WHERE jenis = 'keluar'), 0) AS keluar
    FROM kas_station_transaksi WHERE harian_id = ${harianId}
  `;
  return { masuk: num(r.masuk), keluar: num(r.keluar) };
}

async function tanggalTerkunci(tx: Tx, cabang: string, tanggal: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM kas_station_rekap
    WHERE cabang = ${cabang} AND status IN ('submitted','approved') AND ${tanggal}::date BETWEEN periode_awal AND periode_akhir
    LIMIT 1
  `;
  return rows.length > 0;
}

// Entri harian hanya boleh diubah bila: terakhir milik stationnya (saldo awal hari
// berikutnya diturunkan dari sini) dan belum terkunci oleh rekap diajukan/approved.
async function pastikanBisaDiubah(tx: Tx, h: { id: string; cabang: string; tanggal: string }): Promise<void> {
  const [lebihBaru] = await tx`
    SELECT 1 FROM kas_station_harian WHERE cabang = ${h.cabang} AND tanggal > ${h.tanggal}::date LIMIT 1
  `;
  if (lebihBaru) {
    throw new KasStationError(409, "hanya catatan kas terakhir station yang boleh diubah (saldo awal hari berikutnya bergantung padanya)");
  }
  if (await tanggalTerkunci(tx, h.cabang, h.tanggal)) {
    throw new KasStationError(409, "catatan ini sudah masuk rekap yang diajukan/disetujui dan terkunci");
  }
}

async function muatHarianDanKunci(tx: Tx, id: string): Promise<{ id: string; cabang: string; tanggal: string; saldo_awal: number }> {
  const [h] = await tx`SELECT id, cabang, tanggal::text AS tanggal, saldo_awal FROM kas_station_harian WHERE id = ${id}`;
  if (!h) throw new KasStationError(404, "catatan kas harian tidak ditemukan");
  const cabang = String(h.cabang);
  await lockCabang(tx, cabang);
  // Baca ulang setelah lock — baris bisa terhapus oleh transaksi lain saat menunggu.
  const [fresh] = await tx`SELECT id, cabang, tanggal::text AS tanggal, saldo_awal FROM kas_station_harian WHERE id = ${id}`;
  if (!fresh) throw new KasStationError(404, "catatan kas harian tidak ditemukan");
  return { id: String(fresh.id), cabang, tanggal: String(fresh.tanggal), saldo_awal: num(fresh.saldo_awal) };
}

function pastikanSaldoTidakNegatif(saldoAwal: number, masuk: number, keluar: number): void {
  if (hitungSaldoAkhir(saldoAwal, masuk, keluar) < 0) {
    throw new KasStationError(422, "kas keluar melebihi saldo yang tersedia (saldo akhir tidak boleh negatif)");
  }
}

export async function createHarian(input: HarianInput): Promise<HarianRow & { transaksi: TransaksiRow[] }> {
  const cabang = cabangWajib(input.cabang);
  const tanggal = tanggalWajib(input.tanggal, "tanggal");
  if (tanggal > wibHariIni()) throw new KasStationError(400, "tanggal tidak boleh di masa depan");
  const saldoFisik = input.saldo_fisik == null || input.saldo_fisik === ""
    ? null : parseNominal(input.saldo_fisik, "saldo_fisik", { min: "nol" });
  const keterangan = teksOpsional(input.keterangan, "keterangan", 500);
  const saldoAwalInput = input.saldo_awal == null || input.saldo_awal === ""
    ? null : parseNominal(input.saldo_awal, "saldo_awal", { min: "nol" });
  if (input.transaksi != null && !Array.isArray(input.transaksi)) throw new KasStationError(400, "transaksi harus berupa array");
  if ((input.transaksi?.length ?? 0) > TRANSAKSI_MAKS_PER_REQUEST) {
    throw new KasStationError(400, `maksimal ${TRANSAKSI_MAKS_PER_REQUEST} transaksi per catatan`);
  }
  const trx = (input.transaksi ?? []).map(validTransaksi);
  const actor = aktor(input.created_by);

  const sql = db();
  const id = await sql.begin(async (tx) => {
    if (!(await cabangDikenal(tx, cabang))) throw new KasStationError(400, `cabang '${cabang}' tidak dikenal`);
    await lockCabang(tx, cabang);

    const [terakhir] = await tx`
      SELECT h.id, h.tanggal::text AS tanggal, h.saldo_awal,
             COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'masuk'), 0) AS masuk,
             COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'keluar'), 0) AS keluar
      FROM kas_station_harian h LEFT JOIN kas_station_transaksi t ON t.harian_id = h.id
      WHERE h.cabang = ${cabang} GROUP BY h.id ORDER BY h.tanggal DESC LIMIT 1
    `;

    let saldoAwal: number;
    if (!terakhir) {
      if (saldoAwalInput == null) throw new KasStationError(400, "saldo_awal wajib diisi untuk catatan pertama station");
      saldoAwal = saldoAwalInput;
    } else {
      if (String(terakhir.tanggal) === tanggal) {
        throw new KasStationError(409, `catatan kas ${cabang} tanggal ${tanggal} sudah ada`);
      }
      if (tanggal < String(terakhir.tanggal)) {
        throw new KasStationError(409, `tanggal harus setelah catatan terakhir (${terakhir.tanggal}) — catatan mundur tidak diizinkan`);
      }
      saldoAwal = hitungSaldoAkhir(num(terakhir.saldo_awal), num(terakhir.masuk), num(terakhir.keluar));
      if (saldoAwalInput != null && saldoAwalInput !== saldoAwal) {
        throw new KasStationError(400, `saldo_awal ditentukan sistem (${saldoAwal}) = saldo akhir catatan sebelumnya; tidak bisa diisi manual`);
      }
    }
    if (await tanggalTerkunci(tx, cabang, tanggal)) {
      throw new KasStationError(409, "tanggal ini berada di minggu yang rekapnya sudah diajukan/disetujui");
    }

    const masuk = trx.filter((t) => t.jenis === "masuk").reduce((a, t) => a + t.nominal, 0);
    const keluar = trx.filter((t) => t.jenis === "keluar").reduce((a, t) => a + t.nominal, 0);
    pastikanSaldoTidakNegatif(saldoAwal, masuk, keluar);

    const [h] = await tx`
      INSERT INTO kas_station_harian (cabang, tanggal, saldo_awal, saldo_fisik, keterangan, created_by)
      VALUES (${cabang}, ${tanggal}, ${saldoAwal}, ${saldoFisik}, ${keterangan}, ${actor})
      RETURNING id
    `;
    const harianId = String(h.id);
    for (const t of trx) {
      await tx`
        INSERT INTO kas_station_transaksi (harian_id, jenis, nominal, uraian, bukti_ref, created_by)
        VALUES (${harianId}, ${t.jenis}, ${t.nominal}, ${t.uraian}, ${t.bukti_ref}, ${actor})
      `;
    }
    await logAudit(tx, "kas_station.harian_dibuat", actor, { harian_id: harianId, cabang, tanggal, saldo_awal: saldoAwal, transaksi: trx.length }, "dibuat");
    return harianId;
  });
  const detail = await sql.begin((tx) => fetchHarian(tx, id));
  if (!detail) throw new Error("gagal membaca catatan kas setelah dibuat");
  return detail;
}

export interface HarianUpdate { saldo_fisik?: unknown; keterangan?: unknown; saldo_awal?: unknown; updated_by?: string | null }

export async function updateHarian(id: string, f: HarianUpdate): Promise<(HarianRow & { transaksi: TransaksiRow[] }) | null> {
  if (!UUID_RE.test(id)) return null;
  const sql = db();
  const actor = aktor(f.updated_by);
  const adaFisik = f.saldo_fisik !== undefined;
  const adaKet = f.keterangan !== undefined;
  const adaAwal = f.saldo_awal !== undefined;
  if (!adaFisik && !adaKet && !adaAwal) throw new KasStationError(400, "tidak ada field yang diubah");
  const saldoFisik = !adaFisik || f.saldo_fisik === null || f.saldo_fisik === ""
    ? null : parseNominal(f.saldo_fisik, "saldo_fisik", { min: "nol" });
  const keterangan = adaKet ? teksOpsional(f.keterangan, "keterangan", 500) : null;
  const saldoAwal = adaAwal ? parseNominal(f.saldo_awal, "saldo_awal", { min: "nol" }) : null;

  const ok = await sql.begin(async (tx) => {
    let h;
    try { h = await muatHarianDanKunci(tx, id); } catch (e) {
      if (e instanceof KasStationError && e.status === 404) return false;
      throw e;
    }
    await pastikanBisaDiubah(tx, h);
    if (adaAwal) {
      const [lebihLama] = await tx`SELECT 1 FROM kas_station_harian WHERE cabang = ${h.cabang} AND tanggal < ${h.tanggal}::date LIMIT 1`;
      if (lebihLama) throw new KasStationError(400, "saldo_awal hanya bisa diubah pada catatan pertama station");
      const { masuk, keluar } = await totalHarian(tx, h.id);
      pastikanSaldoTidakNegatif(saldoAwal as number, masuk, keluar);
    }
    await tx`
      UPDATE kas_station_harian SET
        saldo_fisik = ${adaFisik ? saldoFisik : tx`saldo_fisik`},
        keterangan  = ${adaKet ? keterangan : tx`keterangan`},
        saldo_awal  = ${adaAwal ? saldoAwal : tx`saldo_awal`},
        updated_at  = now()
      WHERE id = ${h.id}
    `;
    await logAudit(tx, "kas_station.harian_diubah", actor, {
      harian_id: h.id, cabang: h.cabang, tanggal: h.tanggal,
      ...(adaFisik ? { saldo_fisik: saldoFisik } : {}), ...(adaAwal ? { saldo_awal: saldoAwal } : {}),
    }, "diubah");
    return true;
  });
  return ok ? sql.begin((tx) => fetchHarian(tx, id)) : null;
}

export async function deleteHarian(id: string, actorRaw?: string | null): Promise<{ deleted: boolean }> {
  if (!UUID_RE.test(id)) return { deleted: false };
  const sql = db();
  const actor = aktor(actorRaw);
  return sql.begin(async (tx) => {
    let h;
    try { h = await muatHarianDanKunci(tx, id); } catch (e) {
      if (e instanceof KasStationError && e.status === 404) return { deleted: false };
      throw e;
    }
    await pastikanBisaDiubah(tx, h);
    await tx`DELETE FROM kas_station_harian WHERE id = ${h.id}`;
    await logAudit(tx, "kas_station.harian_dihapus", actor, { harian_id: h.id, cabang: h.cabang, tanggal: h.tanggal }, "dihapus");
    return { deleted: true };
  });
}

// ───────────────────────── Tulis: transaksi ─────────────────────────

export async function addTransaksi(
  harianId: string, input: TransaksiInput & { created_by?: string | null },
): Promise<(HarianRow & { transaksi: TransaksiRow[] }) | null> {
  if (!UUID_RE.test(harianId)) return null;
  const t = validTransaksi(input);
  const actor = aktor(input.created_by);
  const sql = db();
  const ok = await sql.begin(async (tx) => {
    let h;
    try { h = await muatHarianDanKunci(tx, harianId); } catch (e) {
      if (e instanceof KasStationError && e.status === 404) return false;
      throw e;
    }
    await pastikanBisaDiubah(tx, h);
    const dup = await tx`
      SELECT 1 FROM kas_station_transaksi
      WHERE harian_id = ${h.id} AND jenis = ${t.jenis} AND nominal = ${t.nominal} AND uraian = ${t.uraian}
        AND created_at > now() - (${DUPLICATE_SUBMIT_WINDOW_SECONDS} || ' seconds')::interval
      LIMIT 1
    `;
    if (dup.length) throw new KasStationError(409, "transaksi yang sama baru saja tersimpan — cek daftar sebelum mengirim ulang");
    const tot = await totalHarian(tx, h.id);
    if (t.jenis === "keluar") pastikanSaldoTidakNegatif(h.saldo_awal, tot.masuk, tot.keluar + t.nominal);
    await tx`
      INSERT INTO kas_station_transaksi (harian_id, jenis, nominal, uraian, bukti_ref, created_by)
      VALUES (${h.id}, ${t.jenis}, ${t.nominal}, ${t.uraian}, ${t.bukti_ref}, ${actor})
    `;
    await tx`UPDATE kas_station_harian SET updated_at = now() WHERE id = ${h.id}`;
    await logAudit(tx, "kas_station.transaksi_ditambah", actor, { harian_id: h.id, cabang: h.cabang, tanggal: h.tanggal, jenis: t.jenis, nominal: t.nominal }, "ditambah");
    return true;
  });
  return ok ? sql.begin((tx) => fetchHarian(tx, harianId)) : null;
}

export interface TransaksiUpdate { jenis?: unknown; nominal?: unknown; uraian?: unknown; bukti_ref?: unknown; updated_by?: string | null }

async function muatTransaksi(tx: Tx, harianId: string, trxId: string) {
  const [row] = await tx`SELECT id, harian_id, jenis, nominal, uraian, bukti_ref FROM kas_station_transaksi WHERE id = ${trxId} AND harian_id = ${harianId}`;
  return row ?? null;
}

export async function updateTransaksi(
  harianId: string, trxId: string, f: TransaksiUpdate,
): Promise<(HarianRow & { transaksi: TransaksiRow[] }) | null> {
  if (!UUID_RE.test(harianId) || !UUID_RE.test(trxId)) return null;
  const actor = aktor(f.updated_by);
  if (f.jenis === undefined && f.nominal === undefined && f.uraian === undefined && f.bukti_ref === undefined) {
    throw new KasStationError(400, "tidak ada field yang diubah");
  }
  const sql = db();
  const ok = await sql.begin(async (tx) => {
    let h;
    try { h = await muatHarianDanKunci(tx, harianId); } catch (e) {
      if (e instanceof KasStationError && e.status === 404) return false;
      throw e;
    }
    const lama = await muatTransaksi(tx, h.id, trxId);
    if (!lama) return false;
    await pastikanBisaDiubah(tx, h);
    const baru = validTransaksi({
      jenis: f.jenis ?? lama.jenis,
      nominal: f.nominal ?? lama.nominal,
      uraian: f.uraian ?? lama.uraian,
      bukti_ref: f.bukti_ref === undefined ? lama.bukti_ref : f.bukti_ref,
    });
    const tot = await totalHarian(tx, h.id);
    const masuk = tot.masuk - (lama.jenis === "masuk" ? num(lama.nominal) : 0) + (baru.jenis === "masuk" ? baru.nominal : 0);
    const keluar = tot.keluar - (lama.jenis === "keluar" ? num(lama.nominal) : 0) + (baru.jenis === "keluar" ? baru.nominal : 0);
    pastikanSaldoTidakNegatif(h.saldo_awal, masuk, keluar);
    await tx`
      UPDATE kas_station_transaksi SET jenis = ${baru.jenis}, nominal = ${baru.nominal}, uraian = ${baru.uraian},
        bukti_ref = ${baru.bukti_ref}, updated_at = now()
      WHERE id = ${trxId}
    `;
    await tx`UPDATE kas_station_harian SET updated_at = now() WHERE id = ${h.id}`;
    await logAudit(tx, "kas_station.transaksi_diubah", actor, { harian_id: h.id, transaksi_id: trxId, cabang: h.cabang, tanggal: h.tanggal, jenis: baru.jenis, nominal: baru.nominal }, "diubah");
    return true;
  });
  return ok ? sql.begin((tx) => fetchHarian(tx, harianId)) : null;
}

export async function deleteTransaksi(
  harianId: string, trxId: string, actorRaw?: string | null,
): Promise<{ deleted: boolean }> {
  if (!UUID_RE.test(harianId) || !UUID_RE.test(trxId)) return { deleted: false };
  const actor = aktor(actorRaw);
  const sql = db();
  return sql.begin(async (tx) => {
    let h;
    try { h = await muatHarianDanKunci(tx, harianId); } catch (e) {
      if (e instanceof KasStationError && e.status === 404) return { deleted: false };
      throw e;
    }
    const lama = await muatTransaksi(tx, h.id, trxId);
    if (!lama) return { deleted: false };
    await pastikanBisaDiubah(tx, h);
    const tot = await totalHarian(tx, h.id);
    const masuk = tot.masuk - (lama.jenis === "masuk" ? num(lama.nominal) : 0);
    const keluar = tot.keluar - (lama.jenis === "keluar" ? num(lama.nominal) : 0);
    pastikanSaldoTidakNegatif(h.saldo_awal, masuk, keluar);
    await tx`DELETE FROM kas_station_transaksi WHERE id = ${trxId}`;
    await tx`UPDATE kas_station_harian SET updated_at = now() WHERE id = ${h.id}`;
    await logAudit(tx, "kas_station.transaksi_dihapus", actor, { harian_id: h.id, transaksi_id: trxId, cabang: h.cabang, tanggal: h.tanggal }, "dihapus");
    return { deleted: true };
  });
}

// ───────────────────────── Tulis: rekap mingguan ─────────────────────────

async function hitungSnapshot(tx: Tx, cabang: string, periodeAwal: string): Promise<RekapSnapshot | null> {
  const rows = await tx`
    SELECT h.tanggal::text AS tanggal, h.saldo_awal, h.saldo_fisik,
           COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'masuk'), 0) AS total_masuk,
           COALESCE(SUM(t.nominal) FILTER (WHERE t.jenis = 'keluar'), 0) AS total_keluar
    FROM kas_station_harian h LEFT JOIN kas_station_transaksi t ON t.harian_id = h.id
    WHERE h.cabang = ${cabang} AND h.tanggal BETWEEN ${periodeAwal}::date AND (${periodeAwal}::date + 6)
    GROUP BY h.id ORDER BY h.tanggal ASC
  `;
  return rollupMinggu(rows.map((r) => ({
    tanggal: String(r.tanggal),
    saldo_awal: num(r.saldo_awal),
    total_masuk: num(r.total_masuk),
    total_keluar: num(r.total_keluar),
    saldo_fisik: numOrNull(r.saldo_fisik),
  })));
}

export interface BuatRekapInput { cabang: unknown; periode_awal: unknown; created_by?: string | null }

// Membuat draft rekap dari data harian — atau menyegarkan snapshot draft/rejected
// yang sudah ada. Rekap yang sedang diajukan / sudah disetujui tidak disentuh.
export async function buatRekap(input: BuatRekapInput): Promise<RekapDetail> {
  const cabang = cabangWajib(input.cabang);
  const periodeAwal = tanggalWajib(input.periode_awal, "periode_awal");
  if (!isSenin(periodeAwal)) throw new KasStationError(400, "periode_awal harus hari Senin (minggu Senin–Minggu)");
  if (periodeAwal > wibHariIni()) throw new KasStationError(400, "periode belum dimulai");
  const actor = aktor(input.created_by);

  const sql = db();
  const id = await sql.begin(async (tx) => {
    if (!(await cabangDikenal(tx, cabang))) throw new KasStationError(400, `cabang '${cabang}' tidak dikenal`);
    await lockCabang(tx, cabang);
    const snap = await hitungSnapshot(tx, cabang, periodeAwal);
    if (!snap) throw new KasStationError(422, "belum ada catatan kas harian pada minggu ini — rekap tidak bisa dibuat");

    const [ada] = await tx`SELECT id, status FROM kas_station_rekap WHERE cabang = ${cabang} AND periode_awal = ${periodeAwal}`;
    if (ada) {
      if (ada.status === "submitted" || ada.status === "approved") {
        throw new KasStationError(409, `rekap minggu ini berstatus ${ada.status} dan tidak bisa dibuat ulang`);
      }
      await tx`
        UPDATE kas_station_rekap SET jumlah_hari = ${snap.jumlah_hari}, saldo_awal = ${snap.saldo_awal},
          total_masuk = ${snap.total_masuk}, total_keluar = ${snap.total_keluar}, saldo_akhir = ${snap.saldo_akhir},
          total_selisih = ${snap.total_selisih}, jumlah_hari_selisih = ${snap.jumlah_hari_selisih}, updated_at = now()
        WHERE id = ${ada.id}
      `;
      return String(ada.id);
    }
    const [r] = await tx`
      INSERT INTO kas_station_rekap (cabang, periode_awal, periode_akhir, jumlah_hari, saldo_awal, total_masuk,
        total_keluar, saldo_akhir, total_selisih, jumlah_hari_selisih, created_by)
      VALUES (${cabang}, ${periodeAwal}, ${tambahHari(periodeAwal, 6)}, ${snap.jumlah_hari}, ${snap.saldo_awal},
        ${snap.total_masuk}, ${snap.total_keluar}, ${snap.saldo_akhir}, ${snap.total_selisih}, ${snap.jumlah_hari_selisih}, ${actor})
      RETURNING id
    `;
    await logAudit(tx, "kas_station.rekap_dibuat", actor, { rekap_id: String(r.id), cabang, periode_awal: periodeAwal, ...snap }, "draft");
    return String(r.id);
  });
  const detail = await getRekap(id);
  if (!detail) throw new Error("gagal membaca rekap setelah dibuat");
  return detail;
}

interface RekapLock { id: string; cabang: string; periode_awal: string; status: StatusRekap; realisasi_at: string | null }

// Muat rekap + kunci per-cabang. Baca ulang setelah lock supaya keputusan dua
// aktor yang berbarengan terserialisasi (yang kedua melihat status terbaru).
async function muatRekapTerkunci(tx: Tx, id: string): Promise<RekapLock | null> {
  const [awal] = await tx`SELECT cabang FROM kas_station_rekap WHERE id = ${id}`;
  if (!awal) return null;
  await lockCabang(tx, String(awal.cabang));
  const [r] = await tx`
    SELECT id, cabang, periode_awal::text AS periode_awal, status, realisasi_at::text AS realisasi_at
    FROM kas_station_rekap WHERE id = ${id}
  `;
  return r ? { id: String(r.id), cabang: String(r.cabang), periode_awal: String(r.periode_awal), status: r.status as StatusRekap, realisasi_at: str(r.realisasi_at) } : null;
}

export async function submitRekap(id: string, actorRaw?: string | null): Promise<RekapDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const actor = aktor(actorRaw);
  const sql = db();
  const ok = await sql.begin(async (tx) => {
    const r = await muatRekapTerkunci(tx, id);
    if (!r) return false;
    if (!statusSesudah(r.status, "submit")) throw new KasStationError(409, `rekap berstatus ${r.status}, hanya draft/rejected yang bisa diajukan`);
    // Snapshot dihitung ulang saat diajukan — data harian bisa berubah sejak draft dibuat.
    const snap = await hitungSnapshot(tx, r.cabang, r.periode_awal);
    if (!snap) throw new KasStationError(422, "tidak ada catatan kas harian pada minggu ini — rekap tidak bisa diajukan");
    const updated = await tx`
      UPDATE kas_station_rekap SET status = 'submitted', jumlah_hari = ${snap.jumlah_hari}, saldo_awal = ${snap.saldo_awal},
        total_masuk = ${snap.total_masuk}, total_keluar = ${snap.total_keluar}, saldo_akhir = ${snap.saldo_akhir},
        total_selisih = ${snap.total_selisih}, jumlah_hari_selisih = ${snap.jumlah_hari_selisih},
        submit_count = submit_count + 1, submitted_by = ${actor}, submitted_at = now(),
        decided_by = NULL, decided_at = NULL, decision_note = NULL, updated_at = now()
      WHERE id = ${id} AND status IN ('draft','rejected')
      RETURNING id
    `;
    if (!updated.length) throw new KasStationError(409, "status rekap sudah berubah — muat ulang");
    await logAudit(tx, "kas_station.rekap_diajukan", actor, { rekap_id: id, cabang: r.cabang, periode_awal: r.periode_awal, dari_status: r.status, ...snap }, "diajukan");
    return true;
  });
  return ok ? getRekap(id) : null;
}

export async function decideRekap(
  id: string, decision: unknown, note: unknown, actorRaw?: string | null,
): Promise<RekapDetail | null> {
  if (decision !== "approve" && decision !== "reject") throw new KasStationError(400, "decision wajib approve atau reject");
  const catatan = teksOpsional(note, "note", 1000);
  if (decision === "reject" && !catatan) throw new KasStationError(400, "alasan penolakan (note) wajib diisi agar station tahu apa yang diperbaiki");
  if (!UUID_RE.test(id)) return null;
  const actor = aktor(actorRaw);
  const sql = db();
  const ok = await sql.begin(async (tx) => {
    const r = await muatRekapTerkunci(tx, id);
    if (!r) return false;
    const baru = statusSesudah(r.status, decision);
    if (!baru) throw new KasStationError(409, `rekap berstatus ${r.status}, hanya yang submitted yang bisa diputuskan`);
    const updated = await tx`
      UPDATE kas_station_rekap SET status = ${baru}, decided_by = ${actor}, decided_at = now(),
        decision_note = ${catatan}, updated_at = now()
      WHERE id = ${id} AND status = 'submitted'
      RETURNING id
    `;
    if (!updated.length) throw new KasStationError(409, "rekap ini sudah diputuskan");
    await logAudit(tx, `kas_station.rekap_${baru}`, actor, { rekap_id: id, cabang: r.cabang, periode_awal: r.periode_awal, note: catatan }, baru);
    return true;
  });
  return ok ? getRekap(id) : null;
}

export async function realisasiRekap(id: string, nominalRaw: unknown, actorRaw?: string | null): Promise<RekapDetail | null> {
  const nominal = parseNominal(nominalRaw, "realisasi_nominal", { min: "positif" });
  if (!UUID_RE.test(id)) return null;
  const actor = aktor(actorRaw);
  const sql = db();
  const ok = await sql.begin(async (tx) => {
    const r = await muatRekapTerkunci(tx, id);
    if (!r) return false;
    if (!statusSesudah(r.status, "realisasi")) throw new KasStationError(409, `rekap berstatus ${r.status}; realisasi hanya untuk rekap yang sudah approved`);
    if (r.realisasi_at) throw new KasStationError(409, "dana rekap ini sudah direalisasikan");
    const updated = await tx`
      UPDATE kas_station_rekap SET realisasi_nominal = ${nominal}, realisasi_by = ${actor}, realisasi_at = now(), updated_at = now()
      WHERE id = ${id} AND status = 'approved' AND realisasi_at IS NULL
      RETURNING id
    `;
    if (!updated.length) throw new KasStationError(409, "rekap ini sudah direalisasikan");
    await logAudit(tx, "kas_station.rekap_direalisasi", actor, { rekap_id: id, cabang: r.cabang, periode_awal: r.periode_awal, realisasi_nominal: nominal }, "direalisasi");
    return true;
  });
  return ok ? getRekap(id) : null;
}

// Angka melebihi numeric(16,2) (akumulasi total) → 22003; dipetakan route ke 422, bukan 500.
export const isNumericOverflow = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "22003";

// Dipakai route untuk memetakan "tabel belum dimigrasi" → 503 (pola F31).
export const isMigrationPending = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";
