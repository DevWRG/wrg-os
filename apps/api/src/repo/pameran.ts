// F173 Pameran — Registrasi Pengunjung & Kupon Undian (migrasi 259).
//
// Kebutuhan divisi Medical & Hemodialisa (30 Okt 2026): di booth pameran, dokter/visitor
// mengisi nama, asal institusi, no. HP SENDIRI dari HP lewat QR → halaman publik
// /daftar/<slug> (tanpa login). Sukses → kode kupon undian doorprize tampil di layar,
// tidak dikirim WA. Satu no. HP = satu kupon per pameran; daftar ulang dengan nomor yang
// sama mengembalikan kupon lama (pengunjung sering kehilangan tangkapan layar).
//
// Jalur publik hanya dua fungsi: infoPublik + daftarPublik. Sisanya untuk menu Pameran
// (gerbang menu & aksi di BFF; `oleh` selalu dari sesi). Pengunjung TIDAK otomatis jadi
// deal — AM/HoD menekan "jadikan deal" untuk yang serius (keputusan user).

import { randomInt } from "node:crypto";

import { db } from "../db.js";
import type { DataScope } from "./access-scope.js";
import { createDeal } from "./deal.js";

export class PameranError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const DIVISI = ["medical_hd", "ivd"] as const;
export type Divisi = (typeof DIVISI)[number];
const PROSES = "proses"; // penanda klaim sementara di deal_id selama createDeal berjalan
const KATEGORI_DEAL: Record<Divisi, "Medical" | "IVD"> = { medical_hd: "Medical", ivd: "IVD" };

// ---------------------------------------------------------------- murni (diuji)

const teks = (v: unknown, maks = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, maks) : null;
};
const tanggal = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** No. HP Indonesia → bentuk 628…; bukan nomor seluler = null.
 * Terima "0812-3456-789", "+62 812 3456 789", "812345678", "62812…". */
export function normalHp(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  let d = String(v).replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^628\d{7,12}$/.test(d) ? d : null;
}

/** Tampilan no. HP untuk staf: 0812-3456-7890. */
export function hpTampil(hp: string): string {
  const lokal = "0" + hp.slice(2);
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

// Tanpa 0/O/1/I/L — kupon dibacakan keras saat undian & dicocokkan dengan mata.
export const HURUF_KUPON = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function buatKupon(prefix: string, acak: (n: number) => number = randomInt): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += HURUF_KUPON[acak(HURUF_KUPON.length)];
  return `${prefix}-${s}`;
}

export interface IsianDaftar { nama: string; institusi: string; kab_kota_kode: string; no_hp: string }
export function validasiDaftar(b: Record<string, unknown>): { ok: true; isi: IsianDaftar } | { ok: false; pesan: string } {
  const nama = teks(b.nama, 120);
  if (!nama) return { ok: false, pesan: "Nama wajib diisi." };
  const institusi = teks(b.institusi, 160);
  if (!institusi) return { ok: false, pesan: "Asal institusi wajib diisi." };
  // Kode Kemendagri 'PP.KK' dari dropdown; keberadaannya dicek ke wilayah_kab_kota di DB.
  const kab = typeof b.kab_kota_kode === "string" && /^\d{2}\.\d{2}$/.test(b.kab_kota_kode) ? b.kab_kota_kode : null;
  if (!kab) return { ok: false, pesan: "Pilih kota/kabupaten asal dari daftar." };
  const hp = normalHp(b.no_hp);
  if (!hp) return { ok: false, pesan: "No. HP tidak valid. Contoh: 081234567890." };
  return { ok: true, isi: { nama, institusi, kab_kota_kode: kab, no_hp: hp } };
}

