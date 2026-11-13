// Proyek HD — tracker proyek hemodialisa (KSO) dari Deal sampai layanan berjalan
// (migrasi 314). Pindahan app terpisah "Tracker Proyek HD" (Google Sheets) — 13 Nov 2026.
//
// Gerbang menu "/proyek-hd" (lihat/buat/ubah) + kunci "proyek-hd-margin" (simulasi &
// parameter margin WRG) DIPERIKSA DI BFF; service token mem-bypass JWT di sini.
// `oleh` selalu dari sesi (diisi BFF).
//
// Lampiran catatan tahap: DISK SERVER (PROYEK_HD_UPLOAD_DIR, default
// ~/.wrg-os/uploads/proyek-hd — ikut backup-media.sh), diunduh lewat API ini.
// Tanpa Google Drive (keputusan user 13 Nov 2026, migrasi 315).

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { TransactionSql } from "postgres";
import { db } from "../db.js";
import { MAKS_DOKUMEN, namaAsliAman, tipeDariIsi } from "./kso-kontrak.js";

export const PROYEK_HD_UPLOAD_ROOT = resolve(process.env.PROYEK_HD_UPLOAD_DIR ?? `${homedir()}/.wrg-os/uploads/proyek-hd`);
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

export class ProyekHdError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

// ================================================================ murni (diuji)

export const SEGMEN = ["Kemenkes", "RSUD/Pemda", "TNI/Polri", "Swasta"] as const;
export const TIPE_PROYEK = ["Start New", "Pindah/Relokasi", "Tambah Unit", "Replacement"] as const;
export const PRIORITAS = ["Replace", "Gas", "Hold"] as const;
export const STATUS_RAG = ["Hijau", "Kuning", "Merah"] as const;
export type TipeProyek = (typeof TIPE_PROYEK)[number];

export interface Tahap { kode: string; nama: string; posisi: number }
export const TAHAP: Tahap[] = [
  { kode: "1", nama: "Deal", posisi: 1 },
  { kode: "2", nama: "Asistensi PERNEFRI", posisi: 2 },
  { kode: "3", nama: "DED", posisi: 3 },
  { kode: "4", nama: "CIP — konstruksi", posisi: 4 },
  { kode: "5", nama: "Izin OSS", posisi: 5 },
  { kode: "6a", nama: "BPJS approval", posisi: 6 },
  { kode: "6b", nama: "Layanan Umum", posisi: 6 },
  { kode: "6c", nama: "Bypass", posisi: 6 },
  { kode: "7", nama: "Layanan berjalan", posisi: 7 },
];
export const TOTAL_POSISI = 7;

export const tahapDari = (kode: string): Tahap | undefined => TAHAP.find((t) => t.kode === kode);
const posisi = (kode: string) => tahapDari(kode)?.posisi ?? 1;

// Urutan dasar per tipe proyek.
//   Start New / Replacement : 1→2→3→4→5→6a→7
//   Pindah/Relokasi         : sama, 3 & 4 boleh dilompati
//   Tambah Unit             : 1→2→3→4→5→6c→6a→7, 3 & 4 boleh dilompati, 6c opsional
//   6b (Layanan Umum) boleh dipakai sesudah OSS sambil menunggu 6a.
export function urutanTahap(tipe: TipeProyek): string[] {
  return tipe === "Tambah Unit" ? ["1", "2", "3", "4", "5", "6c", "6a", "7"] : ["1", "2", "3", "4", "5", "6a", "7"];
}

function bolehLompat(tipe: TipeProyek): string[] {
  const s: string[] = [];
  if (tipe === "Pindah/Relokasi" || tipe === "Tambah Unit") s.push("3", "4");
  if (tipe === "Tambah Unit") s.push("6c");
  return s;
}

export interface OpsiMaju { kode: string; nama: string; dilompati: string[]; utama: boolean }

/** Pilihan tahap berikut dari tahap berjalan. Opsi pertama = default (tanpa lompat). */
export function opsiMaju(tipe: TipeProyek, kini: string): OpsiMaju[] {
  if (kini === "7") return [];
  const opsi: OpsiMaju[] = [];
  const tambah = (kode: string, dilompati: string[] = []) => {
    if (opsi.some((o) => o.kode === kode)) return;
    opsi.push({ kode, nama: tahapDari(kode)!.nama, dilompati, utama: opsi.length === 0 });
  };
  if (kini === "6b") { tambah("6a"); return opsi; }
  const urut = urutanTahap(tipe);
  const lompat = bolehLompat(tipe);
  const i = urut.indexOf(kini);
  if (i < 0) {
    const nxt = urut.find((k) => posisi(k) > posisi(kini));
    if (nxt) tambah(nxt);
    return opsi;
  }
  tambah(urut[i + 1]);
  const dilewati: string[] = [];
  for (let j = i + 1; j < urut.length - 1 && lompat.includes(urut[j]); j++) {
    dilewati.push(urut[j]);
    tambah(urut[j + 1], [...dilewati]);
  }
  if (posisi(kini) === 5 || kini === "6c") tambah("6b");
  return opsi;
}

