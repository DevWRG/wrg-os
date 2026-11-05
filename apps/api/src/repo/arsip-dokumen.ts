// F156 Arsip Dokumen Digital Terpusat (migrasi 279, issue #2027).
//
// Satu rumah untuk scan dokumen (bukti transaksi Accounting, SJ, BA, tanda terima,
// faktur pembelian, sertifikat, surat) + nomor ikut SOP Accounting
// BUKU/TAHUN/BULAN/URUT + telusur by nomor / faktur / SJ / PO / SN / bulan.
//
// Keputusan user 5 Nov 2026: berkas di Google Drive (folder GDRIVE_ARSIP_FOLDER_ID,
// PRIVAT, diunduh lewat API ini), tahap 1 tanpa menyedot dokumen modul lain, kode
// buku diatur admin lewat layar. Gerbang menu "/arsip-dokumen" + kode buku (admin)
// DIPERIKSA DI BFF; `oleh` selalu dari sesi.
//
// Nomor tak pernah dipakai ulang: hapus = soft delete, urut berikutnya dihitung dari
// SEMUA baris (termasuk terhapus) di bawah advisory lock per buku-bulan.

import { db } from "../db.js";
import { buangKeSampahDrive, DriveError, unduhDariDrive, unggahArsipKeDrive } from "../gdrive.js";
import { MAKS_DOKUMEN, namaAsliAman, tipeDariIsi } from "./kso-kontrak.js";

export class ArsipError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- murni (diuji)

const teks = (v: unknown, maks = 300): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, maks) : null;
};

/** BUKU/TAHUN/BULAN/URUT — mis. BKK/2026/11/0001 (format SOP Dokumentasi Softfile). */
export function formatNomor(kode: string, tahun: number, bulan: number, urut: number): string {
  return `${kode}/${tahun}/${String(bulan).padStart(2, "0")}/${String(urut).padStart(4, "0")}`;
}

