// F130 Brosur Digital + Product Knowledge Library.
//
// Keputusan user 13 Okt 2026: brosur DIUNGGAH dari dashboard dan file-nya
// disimpan di GOOGLE DRIVE (Shared Drive, service account — ../gdrive.ts),
// dibuka "siapa pun dengan tautan" supaya AM bisa meneruskan tautannya ke
// customer. Langsung terbit, tanpa hashtag WA. Video training = tautan saja
// (YouTube/Drive), dicek apakah bisa dibuka tanpa login.

import { db } from "../db.js";
import { bukaUntukPublik, unggahKeDrive } from "../gdrive.js";

export class MateriError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const JENIS_MATERI = ["brosur", "video"] as const;
export const KATEGORI_MATERI = ["IVD", "Medical", "Aftersales", "Lainnya"] as const;
export type JenisMateri = (typeof JENIS_MATERI)[number];

/** Brosur: PDF atau gambar, maksimal 20 MB. */
export const MIME_BROSUR: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};
export const MAKS_BROSUR = 20 * 1024 * 1024;

export interface BerkasMasuk { isi: Buffer; nama: string; mime: string }

export interface MateriInput {
  jenis: JenisMateri;
  judul: string;
  brand: string | null;
  kategori: string | null;
  produk: string | null;
  url: string | null;  // video saja
  catatan: string | null;
}

const teks = (v: unknown, maks: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, maks) : null;
};

/** Murni: validasi + normalisasi isian. Lempar MateriError(400) bila tak sah. */
export function validasiMateri(b: Record<string, unknown>): MateriInput {
  const jenis = String(b.jenis ?? "brosur") as JenisMateri;
  if (!JENIS_MATERI.includes(jenis)) throw new MateriError(400, "jenis harus brosur atau video");
  const judul = teks(b.judul, 150);
  if (!judul) throw new MateriError(400, "judul wajib diisi");
  const kategori = teks(b.kategori, 20);
  if (kategori && !(KATEGORI_MATERI as readonly string[]).includes(kategori)) throw new MateriError(400, "kategori harus IVD / Medical / Aftersales / Lainnya");
  const brand = teks(b.brand, 80);
  const produk = teks(b.produk, 120);
  if (!brand && !produk) throw new MateriError(400, "isi brand atau nama produk supaya mudah dicari");
  let url: string | null = null;
  if (jenis === "video") {
    const raw = typeof b.url === "string" ? b.url.trim() : "";
    let u: URL;
    try { u = new URL(raw); } catch { throw new MateriError(400, "tautan video tidak sah — salin tautan lengkap dari YouTube/Drive"); }
    if (u.protocol !== "https:") throw new MateriError(400, "tautan video harus https://");
    url = u.toString();
  }
  return { jenis, judul, brand, kategori, produk, url, catatan: teks(b.catatan, 300) };
}

/** Murni: cek berkas brosur (tipe & ukuran). */
export function cekBerkas(f: BerkasMasuk): string {
  const ext = MIME_BROSUR[f.mime];
  if (!ext) throw new MateriError(400, "berkas brosur harus PDF, JPG, PNG, atau WEBP");
  if (f.isi.length === 0) throw new MateriError(400, "berkas kosong");
  if (f.isi.length > MAKS_BROSUR) throw new MateriError(400, "berkas brosur maksimal 20 MB");
  return ext;
}

/** Murni: nama file di Drive — judul dirapikan + ekstensi (mis. "Zybio Z3 - Brosur.pdf"). */
export function namaFileDrive(judul: string, ext: string): string {
  const dasar = judul.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Brosur";
  return `${dasar}.${ext}`;
}

/**
 * Murni: tafsir satu respons HTTP (tanpa mengikuti redirect) untuk cek akses publik
 * tautan video. true = bisa dibuka; false = minta login/akses; "ikuti" = redirect; null = tak pasti.
 */
export function nilaiAkses(status: number, location: string | null): boolean | "ikuti" | null {
  if (status >= 200 && status < 300) return true;
  if (status >= 300 && status < 400) {
    if (!location) return null;
    let host = "";
    try { host = new URL(location, "https://x.invalid").hostname; } catch { return null; }
    if (host === "accounts.google.com" || /ServiceLogin|signin/i.test(location)) return false;
    return "ikuti";
  }
  if (status === 401 || status === 403 || status === 404) return false;
  return null;
}