/** Tahap tujuan yang sah dari tahap berjalan, atau pesan galat. */
export function tentukanMaju(tipe: TipeProyek, kini: string, diminta?: string | null):
  { ok: true; ke: string; dilompati: string[] } | { ok: false; error: string } {
  if (kini === "7") return { ok: false, error: "Tahap 7 (Layanan berjalan) tidak bisa diselesaikan." };
  const opsi = opsiMaju(tipe, kini);
  if (!opsi.length) return { ok: false, error: "Tidak ada tahap berikutnya." };
  if (!diminta) return { ok: true, ke: opsi[0].kode, dilompati: [] };
  const o = opsi.find((x) => x.kode === diminta);
  if (!o) return { ok: false, error: `Dari tahap ${kini} tidak bisa pindah ke ${diminta} untuk tipe ${tipe}.` };
  return { ok: true, ke: o.kode, dilompati: o.dilompati };
}

export const progresPct = (kode: string) => Math.round((posisi(kode) / TOTAL_POSISI) * 100);

/** 7 kartu alur tahap. Posisi 6 memakai kode 6x yang sedang dipakai; tipe Tambah Unit berlabel "BPJS / Bypass". */
export function kartuAlur(tipe: TipeProyek, kini: string): (Tahap & { status: "selesai" | "berjalan" | "belum" })[] {
  const pk = posisi(kini);
  return [1, 2, 3, 4, 5, 6, 7].map((p) => {
    let t = TAHAP.find((x) => x.posisi === p)!;
    if (p === 6) t = pk === 6 ? tahapDari(kini)! : tipe === "Tambah Unit" ? { ...tahapDari("6a")!, nama: "BPJS / Bypass" } : tahapDari("6a")!;
    return { ...t, status: p < pk ? "selesai" : p === pk ? "berjalan" : "belum" };
  });
}

const teks = (v: unknown, maks = 300): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, maks) : null;
};
const teksPanjang = (v: unknown, maks = 4000): string => (typeof v === "string" ? v.trim().slice(0, maks) : "");

function bulat(v: unknown, field: string, opts: { min?: number; wajib?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === "") {
    if (opts.wajib) throw new ProyekHdError(400, `${field} wajib diisi`, field);
    return null;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < (opts.min ?? 0)) throw new ProyekHdError(400, `${field} harus bilangan bulat ≥ ${opts.min ?? 0}`, field);
  return n;
}

function pilihan<T extends readonly string[]>(v: unknown, daftar: T, field: string): T[number] | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !daftar.includes(v)) throw new ProyekHdError(400, `${field} harus salah satu dari ${daftar.join(" / ")}`, field);
  return v as T[number];
}

export const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** YYYY-MM-DD kalender nyata, tidak di masa depan (WIB). Kosong = hari ini. */
export function tanggalCatatan(v: unknown, hariIni = hariIniWib()): string {
  if (v === undefined || v === null || v === "") return hariIni;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ProyekHdError(400, "format tanggal tidak valid", "tanggal");
  const [t, b, h] = v.split("-").map(Number);
  const d = new Date(Date.UTC(t, b - 1, h));
  if (d.getUTCFullYear() !== t || d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) throw new ProyekHdError(400, "tanggal tidak ada di kalender", "tanggal");
  if (v > hariIni) throw new ProyekHdError(400, "tanggal catatan tidak boleh di masa depan", "tanggal");
  return v;
}

export interface IsianProyek {
  nama_rs: string; account_id: number | null; kota: string | null; segmen: string | null; tipe_proyek: TipeProyek;
  prioritas: string; nama_alat: string | null; unit_kso: number; unit_terinstal: number; harga_unit: number | null;
  nomor_kontrak: string | null; target_tindakan_bln: number | null; target_golive: string | null;
  pic_employee_id: string | null; next_action: string | null;
}