export const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** Tanggal dokumen YYYY-MM-DD yang sah (kalender nyata, 2000 s/d hari ini WIB) → {tahun, bulan}; selain itu null. */
export function periodeDari(tgl: unknown, hariIni = hariIniWib()): { tanggal: string; tahun: number; bulan: number } | null {
  if (typeof tgl !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return null;
  const [t, b, h] = tgl.split("-").map(Number);
  const d = new Date(Date.UTC(t, b - 1, h));
  if (d.getUTCFullYear() !== t || d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) return null;
  if (t < 2000 || tgl > hariIni) return null;
  return { tanggal: tgl, tahun: t, bulan: b };
}

export const KODE_BUKU = /^[A-Z][A-Z0-9]{1,9}$/;

export interface MetaArsip {
  judul: string; akun: string | null; lokasi_fisik: string | null; keterangan: string | null;
  ref_faktur: string | null; ref_sj: string | null; ref_po: string | null; ref_sn: string | null;
}

/** Isian metadata dari body (unggah & ubah). Judul wajib. */
export function metaDari(b: Record<string, unknown>): MetaArsip {
  const judul = teks(b.judul, 200);
  if (!judul) throw new ArsipError(400, "judul dokumen wajib diisi", "judul");
  return {
    judul, akun: teks(b.akun, 120), lokasi_fisik: teks(b.lokasi_fisik, 120), keterangan: teks(b.keterangan, 1000),
    ref_faktur: teks(b.ref_faktur, 80), ref_sj: teks(b.ref_sj, 80), ref_po: teks(b.ref_po, 80), ref_sn: teks(b.ref_sn, 80),
  };
}

/** Validasi berkas murni → pesan tolak atau null. Tipe dari ISI berkas, bukan label browser. */
export function alasanTolakBerkas(ukuran: number, buf: Uint8Array): string | null {
  if (ukuran <= 0) return "berkas kosong";
  if (ukuran > MAKS_DOKUMEN) return "berkas maksimal 8 MB";
  if (!tipeDariIsi(buf)) return "hanya PDF, JPG, atau PNG";
  return null;
}

/** "2026-11" → {tahun, bulan}; selain itu null. */
export function periodeFilter(v: unknown): { tahun: number; bulan: number } | null {
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return null;
  const [t, b] = v.split("-").map(Number);
  return { tahun: t, bulan: b };
}

// ---------------------------------------------------------------- kode buku

export interface Buku { kode: string; nama: string; keterangan: string | null; aktif: boolean; dipakai: number }

export async function listBuku(): Promise<Buku[]> {
  const rows = await db()`
    SELECT b.kode, b.nama, b.keterangan, b.aktif, count(d.id)::int AS dipakai
      FROM arsip_buku b LEFT JOIN arsip_dokumen d ON d.buku_kode = b.kode AND d.dihapus_at IS NULL
     GROUP BY b.kode ORDER BY b.aktif DESC, b.kode`;
  return rows.map((r) => ({ kode: String(r.kode), nama: String(r.nama), keterangan: r.keterangan ? String(r.keterangan) : null, aktif: Boolean(r.aktif), dipakai: Number(r.dipakai) }));
}

/** Tambah kode buku baru, atau ubah nama/keterangan/aktif kode yang ada (kode sendiri tak bisa diganti). */
export async function simpanBuku(b: Record<string, unknown>, oleh: string | null): Promise<Buku[]> {
  const kode = typeof b.kode === "string" ? b.kode.trim().toUpperCase() : "";
  if (!KODE_BUKU.test(kode)) throw new ArsipError(400, "kode buku 2–10 huruf besar/angka, diawali huruf (mis. BKK)", "kode");
  const nama = teks(b.nama, 80);
  if (!nama) throw new ArsipError(400, "nama buku wajib diisi", "nama");
  const ket = teks(b.keterangan, 200);
  const aktif = b.aktif === undefined ? true : Boolean(b.aktif);
  await db()`
    INSERT INTO arsip_buku (kode, nama, keterangan, aktif, diubah_oleh, diubah_at)
    VALUES (${kode}, ${nama}, ${ket}, ${aktif}, ${oleh}, now())
    ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, keterangan = EXCLUDED.keterangan, aktif = EXCLUDED.aktif,
      diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now()`;
  return listBuku();
}

// ---------------------------------------------------------------- dokumen

export interface Arsip extends MetaArsip {
  id: number; nomor: string; buku_kode: string; buku_nama: string; tanggal_dokumen: string;
  nama_asli: string; mime: string; ukuran: number; diunggah_oleh: string | null; diunggah_at: string;
  diubah_oleh: string | null; diubah_at: string | null;
}

const KOLOM = (sql: ReturnType<typeof db>) => sql`
  d.id::int, d.nomor, d.buku_kode, b.nama AS buku_nama, d.tanggal_dokumen::text, d.judul, d.akun, d.lokasi_fisik, d.keterangan,
  d.ref_faktur, d.ref_sj, d.ref_po, d.ref_sn, d.nama_asli, d.mime, d.ukuran, d.diunggah_oleh, d.diunggah_at::text,
  d.diubah_oleh, d.diubah_at::text`;

export interface FilterArsip { q?: string | null; buku?: string | null; periode?: string | null; limit?: number; offset?: number }

export async function listArsip(f: FilterArsip) {
  const sql = db();
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const q = teks(f.q, 100);
  const buku = typeof f.buku === "string" && KODE_BUKU.test(f.buku) ? f.buku : null;
  const p = periodeFilter(f.periode);
  const pola = "%" + (q ?? "").replace(/[\\%_]/g, (c) => "\\" + c) + "%"; // % dan _ ketikan = huruf, bukan wildcard
  const where = sql`
    WHERE d.dihapus_at IS NULL
      AND (${q}::text IS NULL OR d.nomor ILIKE ${pola} OR d.judul ILIKE ${pola} OR d.ref_faktur ILIKE ${pola}
           OR d.ref_sj ILIKE ${pola} OR d.ref_po ILIKE ${pola} OR d.ref_sn ILIKE ${pola} OR d.akun ILIKE ${pola}
           OR d.lokasi_fisik ILIKE ${pola} OR d.keterangan ILIKE ${pola} OR d.nama_asli ILIKE ${pola})
      AND (${buku}::text IS NULL OR d.buku_kode = ${buku})
      AND (${p?.tahun ?? null}::int IS NULL OR (d.tahun = ${p?.tahun ?? null} AND d.bulan = ${p?.bulan ?? null}))`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM arsip_dokumen d ${where}`;
  const items = await sql`
    SELECT ${KOLOM(sql)} FROM arsip_dokumen d JOIN arsip_buku b ON b.kode = d.buku_kode
    ${where} ORDER BY d.tanggal_dokumen DESC, d.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return { count: items.length, total_rows: Number(n), limit, offset, items: items as unknown as Arsip[] };
}

async function satu(id: number): Promise<Arsip> {
  const sql = db();
  const [r] = await sql`SELECT ${KOLOM(sql)} FROM arsip_dokumen d JOIN arsip_buku b ON b.kode = d.buku_kode WHERE d.id = ${id} AND d.dihapus_at IS NULL`;
  if (!r) throw new ArsipError(404, "dokumen arsip tidak ditemukan");
  return r as unknown as Arsip;
}

const idDari = (v: string): number => {
  if (!/^\d{1,12}$/.test(v)) throw new ArsipError(400, "id tidak valid");
  return Number(v);
};

/** Unggah: validasi → kunci buku-bulan → nomor → unggah Drive → simpan. Gagal simpan = berkas Drive dibuang ke sampah. */
export async function unggahArsip(b: Record<string, unknown>, file: { nama: string; buf: Uint8Array }, oleh: string | null): Promise<Arsip> {
  const meta = metaDari(b);
  const kode = typeof b.buku_kode === "string" ? b.buku_kode.trim().toUpperCase() : "";
  if (!KODE_BUKU.test(kode)) throw new ArsipError(400, "pilih kode buku", "buku_kode");
  const per = periodeDari(b.tanggal_dokumen);
  if (!per) throw new ArsipError(400, "tanggal dokumen tidak sah (format YYYY-MM-DD, tidak boleh di masa depan)", "tanggal_dokumen");
  const tolak = alasanTolakBerkas(file.buf.length, file.buf);
  if (tolak) throw new ArsipError(400, tolak, "file");
  const mime = tipeDariIsi(file.buf)!;
  const namaAsli = namaAsliAman(file.nama);

  const sql = db();
  let driveId: string | null = null;
  try {
    const id = await sql.begin(async (tx) => {
      const [bk] = await tx`SELECT aktif FROM arsip_buku WHERE kode = ${kode}`;
      if (!bk) throw new ArsipError(400, `kode buku ${kode} tidak dikenal`, "buku_kode");
      if (!bk.aktif) throw new ArsipError(400, `kode buku ${kode} sudah nonaktif`, "buku_kode");
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`arsip:${kode}:${per.tahun}:${per.bulan}`}))`;
      const [{ urut }] = await tx`
        SELECT COALESCE(max(urut), 0)::int + 1 AS urut FROM arsip_dokumen
         WHERE buku_kode = ${kode} AND tahun = ${per.tahun} AND bulan = ${per.bulan}`;
      const nomor = formatNomor(kode, per.tahun, per.bulan, Number(urut));
      // Nama di Drive diawali nomor (garis miring → titik) supaya berurutan bila dibuka langsung di Drive.
      const up = await unggahArsipKeDrive(Buffer.from(file.buf), `${nomor.replace(/\//g, ".")} - ${namaAsli}`, mime);
      driveId = up.id;
      const [r] = await tx`
        INSERT INTO arsip_dokumen (nomor, buku_kode, tahun, bulan, urut, tanggal_dokumen, judul, akun, lokasi_fisik,
          ref_faktur, ref_sj, ref_po, ref_sn, keterangan, drive_file_id, nama_asli, mime, ukuran, diunggah_oleh)
        VALUES (${nomor}, ${kode}, ${per.tahun}, ${per.bulan}, ${Number(urut)}, ${per.tanggal}, ${meta.judul}, ${meta.akun},
          ${meta.lokasi_fisik}, ${meta.ref_faktur}, ${meta.ref_sj}, ${meta.ref_po}, ${meta.ref_sn}, ${meta.keterangan},
          ${up.id}, ${namaAsli}, ${mime}, ${file.buf.length}, ${oleh})
        RETURNING id::int`;
      return Number(r.id);
    });
    return satu(id);
  } catch (e) {
    if (driveId) await buangKeSampahDrive(driveId).catch(() => undefined);
    if (e instanceof DriveError) throw new ArsipError(e.status, e.message);
    throw e;
  }
}

