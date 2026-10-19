// F32 — Bukti Pembayaran: arsip foto bukti bayar bertanda KODE PENGAJUAN (migrasi 238).
//
// Keputusan Direktur 2026-10-19: tanpa OCR, tanpa pencocokan ke Accurate, tanpa WA.
// Admin mengunggah foto + kode di dashboard; accounting merekonsiliasi sendiri. Jadi
// modul ini hanya MENYIMPAN dan MENYAJIKAN bukti — tak ada logika cocok/tak-cocok.
//
// Pola unggah = F47 (kso-kontrak.ts): berkas di disk di luar allow-list GET /media
// (unduhan hanya lewat endpoint terjaga izin), tipe dari ISI berkas, nama simpan acak.
// Beda: append-only (tak ada ubah/hapus — ini bukti) dan kode pengajuan teks bebas.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { db } from "../db.js";
import { namaAsliAman } from "./kso-kontrak.js";

export const BUKTI_UPLOAD_ROOT = resolve(process.env.BUKTI_PEMBAYARAN_UPLOAD_DIR ?? `${homedir()}/.wrg-os/uploads/bukti-pembayaran`);
// 8 MB, bukan 10: middleware Next (apps/web) memotong body > 10 MB dan multipart menambah overhead.
export const MAKS_BUKTI = 8 * 1024 * 1024;
const EKSTENSI: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class BuktiError extends Error {
  constructor(message: string, public status: 400 | 404 | 503 = 400, public field?: string) {
    super(message);
  }
}

/** Kode pengajuan → bentuk baku (spasi pinggir dibuang, huruf besar) atau null bila tak valid.
 *  Spasi DI TENGAH kode ditolak, bukan dibuang: "CN 00012" → "CN00012" mengubah makna diam-diam. */
export function normalisasiKode(mentah: unknown): string | null {
  if (typeof mentah !== "string") return null;
  const kode = mentah.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._/-]{1,39}$/.test(kode) ? kode : null;
}

/** Tipe berkas dari ISI (magic bytes), bukan label MIME kiriman browser. PDF/JPEG/PNG/WebP. */
export function tipeBukti(buf: Uint8Array): string | null {
  if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return "image/png";
  // WebP = "RIFF" <4 byte ukuran> "WEBP"
  if (buf.length >= 12 && [0x52, 0x49, 0x46, 0x46].every((b, i) => buf[i] === b) && [0x57, 0x45, 0x42, 0x50].every((b, i) => buf[8 + i] === b)) return "image/webp";
  return null;
}

/** Validasi murni → pesan tolak (+ field) atau null. */
export function alasanTolakBukti(kode: string | null, ukuran: number, buf: Uint8Array): { pesan: string; field: string } | null {
  if (!kode) return { pesan: "kode pengajuan tidak valid — isi 2-40 karakter: huruf, angka, . _ / - (tanpa spasi)", field: "kode" };
  if (ukuran <= 0) return { pesan: "file kosong", field: "file" };
  if (ukuran > MAKS_BUKTI) return { pesan: "file maksimal 8 MB", field: "file" };
  if (!tipeBukti(buf)) return { pesan: "hanya foto JPG, PNG, WebP, atau PDF", field: "file" };
  return null;
}

export interface BuktiRow {
  id: string;
  kode_pengajuan: string;
  catatan: string | null;
  nama: string;
  mime: string;
  ukuran: number;
  oleh: string | null;
  diunggah_at: string;
}

const kolom = (r: Record<string, unknown>): BuktiRow => ({
  id: String(r.id),
  kode_pengajuan: String(r.kode_pengajuan),
  catatan: r.catatan ? String(r.catatan) : null,
  nama: String(r.nama_asli),
  mime: String(r.mime),
  ukuran: Number(r.ukuran),
  oleh: r.diunggah_oleh ? String(r.diunggah_oleh) : null,
  diunggah_at: String(r.diunggah_at),
});

// Tabel belum dimigrasi (42P01) → 503 yang jelas, bukan 500 generik.
function petaGalat(e: unknown): never {
  if (e instanceof BuktiError) throw e;
  if ((e as { code?: string })?.code === "42P01") throw new BuktiError("migrasi 238 (bukti_pembayaran) belum diterapkan", 503);
  throw e;
}