export function isianBaru(b: Record<string, unknown>): IsianProyek {
  const nama_rs = teks(b.nama_rs, 200);
  if (!nama_rs) throw new ProyekHdError(400, "nama Customer / RS wajib diisi", "nama_rs");
  const unit_kso = bulat(b.unit_kso, "unit_kso", { min: 1, wajib: true })!;
  const golive = teks(b.target_golive, 7);
  if (golive && !/^\d{4}-(0[1-9]|1[0-2])$/.test(golive)) throw new ProyekHdError(400, "target go-live format YYYY-MM", "target_golive");
  const harga = b.harga_unit === undefined || b.harga_unit === null || b.harga_unit === "" ? null : Number(b.harga_unit);
  if (harga !== null && (!Number.isFinite(harga) || harga < 0)) throw new ProyekHdError(400, "harga unit tidak valid", "harga_unit");
  return {
    nama_rs,
    account_id: bulat(b.account_id, "account_id", { min: 1 }),
    kota: teks(b.kota, 80),
    segmen: pilihan(b.segmen, SEGMEN, "segmen"),
    tipe_proyek: pilihan(b.tipe_proyek, TIPE_PROYEK, "tipe_proyek") ?? "Start New",
    prioritas: pilihan(b.prioritas, PRIORITAS, "prioritas") ?? "Gas",
    nama_alat: teks(b.nama_alat, 120),
    unit_kso,
    unit_terinstal: bulat(b.unit_terinstal, "unit_terinstal") ?? 0,
    harga_unit: harga,
    nomor_kontrak: teks(b.nomor_kontrak, 120),
    target_tindakan_bln: bulat(b.target_tindakan_bln, "target_tindakan_bln"),
    target_golive: golive,
    pic_employee_id: teks(b.pic_employee_id, 60),
    next_action: teks(b.next_action, 500),
  };
}

/** Ubahan sebagian. Hanya kolom yang dikirim yang diubah. */
export function isianUbah(b: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if ("unit_kso" in b) o.unit_kso = bulat(b.unit_kso, "unit_kso", { min: 1, wajib: true });
  if ("unit_terinstal" in b) o.unit_terinstal = bulat(b.unit_terinstal, "unit_terinstal", { wajib: true });
  if ("unit_running" in b) o.unit_running = bulat(b.unit_running, "unit_running", { wajib: true });
  if ("status_rag" in b) o.status_rag = pilihan(b.status_rag, STATUS_RAG, "status_rag") ?? "Kuning";
  if ("prioritas" in b) o.prioritas = pilihan(b.prioritas, PRIORITAS, "prioritas") ?? "Gas";
  if ("next_action" in b) o.next_action = teks(b.next_action, 500);
  if ("pic_employee_id" in b) o.pic_employee_id = teks(b.pic_employee_id, 60);
  if ("nomor_kontrak" in b) o.nomor_kontrak = teks(b.nomor_kontrak, 120);
  if ("account_id" in b) o.account_id = bulat(b.account_id, "account_id", { min: 1 });
  if ("target_tindakan_bln" in b) o.target_tindakan_bln = bulat(b.target_tindakan_bln, "target_tindakan_bln");
  if ("target_golive" in b) {
    const g = teks(b.target_golive, 7);
    if (g && !/^\d{4}-(0[1-9]|1[0-2])$/.test(g)) throw new ProyekHdError(400, "target go-live format YYYY-MM", "target_golive");
    o.target_golive = g;
  }
  return o;
}

export const MAKS_LAMPIRAN = 5;

/** Validasi berkas lampiran (isi, bukan label browser) → pesan tolak atau null. Total ≤ 8 MB per kiriman. */
export function alasanTolakLampiran(files: { nama: string; buf: Uint8Array }[]): string | null {
  if (files.length > MAKS_LAMPIRAN) return `maksimal ${MAKS_LAMPIRAN} berkas per catatan`;
  let total = 0;
  for (const f of files) {
    if (f.buf.length === 0) return `${f.nama}: berkas kosong`;
    if (!tipeDariIsi(f.buf)) return `${f.nama}: hanya PDF, JPG, atau PNG`;
    total += f.buf.length;
  }
  if (total > MAKS_DOKUMEN) return "total lampiran maksimal 8 MB per catatan";
  return null;
}