/** Slug dari nama acara: "Pernefri 2026 — Bali" → "pernefri-2026-bali". */
export function slugDari(nama: string): string {
  return nama.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

export interface IsianAcara {
  nama: string; slug: string; divisi: Divisi; lokasi: string | null;
  tanggal_mulai: string; tanggal_selesai: string; prefix_kupon: string; buka: boolean; jatah_ip: number;
}
export const JATAH_IP_DEFAULT = 600;
export function validasiAcara(b: Record<string, unknown>): { ok: true; isi: IsianAcara } | { ok: false; pesan: string } {
  const nama = teks(b.nama, 160);
  if (!nama) return { ok: false, pesan: "Nama pameran wajib diisi." };
  const divisi = (DIVISI as readonly string[]).includes(String(b.divisi)) ? (b.divisi as Divisi) : null;
  if (!divisi) return { ok: false, pesan: "Pilih divisi." };
  const mulai = tanggal(b.tanggal_mulai);
  const selesai = tanggal(b.tanggal_selesai) ?? mulai;
  if (!mulai || !selesai) return { ok: false, pesan: "Tanggal pameran wajib diisi." };
  if (selesai < mulai) return { ok: false, pesan: "Tanggal selesai tidak boleh sebelum tanggal mulai." };
  const slug = teks(b.slug, 60)?.toLowerCase() ?? slugDari(nama);
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) return { ok: false, pesan: "Alamat form hanya huruf kecil, angka, dan tanda minus (3–60 karakter)." };
  const prefix = (teks(b.prefix_kupon, 5) ?? (divisi === "ivd" ? "IVD" : "MHD")).toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(prefix)) return { ok: false, pesan: "Awalan kupon 2–5 huruf." };
  const jatah = b.jatah_ip == null || b.jatah_ip === "" ? JATAH_IP_DEFAULT : Number(b.jatah_ip);
  if (!Number.isInteger(jatah) || jatah < 10 || jatah > 100_000) return { ok: false, pesan: "Jatah per IP harus bilangan bulat 10–100.000." };
  return {
    ok: true,
    isi: { nama, slug, divisi, lokasi: teks(b.lokasi, 160), tanggal_mulai: mulai, tanggal_selesai: selesai, prefix_kupon: prefix, buka: b.buka !== false, jatah_ip: jatah },
  };
}

/** Form publik menerima pendaftaran? Diberi kelonggaran 1 hari di kedua sisi (persiapan
 * booth H-1 & pengunjung yang baru sempat mengisi malam sesudahnya). */