export async function unggahBukti(
  file: { nama: string; buf: Uint8Array },
  kodeMentah: unknown,
  catatan: string | null,
  oleh: string | null,
): Promise<BuktiRow> {
  const kode = normalisasiKode(kodeMentah);
  const tolak = alasanTolakBukti(kode, file.buf.length, file.buf);
  if (tolak) throw new BuktiError(tolak.pesan, 400, tolak.field);
  const mime = tipeBukti(file.buf)!;
  const nama = namaAsliAman(file.nama);
  const namaSimpan = `${Date.now()}-${randomBytes(8).toString("hex")}.${EKSTENSI[mime]}`;

  await mkdir(BUKTI_UPLOAD_ROOT, { recursive: true });
  const abs = resolve(BUKTI_UPLOAD_ROOT, namaSimpan);
  await writeFile(abs, file.buf);
  try {
    const [r] = await db()`
      INSERT INTO bukti_pembayaran (kode_pengajuan, catatan, nama_asli, nama_simpan, mime, ukuran, diunggah_oleh)
      VALUES (${kode}, ${catatan?.trim() || null}, ${nama}, ${namaSimpan}, ${mime}, ${file.buf.length}, ${oleh})
      RETURNING id::text AS id, kode_pengajuan, catatan, nama_asli, mime, ukuran, diunggah_oleh, diunggah_at::text AS diunggah_at`;
    return kolom(r);
  } catch (e) {
    // Jangan tinggalkan berkas yatim bila baris gagal ditulis.
    await unlink(abs).catch(() => {});
    return petaGalat(e);
  }
}

export interface FilterBukti {
  kode?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function daftarBukti(f: FilterBukti = {}): Promise<{ total: number; items: BuktiRow[] }> {
  const limit = Math.min(Math.max(Math.trunc(Number(f.limit)) || 50, 1), 200);
  const offset = Math.max(Math.trunc(Number(f.offset)) || 0, 0);
  // Filter kode: awalan dari kode yang sudah dinormalkan; `q` mencari di kode, nama berkas, catatan, pengunggah.
  const kode = f.kode?.trim() ? f.kode.trim().toUpperCase() : null;
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  try {
    const sql = db();
    const where = sql`WHERE (${kode}::text IS NULL OR kode_pengajuan LIKE ${(kode ?? "").replace(/[\\%_]/g, (m) => `\\${m}`) + "%"})
      AND (${q}::text IS NULL OR kode_pengajuan ILIKE ${q} OR nama_asli ILIKE ${q} OR catatan ILIKE ${q} OR diunggah_oleh ILIKE ${q})`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM bukti_pembayaran ${where}`;
    const rows = await sql`
      SELECT id::text AS id, kode_pengajuan, catatan, nama_asli, mime, ukuran, diunggah_oleh, diunggah_at::text AS diunggah_at
      FROM bukti_pembayaran ${where}
      ORDER BY diunggah_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;
    return { total: Number(n), items: rows.map(kolom) };
  } catch (e) {
    return petaGalat(e);
  }
}

export async function bacaBukti(id: string): Promise<{ buf: Buffer; nama: string; mime: string }> {
  const bid = Number(id);
  if (!Number.isInteger(bid) || bid <= 0) throw new BuktiError("bukti tidak ditemukan", 404);
  try {
    const [d] = await db()`SELECT nama_asli, nama_simpan, mime FROM bukti_pembayaran WHERE id = ${bid}`;
    if (!d) throw new BuktiError("bukti tidak ditemukan", 404);
    const abs = resolve(BUKTI_UPLOAD_ROOT, String(d.nama_simpan));
    const rel = relative(BUKTI_UPLOAD_ROOT, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new BuktiError("bukti tidak ditemukan", 404);
    try {
      return { buf: await readFile(abs), nama: String(d.nama_asli), mime: String(d.mime) };
    } catch {
      throw new BuktiError("berkas bukti hilang dari server", 404);
    }
  } catch (e) {
    return petaGalat(e);
  }
}