export function kodeBerikut(kodeTerakhir: string | null): string {
  const n = kodeTerakhir ? Number(kodeTerakhir.replace(/^PRJ-/, "")) : 0;
  return `PRJ-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------- simulasi
export const JENIS_SIMULASI = ["proyeksi_rs", "margin_wrg"] as const;
export type JenisSimulasi = (typeof JENIS_SIMULASI)[number];

// Kunci input yang diterima per jenis — angka ≥ 0 semua, kecuali `mode` (proyeksi_rs).
export const KUNCI_SIMULASI: Record<JenisSimulasi, readonly string[]> = {
  proyeksi_rs: ["mesin", "shift", "hari", "tarif_klaim", "porsi_pct", "harga_tetap"],
  margin_wrg: [
    "needle", "circuit", "bicarb", "acid", "dialyzer", "harga_mesin", "ro",
    "mesin", "backup", "tindakan_per_hari", "hari", "tenor", "pendapatan", "share_pct",
    "gaji_teknisi", "fee_dpjp", "kirim", "lab_air", "diklat", "kalibrasi", "pitnas", "renovasi",
    "lain_per_tindakan", "lain_harian", "lain_bln", "min_pct",
  ],
};

export function inputSimulasi(jenis: JenisSimulasi, v: unknown): Record<string, number | string> {
  if (!v || typeof v !== "object") throw new ProyekHdError(400, "input simulasi wajib berupa objek", "input");
  const src = v as Record<string, unknown>;
  const o: Record<string, number | string> = {};
  for (const k of KUNCI_SIMULASI[jenis]) {
    const n = Number(src[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new ProyekHdError(400, `input ${k} tidak valid`, "input");
    o[k] = n;
  }
  if (jenis === "proyeksi_rs") {
    if (src.mode !== "bagi_hasil" && src.mode !== "harga_tetap") throw new ProyekHdError(400, "mode harus bagi_hasil atau harga_tetap", "input");
    o.mode = src.mode;
  }
  return o;
}

// ================================================================ DB

const idDari = (v: string): number => {
  if (!/^\d{1,12}$/.test(v)) throw new ProyekHdError(400, "id tidak valid");
  return Number(v);
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface ProyekRow {
  id: number; kode: string; account_id: number | null; faskes_nama: string | null; nama_rs: string; kota: string | null;
  segmen: string | null; tipe_proyek: TipeProyek; prioritas: string; nama_alat: string | null;
  unit_kso: number; unit_terinstal: number; unit_running: number; harga_unit: number | null;
  nomor_kontrak: string | null; target_tindakan_bln: number | null; target_golive: string | null;
  tahap_kode: string; tahap_nama: string; progres_pct: number; status_rag: string;
  pic_employee_id: string | null; pic_nama: string | null; next_action: string | null;
  diubah_oleh: string | null; diubah_at: string; dibuat_at: string;
}

const KOLOM = (sql: ReturnType<typeof db>) => sql`
  p.id::int, p.kode, p.account_id::int, c.name AS faskes_nama, p.nama_rs, p.kota, p.segmen, p.tipe_proyek, p.prioritas,
  p.nama_alat, p.unit_kso, p.unit_terinstal, p.unit_running, p.harga_unit::float8 AS harga_unit, p.nomor_kontrak,
  p.target_tindakan_bln, p.target_golive, p.tahap_kode, p.status_rag, p.pic_employee_id, e.nama AS pic_nama,
  p.next_action, p.diubah_oleh, p.diubah_at::text, p.dibuat_at::text`;
const DARI = (sql: ReturnType<typeof db>) => sql`
  FROM hd_proyek p LEFT JOIN accurate_customer c ON c.id = p.account_id LEFT JOIN employee e ON e.id = p.pic_employee_id`;

const keRow = (r: Record<string, unknown>): ProyekRow => ({
  ...(r as unknown as ProyekRow),
  harga_unit: num(r.harga_unit),
  tahap_nama: tahapDari(String(r.tahap_kode))?.nama ?? String(r.tahap_kode),
  progres_pct: progresPct(String(r.tahap_kode)),
});

export async function listProyek(): Promise<ProyekRow[]> {
  const sql = db();
  const rows = await sql`SELECT ${KOLOM(sql)} ${DARI(sql)} WHERE p.dihapus_at IS NULL ORDER BY p.kode`;
  return rows.map(keRow);
}

async function satuProyek(id: number): Promise<ProyekRow> {
  const sql = db();
  const [r] = await sql`SELECT ${KOLOM(sql)} ${DARI(sql)} WHERE p.id = ${id} AND p.dihapus_at IS NULL`;
  if (!r) throw new ProyekHdError(404, "proyek tidak ditemukan");
  return keRow(r);
}

// ---------------------------------------------------------------- parameter
export interface Param { kunci: string; nilai: number | null; keterangan: string; urut: number; diubah_oleh: string | null; diubah_at: string | null }

export async function listParam(): Promise<Param[]> {
  const rows = await db()`SELECT kunci, nilai::float8 AS nilai, keterangan, urut, diubah_oleh, diubah_at::text FROM hd_param ORDER BY urut, kunci`;
  return rows.map((r) => ({ ...(r as unknown as Param), nilai: num(r.nilai) }));
}

/** Ubah nilai beberapa kunci sekaligus. Kunci yang tak dikenal ditolak; null = kosongkan. */
export async function ubahParam(nilai: unknown, oleh: string | null): Promise<Param[]> {
  if (!nilai || typeof nilai !== "object") throw new ProyekHdError(400, "nilai wajib berupa objek kunci → angka");
  const entri = Object.entries(nilai as Record<string, unknown>);
  if (!entri.length) return listParam();
  const sql = db();
  const kenal = new Set((await sql`SELECT kunci FROM hd_param`).map((r) => String(r.kunci)));
  for (const [k, v] of entri) {
    if (!kenal.has(k)) throw new ProyekHdError(400, `parameter ${k} tidak dikenal`, k);
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new ProyekHdError(400, `nilai ${k} harus angka ≥ 0`, k);
  }
  await sql.begin(async (tx) => {
    for (const [k, v] of entri) {
      await tx`UPDATE hd_param SET nilai = ${v as number | null}, diubah_oleh = ${oleh}, diubah_at = now() WHERE kunci = ${k}`;
    }
  });
  return listParam();
}

async function paramTracker() {
  const rows = await db()`SELECT kunci, nilai::float8 AS nilai FROM hd_param WHERE kunci !~ '^(rs|margin)_'`;
  const p = new Map(rows.map((r) => [String(r.kunci), num(r.nilai)]));
  return {
    tarif_per_tindakan: p.get("tarif_per_tindakan") ?? null,
    tindakan_per_mesin_bln: p.get("tindakan_per_mesin_bln") ?? null,
    basis_bulan_target: p.get("basis_bulan_target") ?? null,
    target_rasio_running_idle: p.get("target_rasio_running_idle") ?? null,
  };
}

// ---------------------------------------------------------------- ringkasan dashboard
/** KPI dihitung di SQL atas SEMUA proyek aktif — bukan dari halaman tabel. */
export async function ringkasan() {
  const sql = db();
  const [k] = await sql`
    SELECT count(*)::int AS proyek,
           COALESCE(sum(unit_kso), 0)::int AS kso,
           COALESCE(sum(unit_terinstal), 0)::int AS terinstal,
           COALESCE(sum(unit_running), 0)::int AS running,
           COALESCE(sum(unit_terinstal - unit_running), 0)::int AS idle,
           COALESCE(sum(GREATEST(unit_kso - unit_terinstal, 0)), 0)::int AS kurang,
           COALESCE(sum(GREATEST(unit_kso - unit_terinstal, 0) * COALESCE(harga_unit, 0)), 0)::float8 AS dana,
           COALESCE(sum(COALESCE(target_tindakan_bln, 0)), 0)::int AS target_tindakan
      FROM hd_proyek WHERE dihapus_at IS NULL`;
  const per = await sql`SELECT tahap_kode, count(*)::int AS n FROM hd_proyek WHERE dihapus_at IS NULL GROUP BY tahap_kode`;
  const params = await paramTracker();
  const n = new Map(per.map((r) => [String(r.tahap_kode), Number(r.n)]));
  return {
    kpi: {
      proyek: Number(k.proyek), kso: Number(k.kso), terinstal: Number(k.terinstal), running: Number(k.running),
      idle: Number(k.idle), kurang: Number(k.kurang), dana: Number(k.dana),
      rasio: Number(k.idle) > 0 ? Number(k.running) / Number(k.idle) : null,
      target_rasio: params.target_rasio_running_idle,
      omset: params.tarif_per_tindakan === null ? null : Number(k.target_tindakan) * params.tarif_per_tindakan,
    },
    tahap: TAHAP.map((t) => ({ ...t, jumlah: n.get(t.kode) ?? 0 })),
  };
}

// ---------------------------------------------------------------- referensi
export async function referensi() {
  const kar = await db()`SELECT id, nama FROM employee ORDER BY nama`;
  return { tahap: TAHAP, karyawan: kar.map((r) => ({ id: String(r.id), nama: String(r.nama) })) };
}

export async function cariFaskes(q: unknown) {
  const s = teks(q, 80);
  if (!s || s.length < 2) return [];
  const pola = "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await db()`
    SELECT id::int, name, no FROM accurate_customer
     WHERE name ILIKE ${pola} OR no ILIKE ${pola}
     ORDER BY name LIMIT 20`;
  return rows.map((r) => ({ id: Number(r.id), nama: String(r.name ?? ""), no: r.no ? String(r.no) : null }));
}

// ---------------------------------------------------------------- detail
export interface CatatanView {
  id: number; tahap_kode: string; tanggal: string; catatan: string; oleh: string | null; dibuat_at: string;
  lampiran: { id: number; nama_asli: string; mime: string; ukuran: number }[];
}

export async function detailProyek(idStr: string) {
  const id = idDari(idStr);
  const proyek = await satuProyek(id);
  const sql = db();
  const [catatan, lampiran, riwayat] = await Promise.all([
    sql`SELECT id::int, tahap_kode, tanggal::text, catatan, oleh, dibuat_at::text FROM hd_catatan WHERE proyek_id = ${id} ORDER BY tanggal DESC, id DESC`,
    sql`SELECT id::int, catatan_id::int, nama_asli, mime, ukuran FROM hd_lampiran WHERE proyek_id = ${id} ORDER BY id`,
    sql`SELECT id::int, dari_tahap, ke_tahap, tanggal::text, oleh FROM hd_riwayat_tahap WHERE proyek_id = ${id} ORDER BY tanggal DESC, id DESC`,
  ]);
  const cv: CatatanView[] = catatan.map((c) => ({
    ...(c as unknown as CatatanView),
    lampiran: lampiran.filter((l) => l.catatan_id === c.id).map((l) => ({ id: Number(l.id), nama_asli: String(l.nama_asli), mime: String(l.mime), ukuran: Number(l.ukuran) })),
  }));
  return {
    proyek,
    alur: kartuAlur(proyek.tipe_proyek, proyek.tahap_kode),
    opsi_maju: opsiMaju(proyek.tipe_proyek, proyek.tahap_kode),
    catatan: cv,
    riwayat,
  };
}

// ---------------------------------------------------------------- tulis
export async function buatProyek(b: Record<string, unknown>, oleh: string | null): Promise<ProyekRow> {
  const d = isianBaru(b);
  const sql = db();
  const id = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('hd_proyek:kode'))`;
    const [last] = await tx`SELECT kode FROM hd_proyek ORDER BY length(kode) DESC, kode DESC LIMIT 1`;
    const kode = kodeBerikut(last ? String(last.kode) : null);
    const [r] = await tx`
      INSERT INTO hd_proyek (kode, account_id, nama_rs, kota, segmen, tipe_proyek, prioritas, nama_alat, unit_kso, unit_terinstal,
        harga_unit, nomor_kontrak, target_tindakan_bln, target_golive, pic_employee_id, next_action, dibuat_oleh, diubah_oleh)
      VALUES (${kode}, ${d.account_id}, ${d.nama_rs}, ${d.kota}, ${d.segmen}, ${d.tipe_proyek}, ${d.prioritas}, ${d.nama_alat},
        ${d.unit_kso}, ${d.unit_terinstal}, ${d.harga_unit}, ${d.nomor_kontrak}, ${d.target_tindakan_bln}, ${d.target_golive},
        ${d.pic_employee_id}, ${d.next_action}, ${oleh}, ${oleh})
      RETURNING id::int`;
    await tx`INSERT INTO hd_riwayat_tahap (proyek_id, dari_tahap, ke_tahap, tanggal, oleh) VALUES (${r.id}, NULL, '1', ${hariIniWib()}, ${oleh})`;
    return Number(r.id);
  }).catch(galatFk);
  return satuProyek(id);
}