/** Ubah metadata saja — buku, tanggal, nomor, dan berkas melekat (nomor tak pernah berubah). */
export async function ubahArsip(idStr: string, b: Record<string, unknown>, oleh: string | null): Promise<Arsip> {
  const id = idDari(idStr);
  const m = metaDari(b);
  const r = await db()`
    UPDATE arsip_dokumen SET judul = ${m.judul}, akun = ${m.akun}, lokasi_fisik = ${m.lokasi_fisik}, keterangan = ${m.keterangan},
      ref_faktur = ${m.ref_faktur}, ref_sj = ${m.ref_sj}, ref_po = ${m.ref_po}, ref_sn = ${m.ref_sn},
      diubah_oleh = ${oleh}, diubah_at = now()
    WHERE id = ${id} AND dihapus_at IS NULL RETURNING id`;
  if (!r.length) throw new ArsipError(404, "dokumen arsip tidak ditemukan");
  return satu(id);
}

/** Hapus = tandai terhapus (nomor tetap terpakai, berkas Drive dibiarkan untuk jejak audit). */
export async function hapusArsip(idStr: string, oleh: string | null): Promise<{ ok: true; nomor: string }> {
  const id = idDari(idStr);
  const [r] = await db()`
    UPDATE arsip_dokumen SET dihapus_at = now(), dihapus_oleh = ${oleh}
    WHERE id = ${id} AND dihapus_at IS NULL RETURNING nomor`;
  if (!r) throw new ArsipError(404, "dokumen arsip tidak ditemukan");
  return { ok: true, nomor: String(r.nomor) };
}

export async function bacaBerkasArsip(idStr: string): Promise<{ nama: string; mime: string; buf: Buffer }> {
  const id = idDari(idStr);
  const [r] = await db()`SELECT nomor, nama_asli, mime, drive_file_id FROM arsip_dokumen WHERE id = ${id} AND dihapus_at IS NULL`;
  if (!r) throw new ArsipError(404, "dokumen arsip tidak ditemukan");
  try {
    const buf = await unduhDariDrive(String(r.drive_file_id));
    return { nama: `${String(r.nomor).replace(/\//g, ".")} - ${String(r.nama_asli)}`, mime: String(r.mime), buf };
  } catch (e) {
    if (e instanceof DriveError) throw new ArsipError(e.status, e.message);
    throw e;
  }
}