export function sedangBuka(a: { buka: boolean; tanggal_mulai: string; tanggal_selesai: string }, hariIni: string): boolean {
  if (!a.buka) return false;
  const geser = (t: string, n: number) => {
    const d = new Date(`${t}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return hariIni >= geser(a.tanggal_mulai, -1) && hariIni <= geser(a.tanggal_selesai, 1);
}

/** Pilih n indeks acak tanpa pengulangan (Fisher–Yates parsial, crypto). */
export function kocok<T>(calon: readonly T[], n: number, acak: (n: number) => number = randomInt): T[] {
  const a = [...calon];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + acak(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// ---------------------------------------------------------------- DB

const HARI_INI = "(now() at time zone 'Asia/Jakarta')::date";

interface BarisAcara {
  id: number; slug: string; nama: string; divisi: Divisi; lokasi: string | null;
  tanggal_mulai: string; tanggal_selesai: string; prefix_kupon: string; buka: boolean; jatah_ip: number;
}
const kolomAcara = (r: Record<string, unknown>): BarisAcara => ({
  id: Number(r.id), slug: String(r.slug), nama: String(r.nama), divisi: r.divisi as Divisi,
  lokasi: r.lokasi == null ? null : String(r.lokasi), tanggal_mulai: String(r.tanggal_mulai),
  tanggal_selesai: String(r.tanggal_selesai), prefix_kupon: String(r.prefix_kupon), buka: Boolean(r.buka),
  jatah_ip: Number(r.jatah_ip ?? JATAH_IP_DEFAULT),
});

async function hariIniWib(): Promise<string> {
  const [r] = await db().unsafe(`select to_char(${HARI_INI}, 'YYYY-MM-DD') as d`);
  return String(r.d);
}

async function acaraDariSlug(slug: string): Promise<BarisAcara> {
  const rows = await db()`
    select id, slug, nama, divisi, lokasi, to_char(tanggal_mulai,'YYYY-MM-DD') tanggal_mulai,
           to_char(tanggal_selesai,'YYYY-MM-DD') tanggal_selesai, prefix_kupon, buka, jatah_ip
    from pameran where slug = ${slug}`;
  if (!rows.length) throw new PameranError(404, "Pameran tidak ditemukan.");
  return kolomAcara(rows[0]);
}

// ---- publik

export async function infoPublik(slug: string) {
  const a = await acaraDariSlug(slug);
  return { nama: a.nama, lokasi: a.lokasi, tanggal_mulai: a.tanggal_mulai, tanggal_selesai: a.tanggal_selesai, buka: sedangBuka(a, await hariIniWib()) };
}

/** bolehKirim(kunci, jatah) = penjaga jatah per IP milik pemanggil (in-memory di apps/api). */
export async function daftarPublik(
  slug: string, b: Record<string, unknown>, jejak: { ip: string | null; ua: string | null },
  bolehKirim: (kunci: string, jatah: number) => boolean = () => true,
) {
  const a = await acaraDariSlug(slug);
  if (!sedangBuka(a, await hariIniWib())) throw new PameranError(409, "Pendaftaran pameran ini sudah ditutup.");
  if (!bolehKirim(`${a.id}:${jejak.ip ?? "?"}`, a.jatah_ip)) {
    throw new PameranError(429, "Terlalu banyak pendaftaran dari jaringan ini. Coba lagi beberapa menit lagi atau pakai data seluler.");
  }
  const v = validasiDaftar(b);
  if (!v.ok) throw new PameranError(400, v.pesan);
  const sql = db();
  const kab = await sql`select 1 from wilayah_kab_kota where kode = ${v.isi.kab_kota_kode}`;
  if (!kab.length) throw new PameranError(400, "Pilih kota/kabupaten asal dari daftar.");
  const lama = await sql`select kode_kupon from pameran_pengunjung where pameran_id = ${a.id} and no_hp = ${v.isi.no_hp}`;
  if (lama.length) return { kode_kupon: String(lama[0].kode_kupon), sudah_terdaftar: true, pameran: a.nama };
  // Bentrok kode (31^5 ≈ 28 juta) praktis mustahil, tapi tetap diulang; bentrok no. HP
  // (dua kiriman serentak) → kembalikan kupon pemenang balapan.
  for (let i = 0; i < 5; i++) {
    const kode = buatKupon(a.prefix_kupon);
    const rows = await sql`
      insert into pameran_pengunjung (pameran_id, nama, institusi, kab_kota_kode, no_hp, kode_kupon, ip, user_agent)
      values (${a.id}, ${v.isi.nama}, ${v.isi.institusi}, ${v.isi.kab_kota_kode}, ${v.isi.no_hp}, ${kode}, ${jejak.ip}, ${jejak.ua?.slice(0, 300) ?? null})
      on conflict do nothing
      returning kode_kupon`;
    if (rows.length) return { kode_kupon: String(rows[0].kode_kupon), sudah_terdaftar: false, pameran: a.nama };
    const ada = await sql`select kode_kupon from pameran_pengunjung where pameran_id = ${a.id} and no_hp = ${v.isi.no_hp}`;
    if (ada.length) return { kode_kupon: String(ada[0].kode_kupon), sudah_terdaftar: true, pameran: a.nama };
  }
  throw new PameranError(500, "Gagal membuat kupon, coba lagi.");
}

/** Daftar 514 kab/kota untuk dropdown form publik (migrasi 260). */
export async function listKabKota() {
  const rows = await db()`select kode, nama, provinsi from wilayah_kab_kota order by kode`;
  return { items: rows.map((r) => ({ kode: String(r.kode), nama: String(r.nama), provinsi: String(r.provinsi) })) };
}

// ---- menu Pameran

export async function listAcara() {
  const rows = await db()`
    select p.id, p.slug, p.nama, p.divisi, p.lokasi, to_char(p.tanggal_mulai,'YYYY-MM-DD') tanggal_mulai,
           to_char(p.tanggal_selesai,'YYYY-MM-DD') tanggal_selesai, p.prefix_kupon, p.buka, p.jatah_ip, p.dibuat_oleh,
           (select count(*) from pameran_pengunjung v where v.pameran_id = p.id)::int as jumlah_pengunjung,
           (select count(*) from pameran_undian u where u.pameran_id = p.id and u.status = 'menang')::int as jumlah_pemenang
    from pameran p order by p.tanggal_mulai desc, p.id desc`;
  const hari = await hariIniWib();
  return {
    items: rows.map((r) => {
      const a = kolomAcara(r);
      return { ...a, dibuat_oleh: String(r.dibuat_oleh), jumlah_pengunjung: Number(r.jumlah_pengunjung), jumlah_pemenang: Number(r.jumlah_pemenang), menerima: sedangBuka(a, hari) };
    }),
  };
}

const slugDipakai = (e: unknown) => (e as { code?: string; constraint_name?: string }).code === "23505";

export async function buatAcara(b: Record<string, unknown>, oleh: string) {
  const v = validasiAcara(b);
  if (!v.ok) throw new PameranError(400, v.pesan);
  const i = v.isi;
  try {
    const [r] = await db()`
      insert into pameran (slug, nama, divisi, lokasi, tanggal_mulai, tanggal_selesai, prefix_kupon, buka, jatah_ip, dibuat_oleh)
      values (${i.slug}, ${i.nama}, ${i.divisi}, ${i.lokasi}, ${i.tanggal_mulai}, ${i.tanggal_selesai}, ${i.prefix_kupon}, ${i.buka}, ${i.jatah_ip}, ${oleh})
      returning id`;
    return { id: Number(r.id), slug: i.slug };
  } catch (e) {
    if (slugDipakai(e)) throw new PameranError(409, `Alamat form "${i.slug}" sudah dipakai pameran lain.`);
    throw e;
  }
}

export async function ubahAcara(id: number, b: Record<string, unknown>) {
  const sql = db();
  const cur = await sql`select slug, nama, divisi, lokasi, to_char(tanggal_mulai,'YYYY-MM-DD') tanggal_mulai,
    to_char(tanggal_selesai,'YYYY-MM-DD') tanggal_selesai, prefix_kupon, buka, jatah_ip from pameran where id = ${id}`;
  if (!cur.length) throw new PameranError(404, "Pameran tidak ditemukan.");
  const v = validasiAcara({ ...cur[0], ...b });
  if (!v.ok) throw new PameranError(400, v.pesan);
  const i = v.isi;
  try {
    await sql`update pameran set slug = ${i.slug}, nama = ${i.nama}, divisi = ${i.divisi}, lokasi = ${i.lokasi},
      tanggal_mulai = ${i.tanggal_mulai}, tanggal_selesai = ${i.tanggal_selesai}, prefix_kupon = ${i.prefix_kupon}, jatah_ip = ${i.jatah_ip},
      buka = ${i.buka}, diubah_at = now() where id = ${id}`;
  } catch (e) {
    if (slugDipakai(e)) throw new PameranError(409, `Alamat form "${i.slug}" sudah dipakai pameran lain.`);
    throw e;
  }
  return { id, slug: i.slug };
}

export async function listPengunjung(pameranId: number, o: { q?: string; limit?: number; offset?: number; semua?: boolean }) {
  const sql = db();
  const limit = o.semua ? 50_000 : Math.min(Math.max(1, o.limit ?? 50), 200);
  const offset = o.semua ? 0 : Math.max(0, o.offset ?? 0);
  const q = o.q?.trim() ? `%${o.q.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%` : null;
  const qHp = o.q?.replace(/\D/g, "") ?? "";
  const saring = q
    ? sql`and (v.nama ilike ${q} or v.institusi ilike ${q} or w.nama ilike ${q} or v.kode_kupon ilike ${q} ${qHp.length >= 4 ? sql`or v.no_hp like ${"%" + qHp.replace(/^0/, "") + "%"}` : sql``})`
    : sql``;
  const [n] = await sql`select count(*)::int n from pameran_pengunjung v left join wilayah_kab_kota w on w.kode = v.kab_kota_kode
    where v.pameran_id = ${pameranId} ${saring}`;
  const rows = await sql`
    select v.id, v.nama, v.institusi, w.nama as kab_kota, w.provinsi, v.no_hp, v.kode_kupon, v.daftar_at, v.deal_id, u.hadiah, u.status as status_undian
    from pameran_pengunjung v left join pameran_undian u on u.pengunjung_id = v.id
    left join wilayah_kab_kota w on w.kode = v.kab_kota_kode
    where v.pameran_id = ${pameranId} ${saring}
    order by v.daftar_at desc, v.id desc limit ${limit} offset ${offset}`;
  const items = rows.map((r) => ({
    id: Number(r.id), nama: String(r.nama), institusi: String(r.institusi),
    kab_kota: r.kab_kota == null ? null : String(r.kab_kota), provinsi: r.provinsi == null ? null : String(r.provinsi),
    no_hp: hpTampil(String(r.no_hp)), kode_kupon: String(r.kode_kupon), daftar_at: new Date(r.daftar_at as string).toISOString(),
    deal_id: r.deal_id == null ? null : String(r.deal_id), hadiah: r.hadiah == null ? null : String(r.hadiah),
    status_undian: r.status_undian == null ? null : String(r.status_undian),
  }));
  return { items, count: items.length, total_rows: Number(n.n), limit, offset };
}

export async function hapusPengunjung(id: number) {
  const sql = db();
  const cur = await sql`select v.deal_id, u.id as undian from pameran_pengunjung v left join pameran_undian u on u.pengunjung_id = v.id where v.id = ${id}`;
  if (!cur.length) throw new PameranError(404, "Pengunjung tidak ditemukan.");
  if (cur[0].undian != null) throw new PameranError(409, "Pengunjung ini sudah ikut hasil undian — tandai hangus, jangan dihapus.");
  if (cur[0].deal_id != null) throw new PameranError(409, "Pengunjung ini sudah dijadikan deal.");
  await sql`delete from pameran_pengunjung where id = ${id}`;
  return { ok: true };
}

export async function listUndian(pameranId: number) {
  const rows = await db()`
    select u.id, u.hadiah, u.status, u.diundi_oleh, u.diundi_at, v.nama, v.institusi, v.no_hp, v.kode_kupon
    from pameran_undian u join pameran_pengunjung v on v.id = u.pengunjung_id
    where u.pameran_id = ${pameranId} order by u.diundi_at, u.id`;
  const [n] = await db()`
    select count(*)::int n from pameran_pengunjung v
    where v.pameran_id = ${pameranId} and not exists (select 1 from pameran_undian u where u.pengunjung_id = v.id)`;
  // Bahan animasi spinner undian (TAMPILAN saja — pemenang tetap dipilih kocokPemenang di
  // server): sampel acak kupon peserta yang belum menang, cukup untuk kelihatan berputar.
  const sampel = await db()`
    select v.kode_kupon, v.nama from pameran_pengunjung v
    where v.pameran_id = ${pameranId} and not exists (select 1 from pameran_undian u where u.pengunjung_id = v.id)
    order by random() limit 120`;
  return {
    items: rows.map((r) => ({
      id: Number(r.id), hadiah: String(r.hadiah), status: String(r.status), diundi_oleh: String(r.diundi_oleh),
      diundi_at: new Date(r.diundi_at as string).toISOString(), nama: String(r.nama), institusi: String(r.institusi),
      no_hp: hpTampil(String(r.no_hp)), kode_kupon: String(r.kode_kupon),
    })),
    sisa_peserta: Number(n.n),
    sampel: sampel.map((r) => ({ kode_kupon: String(r.kode_kupon), nama: String(r.nama) })),
  };
}

/** Ringkasan untuk layar panggung (dipoll tiap beberapa detik). */
export async function ringkasLayar(pameranId: number) {
  const rows = await db()`
    select p.slug, p.nama, p.lokasi, p.buka, to_char(p.tanggal_mulai,'YYYY-MM-DD') tanggal_mulai,
           to_char(p.tanggal_selesai,'YYYY-MM-DD') tanggal_selesai,
           (select count(*) from pameran_pengunjung v where v.pameran_id = p.id)::int as jumlah
    from pameran p where p.id = ${pameranId}`;
  if (!rows.length) throw new PameranError(404, "Pameran tidak ditemukan.");
  const r = rows[0];
  const a = { buka: Boolean(r.buka), tanggal_mulai: String(r.tanggal_mulai), tanggal_selesai: String(r.tanggal_selesai) };
  return { slug: String(r.slug), nama: String(r.nama), lokasi: r.lokasi == null ? null : String(r.lokasi), jumlah: Number(r.jumlah), menerima: sedangBuka(a, await hariIniWib()) };
}

/** Kocok pemenang. Dikunci per pameran (advisory lock transaksi) supaya dua staf yang
 * menekan tombol bersamaan tak memenangkan orang yang sama dua kali. */
export async function kocokPemenang(pameranId: number, b: Record<string, unknown>, oleh: string) {
  const hadiah = teks(b.hadiah, 120);
  if (!hadiah) throw new PameranError(400, "Nama hadiah wajib diisi.");
  const jumlah = Number(b.jumlah ?? 1);
  if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > 50) throw new PameranError(400, "Jumlah pemenang 1–50.");
  return db().begin(async (tx) => {
    const ada = await tx`select 1 from pameran where id = ${pameranId}`;
    if (!ada.length) throw new PameranError(404, "Pameran tidak ditemukan.");
    await tx`select pg_advisory_xact_lock(259, ${pameranId}::int)`;
    const calon = await tx`
      select v.id from pameran_pengunjung v
      where v.pameran_id = ${pameranId} and not exists (select 1 from pameran_undian u where u.pengunjung_id = v.id)`;
    if (!calon.length) throw new PameranError(409, "Tidak ada peserta tersisa untuk diundi.");
    const terpilih = kocok(calon.map((r) => Number(r.id)), jumlah);
    for (const pid of terpilih) {
      await tx`insert into pameran_undian (pameran_id, pengunjung_id, hadiah, diundi_oleh) values (${pameranId}, ${pid}, ${hadiah}, ${oleh})`;
    }
    const rows = await tx`select id, nama, institusi, kode_kupon from pameran_pengunjung where id in ${tx(terpilih)}`;
    const urut = new Map(terpilih.map((id, i) => [id, i]));
    return {
      hadiah,
      pemenang: rows
        .map((r) => ({ id: Number(r.id), nama: String(r.nama), institusi: String(r.institusi), kode_kupon: String(r.kode_kupon) }))
        .sort((x, y) => (urut.get(x.id) ?? 0) - (urut.get(y.id) ?? 0)),
    };
  });
}

export async function ubahStatusUndian(id: number, b: Record<string, unknown>) {
  const status = b.status === "hangus" || b.status === "menang" ? b.status : null;
  if (!status) throw new PameranError(400, "Status harus menang atau hangus.");
  const rows = await db()`update pameran_undian set status = ${status} where id = ${id} returning id`;
  if (!rows.length) throw new PameranError(404, "Data undian tidak ditemukan.");
  return { id, status };
}

/** Jadikan deal Prospecting sumber 'pameran'. Kategori ikut divisi pameran; AM sesuai
 * scope pemanggil (AM → dirinya sendiri, HoD/admin bisa menunjuk lewat am_id). */
export async function jadikanDeal(pengunjungId: number, scope: DataScope, b: Record<string, unknown>) {
  const sql = db();
  const rows = await sql`
    select v.id, v.nama, v.institusi, v.no_hp, v.kode_kupon, v.deal_id, p.nama as pameran, p.divisi, w.nama as kab_kota, w.provinsi
    from pameran_pengunjung v join pameran p on p.id = v.pameran_id
    left join wilayah_kab_kota w on w.kode = v.kab_kota_kode where v.id = ${pengunjungId}`;
  if (!rows.length) throw new PameranError(404, "Pengunjung tidak ditemukan.");
  const r = rows[0];
  if (r.deal_id != null) throw new PameranError(409, r.deal_id === PROSES ? "Sedang dijadikan deal, muat ulang sebentar lagi." : "Pengunjung ini sudah dijadikan deal.");
  // Klaim baris DULU (penanda sementara) — dua klik serentak: hanya satu yang dapat klaim,
  // jadi tak pernah ada deal kembar dan tak perlu menghapus deal yang sudah telanjur dibuat.
  const klaim = await sql`update pameran_pengunjung set deal_id = ${PROSES} where id = ${pengunjungId} and deal_id is null returning id`;
  if (!klaim.length) throw new PameranError(409, "Pengunjung ini baru saja dijadikan deal oleh orang lain.");
  // main belum punya deal.sumber_lead (migrasi 252, F96 hanya di dev) → asal "pameran" dicatat di notes.
  const catatan = `[Sumber: pameran] Pengunjung pameran ${r.pameran}: ${r.nama} (${hpTampil(String(r.no_hp))}), kupon ${r.kode_kupon}.`;
  let deal: { deal_id: string };
  try {
    deal = await createDeal(scope, {
      facility_name: String(r.institusi), product_category: KATEGORI_DEAL[r.divisi as Divisi],       ...(r.kab_kota ? { city: String(r.kab_kota), province: String(r.provinsi) } : {}),
      notes: teks(b.catatan, 500) ? `${catatan}\n${teks(b.catatan, 500)}` : catatan,
      ...(typeof b.am_id === "string" && b.am_id ? { am_id: b.am_id } : {}),
    });
  } catch (e) {
    await sql`update pameran_pengunjung set deal_id = null where id = ${pengunjungId} and deal_id = ${PROSES}`;
    throw e;
  }
  await sql`update pameran_pengunjung set deal_id = ${deal.deal_id} where id = ${pengunjungId}`;
  return { deal_id: deal.deal_id };
}