// FK pic/faskes yang salah → 400 terbaca, bukan 500.
function galatFk(e: unknown): never {
  const m = (e as { constraint_name?: string; code?: string });
  if (m?.code === "23503") throw new ProyekHdError(400, m.constraint_name?.includes("pic") ? "PIC tidak dikenal" : "faskes tidak dikenal");
  if (m?.code === "23514") throw new ProyekHdError(400, "isian melanggar aturan data (mis. unit running melebihi terinstal)");
  throw e;
}

/** Ubah sebagian; `diubah_at` dari klien wajib sama (cegah dua orang saling timpa). */
export async function ubahProyek(idStr: string, b: Record<string, unknown>, oleh: string | null): Promise<ProyekRow> {
  const id = idDari(idStr);
  const o = isianUbah(b);
  const cur = await satuProyek(id);
  if (typeof b.diubah_at !== "string" || b.diubah_at !== cur.diubah_at) {
    throw new ProyekHdError(409, "data proyek sudah diubah orang lain — muat ulang halaman");
  }
  const terinstal = (o.unit_terinstal as number | undefined) ?? cur.unit_terinstal;
  const running = (o.unit_running as number | undefined) ?? cur.unit_running;
  if (running > terinstal) throw new ProyekHdError(400, "unit running tidak boleh melebihi unit terinstal", "unit_running");
  if (!Object.keys(o).length) return cur;
  const sql = db();
  await sql`UPDATE hd_proyek SET ${sql(o)}, diubah_oleh = ${oleh}, diubah_at = now() WHERE id = ${id}`.catch(galatFk);
  return satuProyek(id);
}