export async function cekAksesPublik(url: string): Promise<boolean | null> {
  let sekarang = url;
  for (let i = 0; i < 4; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(sekarang, { method: "GET", redirect: "manual", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (wrg-os link check)" } });
      const v = nilaiAkses(res.status, res.headers.get("location"));
      res.body?.cancel().catch(() => undefined);
      if (v !== "ikuti") return v;
      sekarang = new URL(res.headers.get("location") as string, sekarang).toString();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export interface MateriRow {
  id: string;
  kode: string;
  jenis: JenisMateri;
  judul: string;
  brand: string | null;
  kategori: string | null;
  produk: string | null;
  url: string;
  file_name: string | null;
  file_size: number | null;
  catatan: string | null;
  aktif: boolean;
  akses_publik: boolean | null;
  updated_by: string | null;
  updated_at: string;
}

type Sql = ReturnType<typeof db>;
const KOLOM = (sql: Sql) => sql`id::text, kode, jenis, judul, brand, kategori, produk, url, file_name, file_size, catatan, aktif, akses_publik, updated_by, updated_at::text`;

const keRow = (r: Record<string, unknown>): MateriRow => ({
  id: String(r.id), kode: String(r.kode), jenis: r.jenis as JenisMateri, judul: String(r.judul),
  brand: (r.brand as string) ?? null, kategori: (r.kategori as string) ?? null, produk: (r.produk as string) ?? null,
  url: String(r.url), file_name: (r.file_name as string) ?? null, file_size: r.file_size == null ? null : Number(r.file_size),
  catatan: (r.catatan as string) ?? null, aktif: Boolean(r.aktif),
  akses_publik: r.akses_publik == null ? null : Boolean(r.akses_publik),
  updated_by: (r.updated_by as string) ?? null, updated_at: String(r.updated_at),
});

export async function listMateri(opts: { termasukNonaktif?: boolean } = {}): Promise<MateriRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${KOLOM(sql)} FROM materi_produk
    WHERE ${opts.termasukNonaktif ? sql`true` : sql`aktif`}
    ORDER BY aktif DESC, upper(COALESCE(brand, '')), jenis, judul`;
  return rows.map(keRow);
}

const tolakDuplikat = (e: unknown): never => {
  if ((e as { code?: string }).code === "23505") throw new MateriError(400, "tautan ini sudah ada di katalog");
  throw e;
};

interface HasilFile { url: string; drive_file_id: string | null; file_name: string | null; file_mime: string | null; file_size: number | null; akses: boolean | null }

async function siapkanFile(v: MateriInput, berkas: BerkasMasuk | null, wajib: boolean): Promise<HasilFile | null> {
  if (v.jenis === "video") {
    return { url: v.url!, drive_file_id: null, file_name: null, file_mime: null, file_size: null, akses: await cekAksesPublik(v.url!) };
  }
  if (!berkas) {
    if (wajib) throw new MateriError(400, "unggah berkas brosur (PDF/JPG/PNG/WEBP)");
    return null;
  }
  const ext = cekBerkas(berkas);
  const nama = namaFileDrive(v.judul, ext);
  const up = await unggahKeDrive(berkas.isi, nama, berkas.mime);
  const akses = await bukaUntukPublik(up.id);
  return { url: up.webViewLink, drive_file_id: up.id, file_name: nama, file_mime: berkas.mime, file_size: berkas.isi.length, akses };
}

export async function buatMateri(body: Record<string, unknown>, berkas: BerkasMasuk | null, oleh: string | null): Promise<MateriRow> {
  const v = validasiMateri(body);
  const f = (await siapkanFile(v, berkas, true))!;
  const sql = db();
  const [r] = await sql`
    INSERT INTO materi_produk (jenis, judul, brand, kategori, produk, url, drive_file_id, file_name, file_mime, file_size,
                               catatan, akses_publik, dicek_at, created_by, updated_by)
    VALUES (${v.jenis}, ${v.judul}, norm_brand(${v.brand}), ${v.kategori}, ${v.produk}, ${f.url}, ${f.drive_file_id},
            ${f.file_name}, ${f.file_mime}, ${f.file_size}, ${v.catatan}, ${f.akses}, now(), ${oleh}, ${oleh})
    RETURNING ${KOLOM(sql)}`.catch(tolakDuplikat);
  return keRow(r);
}

export async function ubahMateri(idText: string, body: Record<string, unknown>, berkas: BerkasMasuk | null, oleh: string | null): Promise<MateriRow> {
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MateriError(400, "id tidak sah");
  const sql = db();
  const [lama] = await sql`SELECT jenis, drive_file_id, url FROM materi_produk WHERE id = ${id}`;
  if (!lama) throw new MateriError(404, "materi tak ditemukan");
  const kunci = Object.keys(body).filter((k) => k !== "oleh");

  // Aktif/nonaktif = PATCH sempit (file di Drive TIDAK dihapus).
  if (!berkas && kunci.length === 1 && (body.aktif === true || body.aktif === false || body.aktif === "true" || body.aktif === "false")) {
    const aktif = body.aktif === true || body.aktif === "true";
    const [r] = await sql`UPDATE materi_produk SET aktif = ${aktif}, updated_by = ${oleh}, updated_at = now()
                          WHERE id = ${id} RETURNING ${KOLOM(sql)}`.catch(tolakDuplikat);
    return keRow(r);
  }
  // Coba ulang buka-publik (brosur) / cek tautan (video).
  if (!berkas && kunci.length === 1 && (body.cek_ulang === true || body.cek_ulang === "true")) {
    const akses = lama.jenis === "brosur" && lama.drive_file_id
      ? await bukaUntukPublik(String(lama.drive_file_id))
      : await cekAksesPublik(String(lama.url));
    const [r] = await sql`UPDATE materi_produk SET akses_publik = ${akses}, dicek_at = now() WHERE id = ${id} RETURNING ${KOLOM(sql)}`;
    return keRow(r);
  }

  const v = validasiMateri({ ...body, jenis: lama.jenis });
  // Brosur tanpa berkas baru = hanya ubah keterangan; berkas baru = versi baru
  // di Drive (file lama dibiarkan di Drive sebagai arsip).
  const f = await siapkanFile(v, berkas, false);
  const [r] = await sql`
    UPDATE materi_produk SET judul = ${v.judul}, brand = norm_brand(${v.brand}), kategori = ${v.kategori},
           produk = ${v.produk}, catatan = ${v.catatan},
           ${f ? sql`url = ${f.url}, drive_file_id = ${f.drive_file_id}, file_name = ${f.file_name}, file_mime = ${f.file_mime},
                     file_size = ${f.file_size}, akses_publik = ${f.akses}, dicek_at = now(),` : sql``}
           updated_by = ${oleh}, updated_at = now()
    WHERE id = ${id} RETURNING ${KOLOM(sql)}`.catch(tolakDuplikat);
  return keRow(r);
}