type Berkas = { nama: string; buf: Uint8Array };

type Tx = TransactionSql<Record<string, unknown>>;

async function simpanCatatan(
  tx: Tx,
  p: ProyekRow, tanggal: string, catatan: string, files: Berkas[], oleh: string | null, ditulis: string[],
): Promise<number> {
  const [c] = await tx`
    INSERT INTO hd_catatan (proyek_id, tahap_kode, tanggal, catatan, oleh)
    VALUES (${p.id}, ${p.tahap_kode}, ${tanggal}, ${catatan || "(lampiran)"}, ${oleh}) RETURNING id::int`;
  if (files.length) await mkdir(PROYEK_HD_UPLOAD_ROOT, { recursive: true });
  for (const f of files) {
    const mime = tipeDariIsi(f.buf)!;
    const nama = namaAsliAman(f.nama);
    const namaSimpan = `${p.id}-${c.id}-${Date.now()}-${randomBytes(6).toString("hex")}.${EXT[mime]}`;
    const abs = resolve(PROYEK_HD_UPLOAD_ROOT, namaSimpan);
    await writeFile(abs, f.buf);
    ditulis.push(abs);
    await tx`
      INSERT INTO hd_lampiran (catatan_id, proyek_id, nama_simpan, nama_asli, mime, ukuran, diunggah_oleh)
      VALUES (${c.id}, ${p.id}, ${namaSimpan}, ${nama}, ${mime}, ${f.buf.length}, ${oleh})`;
  }
  return Number(c.id);
}

/** Berkas yang sudah tertulis ke disk dihapus lagi bila transaksi gagal — tak ada berkas yatim. */
async function denganBerkas<T>(fn: (ditulis: string[]) => Promise<T>): Promise<T> {
  const ditulis: string[] = [];
  try {
    return await fn(ditulis);
  } catch (e) {
    for (const abs of ditulis) await unlink(abs).catch(() => undefined);
    throw e;
  }
}

/** Catatan hanya untuk tahap berjalan; tahap_kode dari klien harus sama dengan tahap kini. */
export async function tambahCatatan(idStr: string, b: Record<string, unknown>, files: Berkas[], oleh: string | null) {
  const id = idDari(idStr);
  const catatan = teksPanjang(b.catatan);
  if (!catatan && !files.length) throw new ProyekHdError(400, "isi catatan atau lampirkan minimal satu berkas", "catatan");
  const tanggal = tanggalCatatan(b.tanggal);
  const tolak = alasanTolakLampiran(files);
  if (tolak) throw new ProyekHdError(400, tolak, "file");
  return denganBerkas(async (ditulis) => {
    await db().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`hd_proyek:${id}`}))`;
      const p = await satuProyek(id);
      if (b.tahap_kode && b.tahap_kode !== p.tahap_kode) {
        throw new ProyekHdError(409, `tahap berjalan sudah ${p.tahap_kode}, bukan ${String(b.tahap_kode)} — muat ulang halaman`);
      }
      await simpanCatatan(tx, p, tanggal, catatan, files, oleh, ditulis);
      await tx`UPDATE hd_proyek SET diubah_oleh = ${oleh}, diubah_at = now() WHERE id = ${id}`;
    });
    return detailProyek(String(id));
  });
}

/** Tandai tahap berjalan selesai → (catatan opsional) → riwayat → pindah tahap. */
export async function majuTahap(idStr: string, b: Record<string, unknown>, files: Berkas[], oleh: string | null) {
  const id = idDari(idStr);
  const catatan = teksPanjang(b.catatan);
  const adaCatatan = Boolean(catatan) || files.length > 0;
  const tanggal = tanggalCatatan(b.tanggal);
  const tolak = alasanTolakLampiran(files);
  if (tolak) throw new ProyekHdError(400, tolak, "file");
  return denganBerkas(async (ditulis) => {
    let hasil: { dari: string; ke: string; dilompati: string[] } | null = null;
    await db().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`hd_proyek:${id}`}))`;
      const p = await satuProyek(id);
      if (typeof b.diubah_at !== "string" || b.diubah_at !== p.diubah_at) {
        throw new ProyekHdError(409, "data proyek sudah diubah orang lain — muat ulang halaman");
      }
      const r = tentukanMaju(p.tipe_proyek, p.tahap_kode, typeof b.ke_tahap === "string" ? b.ke_tahap : null);
      if (!r.ok) throw new ProyekHdError(400, r.error, "ke_tahap");
      if (adaCatatan) await simpanCatatan(tx, p, tanggal, catatan, files, oleh, ditulis);
      await tx`INSERT INTO hd_riwayat_tahap (proyek_id, dari_tahap, ke_tahap, tanggal, oleh) VALUES (${id}, ${p.tahap_kode}, ${r.ke}, ${hariIniWib()}, ${oleh})`;
      await tx`UPDATE hd_proyek SET tahap_kode = ${r.ke}, diubah_oleh = ${oleh}, diubah_at = now() WHERE id = ${id}`;
      hasil = { dari: p.tahap_kode, ke: r.ke, dilompati: r.dilompati };
    });
    return { ...hasil!, detail: await detailProyek(String(id)) };
  });
}

export async function bacaLampiran(idStr: string): Promise<{ nama: string; mime: string; buf: Buffer }> {
  const id = idDari(idStr);
  const [r] = await db()`
    SELECT l.nama_simpan, l.nama_asli, l.mime FROM hd_lampiran l JOIN hd_proyek p ON p.id = l.proyek_id
     WHERE l.id = ${id} AND p.dihapus_at IS NULL`;
  if (!r) throw new ProyekHdError(404, "lampiran tidak ditemukan");
  // nama_simpan dibuat server, tapi tetap dipastikan tak keluar dari root unggahan.
  const abs = resolve(PROYEK_HD_UPLOAD_ROOT, String(r.nama_simpan));
  const rel = relative(PROYEK_HD_UPLOAD_ROOT, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new ProyekHdError(404, "lampiran tidak ditemukan");
  try {
    return { nama: String(r.nama_asli), mime: String(r.mime), buf: await readFile(abs) };
  } catch {
    throw new ProyekHdError(404, "berkas lampiran hilang dari server");
  }
}

// ---------------------------------------------------------------- simulasi
export interface SimulasiRow { id: number; jenis: JenisSimulasi; label: string | null; input: Record<string, unknown>; ringkasan: string; oleh: string | null; dibuat_at: string }

/** `jenis` = jenis yang boleh dibaca peminta (BFF menentukan dari izin margin). */
export async function listSimulasi(idStr: string, jenis: JenisSimulasi[]): Promise<SimulasiRow[]> {
  const id = idDari(idStr);
  const boleh = jenis.filter((j) => (JENIS_SIMULASI as readonly string[]).includes(j));
  if (!boleh.length) return [];
  const rows = await db()`
    SELECT id::int, jenis, label, input, ringkasan, oleh, dibuat_at::text FROM hd_simulasi
     WHERE proyek_id = ${id} AND jenis = ANY(${boleh}) ORDER BY dibuat_at DESC, id DESC LIMIT 100`;
  return rows as unknown as SimulasiRow[];
}

export async function simpanSimulasi(idStr: string, b: Record<string, unknown>, oleh: string | null): Promise<SimulasiRow> {
  const id = idDari(idStr);
  const jenis = pilihan(b.jenis, JENIS_SIMULASI, "jenis");
  if (!jenis) throw new ProyekHdError(400, "jenis simulasi wajib", "jenis");
  const input = inputSimulasi(jenis, b.input);
  await satuProyek(id);
  const sql = db();
  const [r] = await sql`
    INSERT INTO hd_simulasi (proyek_id, jenis, label, input, ringkasan, oleh)
    VALUES (${id}, ${jenis}, ${teks(b.label, 120)}, ${sql.json(input)}, ${teks(b.ringkasan, 300) ?? ""}, ${oleh})
    RETURNING id::int, jenis, label, input, ringkasan, oleh, dibuat_at::text`;
  return r as unknown as SimulasiRow;
}
