// F171 Permintaan Produk Non-Master — Komite Product Development (migrasi 244).
//
// Pengganti Log-Permintaan-Non-Master-SKU.xlsx (deck "KSO Forum" Direktur, 20 Okt 2026):
// fokus tetap 1.000 SKU, tapi tidak ada permintaan lapangan yang hilang. Keputusan user 21 Okt:
// dicatat lewat form web oleh Sekretaris PD, potensi = qty per bulan × harga × 12, mulai kosong.
//
// Kelompok produk digabung MANUAL oleh Sekretaris (penulisan "HbA1c" / "Hba1c Fia" / "A1C"
// tidak ditebak mesin — salah gabung = kandidat palsu). Ambang kandidat = baris
// produk_permintaan_param, diubah dari layar oleh pemegang izin putusan.
// Gerbang menu & izin putusan di BFF (requireFeature + sub-fitur); `oleh` selalu dari sesi.

import { db } from "../db.js";
import { listOwnerCandidates } from "./account.js";
import { resolusiFaskes } from "./demo-trial.js";

export class PermintaanError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const SUMBER = ["wa", "kunjungan", "telepon", "tender", "email", "lainnya"] as const;
export const CEK = ["belum_dicek", "ada", "substitusi", "belum_ada"] as const;
export const KEPUTUSAN = ["masuk_master", "principal_baru", "tolak"] as const;
export type Sumber = (typeof SUMBER)[number];
export type Cek = (typeof CEK)[number];
export type Keputusan = (typeof KEPUTUSAN)[number];

export interface Param { kandidat_min_faskes: number; kandidat_hari: number; kandidat_min_potensi: number; sla_hari_kerja: number }
export const PARAM_KUNCI = ["kandidat_min_faskes", "kandidat_hari", "kandidat_min_potensi", "sla_hari_kerja"] as const;

// ---------------------------------------------------------------- murni (diuji)

const teks = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Angka dari isian manusia: "1.250.000" / "12,5" / 12.5. Negatif & bukan angka = null. */
export function angka(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v).trim();
  const n = Number(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const tanggal = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export interface IsianPermintaan {
  tanggal_minta: string; pengaju: string; am_id: string | null; account_id: number | null; faskes_nama: string;
  produk_diminta: string; merek: string | null; qty_bulan: number | null; satuan: string | null; harga_satuan: number | null;
  sumber: Sumber; cek_master: Cek; sku_kode: string | null; kelompok_id: number | null; catatan: string | null;
}

/** Validasi isian catat baru. hariIni = tanggal WIB 'YYYY-MM-DD'. */
export function validasiPermintaan(b: Record<string, unknown>, hariIni: string): { ok: true; isi: IsianPermintaan } | { ok: false; pesan: string } {
  const produk = teks(b.produk_diminta);
  if (!produk) return { ok: false, pesan: "Tulis produk persis seperti yang diminta." };
  const faskes = teks(b.faskes_nama);
  if (!faskes) return { ok: false, pesan: "Faskes wajib diisi." };
  const pengaju = teks(b.pengaju);
  if (!pengaju) return { ok: false, pesan: "Pengaju (siapa yang menyampaikan permintaan) wajib diisi." };
  const tgl = b.tanggal_minta == null || b.tanggal_minta === "" ? hariIni : tanggal(b.tanggal_minta);
  if (!tgl) return { ok: false, pesan: "Tanggal permintaan tidak sah." };
  if (tgl > hariIni) return { ok: false, pesan: "Tanggal permintaan tidak boleh di masa depan." };
  const qty = b.qty_bulan == null || b.qty_bulan === "" ? null : angka(b.qty_bulan);
  if (b.qty_bulan != null && b.qty_bulan !== "" && (qty === null || qty <= 0)) return { ok: false, pesan: "Qty per bulan harus angka lebih dari 0." };
  const harga = b.harga_satuan == null || b.harga_satuan === "" ? null : angka(b.harga_satuan);
  if (b.harga_satuan != null && b.harga_satuan !== "" && harga === null) return { ok: false, pesan: "Harga harus angka." };
  const sumber = (SUMBER as readonly string[]).includes(String(b.sumber)) ? (b.sumber as Sumber) : "lainnya";
  const cek = (CEK as readonly string[]).includes(String(b.cek_master)) ? (b.cek_master as Cek) : "belum_dicek";
  const sku = teks(b.sku_kode);
  if ((cek === "ada" || cek === "substitusi") && !sku) return { ok: false, pesan: "Pilih kode SKU yang ada / penggantinya." };
  const acc = b.account_id == null || b.account_id === "" ? null : Number(b.account_id);
  const kel = b.kelompok_id == null || b.kelompok_id === "" ? null : Number(b.kelompok_id);
  return {
    ok: true,
    isi: {
      tanggal_minta: tgl, pengaju, am_id: teks(b.am_id), account_id: acc && Number.isInteger(acc) && acc > 0 ? acc : null,
      faskes_nama: faskes, produk_diminta: produk, merek: teks(b.merek), qty_bulan: qty, satuan: teks(b.satuan), harga_satuan: harga,
      sumber, cek_master: cek, sku_kode: cek === "ada" || cek === "substitusi" ? sku : null,
      kelompok_id: kel && Number.isInteger(kel) && kel > 0 ? kel : null, catatan: teks(b.catatan),
    },
  };
}

/** '2026-10-21' → '2026-Q4'. */
export function kuartalDari(iso: string): string {
  return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface BarisAnalisa {
  kelompok_id: number; tanggal_minta: string; faskes_kunci: string; cek_master: Cek;
  qty_bulan: number | null; harga_satuan: number | null; dicatat_at: string;
}
export interface Agregat {
  permintaan: number; faskes_unik: number; belum_ada: number; substitusi: number; belum_dicek: number;
  harga_median: number | null; potensi_tahun: number | null; faskes_tanpa_angka: number; kandidat: boolean;
}

/**
 * Agregat satu kelompok di jendela `kandidat_hari` hari terakhir.
 * - Baris cek "ada" (produknya memang ada di master) TIDAK ikut — bukan permintaan non-master.
 * - Potensi per faskes = permintaan TERBARU faskes itu (qty/bulan × harga × 12), lalu dijumlah:
 *   faskes yang meminta berulang tidak dihitung berlipat. Faskes tanpa qty/harga dicatat
 *   terpisah (`faskes_tanpa_angka`) — potensi NULL bila tak satu pun faskes berangka, bukan 0.
 * - Kandidat = faskes unik ≥ min DAN potensi ≥ min.
 */
export function agregatKelompok(rows: BarisAnalisa[], p: Param, hariIni: string): Agregat {
  const batas = new Date(Date.parse(hariIni + "T00:00:00Z") - p.kandidat_hari * 864e5).toISOString().slice(0, 10);
  const r = rows.filter((x) => x.cek_master !== "ada" && x.tanggal_minta > batas && x.tanggal_minta <= hariIni);
  const terbaru = new Map<string, BarisAnalisa>();
  for (const x of r) {
    const ada = terbaru.get(x.faskes_kunci);
    if (!ada || x.tanggal_minta > ada.tanggal_minta || (x.tanggal_minta === ada.tanggal_minta && x.dicatat_at > ada.dicatat_at)) terbaru.set(x.faskes_kunci, x);
  }
  let potensi: number | null = null;
  let tanpa = 0;
  for (const x of terbaru.values()) {
    if (x.qty_bulan != null && x.harga_satuan != null) potensi = (potensi ?? 0) + x.qty_bulan * x.harga_satuan * 12;
    else tanpa++;
  }
  const faskes = terbaru.size;
  return {
    permintaan: r.length, faskes_unik: faskes,
    belum_ada: r.filter((x) => x.cek_master === "belum_ada").length,
    substitusi: r.filter((x) => x.cek_master === "substitusi").length,
    belum_dicek: r.filter((x) => x.cek_master === "belum_dicek").length,
    harga_median: median(r.map((x) => x.harga_satuan).filter((h): h is number => h != null)),
    potensi_tahun: potensi == null ? null : Math.round(potensi), faskes_tanpa_angka: tanpa,
    kandidat: faskes >= p.kandidat_min_faskes && (potensi ?? 0) >= p.kandidat_min_potensi,
  };
}

// ---------------------------------------------------------------- baca

const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

export async function bacaParam(): Promise<Param> {
  const rows = await db()`SELECT kunci, nilai::float8 AS nilai FROM produk_permintaan_param`;
  const m = new Map(rows.map((r) => [String(r.kunci), Number(r.nilai)]));
  return {
    kandidat_min_faskes: m.get("kandidat_min_faskes") ?? 3, kandidat_hari: m.get("kandidat_hari") ?? 90,
    kandidat_min_potensi: m.get("kandidat_min_potensi") ?? 250_000_000, sla_hari_kerja: m.get("sla_hari_kerja") ?? 1,
  };
}

export interface FilterLog { q?: string | null; cek?: string | null; kelompok_id?: number | null; dari?: string | null; sampai?: string | null; limit?: number; offset?: number }

export async function listPermintaan(f: FilterLog) {
  const sql = db();
  const p = await bacaParam();
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const q = teks(f.q);
  const cek = (CEK as readonly string[]).includes(String(f.cek)) ? String(f.cek) : null;
  const kel = f.kelompok_id ?? null;
  const dari = tanggal(f.dari);
  const sampai = tanggal(f.sampai);
  const pola = "%" + (q ?? "").replace(/[\\%_]/g, (c) => "\\" + c) + "%"; // % dan _ ketikan = huruf, bukan wildcard
  const where = sql`
    WHERE (${q}::text IS NULL OR pp.produk_diminta ILIKE ${pola} OR pp.faskes_nama ILIKE ${pola} OR pp.merek ILIKE ${pola})
      AND (${cek}::text IS NULL OR pp.cek_master = ${cek})
      AND (${kel}::bigint IS NULL OR pp.kelompok_id = ${kel})
      AND (${dari}::date IS NULL OR pp.tanggal_minta >= ${dari}::date)
      AND (${sampai}::date IS NULL OR pp.tanggal_minta <= ${sampai}::date)`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM produk_permintaan pp ${where}`;
  const items = await sql`
    SELECT pp.id::int, pp.tanggal_minta::text, pp.pengaju, pp.am_id, pp.account_id::int, pp.faskes_nama, pp.produk_diminta, pp.merek,
           pp.qty_bulan::float8, pp.satuan, pp.harga_satuan::float8, pp.sumber, pp.cek_master, pp.sku_kode, pc.nama AS sku_nama,
           pp.kelompok_id::int, k.nama AS kelompok_nama, pp.catatan, pp.dicatat_oleh, pp.dicatat_at::text,
           produk_permintaan_hari_kerja(pp.tanggal_minta, (pp.dicatat_at AT TIME ZONE 'Asia/Jakarta')::date) AS hari_kerja_catat
      FROM produk_permintaan pp
      LEFT JOIN product_code pc ON pc.kode = pp.sku_kode
      LEFT JOIN produk_permintaan_kelompok k ON k.id = pp.kelompok_id
      ${where}
     ORDER BY pp.tanggal_minta DESC, pp.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return {
    count: items.length, total_rows: Number(n), limit, offset, sla_hari_kerja: p.sla_hari_kerja,
    items: items.map((r) => ({ ...r, terlambat: Number(r.hari_kerja_catat) > p.sla_hari_kerja })),
  };
}

export async function analisa() {
  const sql = db();
  const p = await bacaParam();
  const hariIni = hariIniWib();
  const kel = await sql`
    SELECT k.id::int, k.nama, k.catatan, (SELECT count(*)::int FROM produk_permintaan x WHERE x.kelompok_id = k.id) AS total_semua
      FROM produk_permintaan_kelompok k ORDER BY k.nama`;
  const rows = await sql`
    SELECT kelompok_id::int, tanggal_minta::text, cek_master, qty_bulan::float8, harga_satuan::float8, dicatat_at::text,
           COALESCE('a:' || account_id::text, 'n:' || lower(btrim(faskes_nama))) AS faskes_kunci
      FROM produk_permintaan
     WHERE kelompok_id IS NOT NULL AND tanggal_minta > ${hariIni}::date - ${p.kandidat_hari}::int`;
  const review = await sql`
    SELECT DISTINCT ON (kelompok_id) kelompok_id::int, kuartal, usulan, putusan
      FROM produk_permintaan_review ORDER BY kelompok_id, kuartal DESC`;
  const rv = new Map(review.map((r) => [Number(r.kelompok_id), r]));
  const per = new Map<number, BarisAnalisa[]>();
  for (const r of rows as unknown as BarisAnalisa[]) per.set(r.kelompok_id, [...(per.get(r.kelompok_id) ?? []), r]);
  const kelompok = kel.map((k) => ({
    id: Number(k.id), nama: String(k.nama), catatan: (k.catatan as string | null) ?? null, total_semua: Number(k.total_semua),
    ...agregatKelompok(per.get(Number(k.id)) ?? [], p, hariIni),
    review_terakhir: rv.get(Number(k.id)) ?? null,
  }));
  kelompok.sort((a, b) => Number(b.kandidat) - Number(a.kandidat) || (b.potensi_tahun ?? -1) - (a.potensi_tahun ?? -1) || b.faskes_unik - a.faskes_unik);
  const [{ tanpa_kelompok }] = await sql`
    SELECT count(*)::int AS tanpa_kelompok FROM produk_permintaan WHERE kelompok_id IS NULL AND cek_master <> 'ada'`;
  // tren 6 bulan: jumlah permintaan non-master per bulan
  const tren = await sql`
    SELECT to_char(date_trunc('month', tanggal_minta), 'YYYY-MM') AS bulan, count(*)::int AS permintaan,
           count(DISTINCT COALESCE('a:' || account_id::text, 'n:' || lower(btrim(faskes_nama))))::int AS faskes
      FROM produk_permintaan WHERE cek_master <> 'ada' AND tanggal_minta >= date_trunc('month', ${hariIni}::date) - interval '5 months'
     GROUP BY 1 ORDER BY 1`;
  return { param: p, hari_ini: hariIni, kelompok, tanpa_kelompok: Number(tanpa_kelompok), tren };
}

export async function listReview(kuartal?: string | null) {
  const k = typeof kuartal === "string" && /^\d{4}-Q[1-4]$/.test(kuartal) ? kuartal : null;
  const rows = await db()`
    SELECT r.id::int, r.kelompok_id::int, kk.nama AS kelompok_nama, r.kuartal, r.usulan, r.usulan_catatan, r.usulan_oleh, r.usulan_at::text,
           r.snapshot, r.putusan, r.putusan_catatan, r.putusan_oleh, r.putusan_at::text
      FROM produk_permintaan_review r JOIN produk_permintaan_kelompok kk ON kk.id = r.kelompok_id
     WHERE (${k}::text IS NULL OR r.kuartal = ${k})
     ORDER BY r.kuartal DESC, (r.putusan IS NULL) DESC, kk.nama`;
  return { kuartal_sekarang: kuartalDari(hariIniWib()), items: rows };
}

export async function opsi() {
  const sql = db();
  const kelompok = await sql`SELECT id::int, nama FROM produk_permintaan_kelompok ORDER BY nama`;
  return { am: await listOwnerCandidates(), kelompok };
}

/** Cari SKU di master Klasifikasi Produk (nama / kode / kode Accurate / brand). */
export async function cariSku(q: string) {
  const s = teks(q);
  if (!s || s.length < 2) return { items: [] };
  const pola = "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const items = await db()`
    SELECT kode, nama, brand, kode_2025 FROM product_code
     WHERE nama ILIKE ${pola} OR kode ILIKE ${pola} OR kode_2025 ILIKE ${pola} OR brand ILIKE ${pola}
     ORDER BY nama LIMIT 20`;
  return { items };
}

// ---------------------------------------------------------------- tulis

async function cekSku(kode: string | null) {
  if (!kode) return;
  const [r] = await db()`SELECT 1 FROM product_code WHERE kode = ${kode}`;
  if (!r) throw new PermintaanError(400, "Kode SKU tidak ada di master Klasifikasi Produk.");
}
async function cekKelompok(id: number | null) {
  if (id == null) return;
  const [r] = await db()`SELECT 1 FROM produk_permintaan_kelompok WHERE id = ${id}`;
  if (!r) throw new PermintaanError(400, "Kelompok tidak ada.");
}

export async function catatPermintaan(b: Record<string, unknown>, oleh: string) {
  const v = validasiPermintaan(b, hariIniWib());
  if (!v.ok) throw new PermintaanError(400, v.pesan);
  const isi = v.isi;
  await cekSku(isi.sku_kode);
  await cekKelompok(isi.kelompok_id);
  // faskes: tautkan ke customer Accurate bila jelas satu; ambigu → minta dipilih (tak ditebak);
  // tidak ketemu → calon pelanggan, nama apa adanya.
  if (isi.account_id == null) {
    const f = await resolusiFaskes(isi.faskes_nama);
    if (f.kind === "ambiguous") throw Object.assign(new PermintaanError(409, `"${isi.faskes_nama}" cocok ke beberapa faskes — pilih salah satu`), { kandidat: f.names });
    if (f.kind === "one") { isi.account_id = f.account_id; isi.faskes_nama = f.name; }
  }
  const [r] = await db()`
    INSERT INTO produk_permintaan (tanggal_minta, am_id, pengaju, account_id, faskes_nama, produk_diminta, merek, qty_bulan, satuan,
                                   harga_satuan, sumber, cek_master, sku_kode, kelompok_id, catatan, dicatat_oleh)
    VALUES (${isi.tanggal_minta}, ${isi.am_id}, ${isi.pengaju}, ${isi.account_id}, ${isi.faskes_nama}, ${isi.produk_diminta}, ${isi.merek},
            ${isi.qty_bulan}, ${isi.satuan}, ${isi.harga_satuan}, ${isi.sumber}, ${isi.cek_master}, ${isi.sku_kode}, ${isi.kelompok_id},
            ${isi.catatan}, ${oleh})
    RETURNING id::int`;
  return { ok: true, id: Number(r.id) };
}

/** Ubah satu permintaan: isian awal (koreksi), cek master, SKU, kelompok, catatan. */
export async function ubahPermintaan(id: number, b: Record<string, unknown>, oleh: string) {
  const [lama] = await db()`SELECT * FROM produk_permintaan WHERE id = ${id}`;
  if (!lama) throw new PermintaanError(404, "Permintaan tidak ada.");
  const gabung: Record<string, unknown> = {
    tanggal_minta: String(lama.tanggal_minta instanceof Date ? lama.tanggal_minta.toISOString().slice(0, 10) : lama.tanggal_minta),
    pengaju: lama.pengaju, am_id: lama.am_id, account_id: lama.account_id, faskes_nama: lama.faskes_nama, produk_diminta: lama.produk_diminta,
    merek: lama.merek, qty_bulan: lama.qty_bulan, satuan: lama.satuan, harga_satuan: lama.harga_satuan, sumber: lama.sumber,
    cek_master: lama.cek_master, sku_kode: lama.sku_kode, kelompok_id: lama.kelompok_id, catatan: lama.catatan,
  };
  for (const k of Object.keys(gabung)) if (k in b) gabung[k] = b[k];
  // faskes diganti lewat nama → tautan Accurate lama tak berlaku lagi
  if ("faskes_nama" in b && !("account_id" in b)) gabung.account_id = null;
  const v = validasiPermintaan(gabung, hariIniWib());
  if (!v.ok) throw new PermintaanError(400, v.pesan);
  const isi = v.isi;
  await cekSku(isi.sku_kode);
  await cekKelompok(isi.kelompok_id);
  await db()`
    UPDATE produk_permintaan SET tanggal_minta = ${isi.tanggal_minta}, am_id = ${isi.am_id}, pengaju = ${isi.pengaju},
           account_id = ${isi.account_id}, faskes_nama = ${isi.faskes_nama}, produk_diminta = ${isi.produk_diminta}, merek = ${isi.merek},
           qty_bulan = ${isi.qty_bulan}, satuan = ${isi.satuan}, harga_satuan = ${isi.harga_satuan}, sumber = ${isi.sumber},
           cek_master = ${isi.cek_master}, sku_kode = ${isi.sku_kode}, kelompok_id = ${isi.kelompok_id}, catatan = ${isi.catatan},
           diubah_oleh = ${oleh}, diubah_at = now()
     WHERE id = ${id}`;
  return { ok: true };
}

/** Buat kelompok baru (nama unik, tak peka huruf) atau ganti nama/catatan kelompok yang ada. */
export async function simpanKelompok(b: Record<string, unknown>, oleh: string) {
  const nama = teks(b.nama);
  if (!nama) throw new PermintaanError(400, "Nama kelompok wajib diisi.");
  const id = b.id == null ? null : Number(b.id);
  try {
    if (id) {
      const r = await db()`UPDATE produk_permintaan_kelompok SET nama = ${nama}, catatan = ${teks(b.catatan)}, diubah_at = now()
                            WHERE id = ${id} RETURNING id::int`;
      if (r.length === 0) throw new PermintaanError(404, "Kelompok tidak ada.");
      return { ok: true, id };
    }
    const [r] = await db()`INSERT INTO produk_permintaan_kelompok (nama, catatan, dibuat_oleh) VALUES (${nama}, ${teks(b.catatan)}, ${oleh})
                           RETURNING id::int`;
    return { ok: true, id: Number(r.id) };
  } catch (e) {
    if (e instanceof PermintaanError) throw e;
    if (/produk_permintaan_kelompok_nama/.test((e as Error).message)) throw new PermintaanError(409, `Kelompok "${nama}" sudah ada.`);
    throw e;
  }
}

/** Komite PD mengusulkan satu kelompok untuk kuartal berjalan; angka saat itu dibekukan ke snapshot. */
export async function usulkan(b: Record<string, unknown>, oleh: string) {
  const kelompokId = Number(b.kelompok_id);
  const usulan = String(b.usulan);
  const catatan = teks(b.catatan);
  if (!Number.isInteger(kelompokId) || kelompokId <= 0) throw new PermintaanError(400, "Pilih kelompoknya.");
  if (!(KEPUTUSAN as readonly string[]).includes(usulan)) throw new PermintaanError(400, "Pilih usulan: masuk master, principal baru, atau tolak.");
  if (!catatan) throw new PermintaanError(400, "Alasan usulan wajib ditulis.");
  const a = await analisa();
  const k = a.kelompok.find((x) => x.id === kelompokId);
  if (!k) throw new PermintaanError(404, "Kelompok tidak ada.");
  const kuartal = kuartalDari(a.hari_ini);
  const snap: Record<string, unknown> = { ...k };
  delete snap.review_terakhir;
  const [ada] = await db()`SELECT id, putusan FROM produk_permintaan_review WHERE kelompok_id = ${kelompokId} AND kuartal = ${kuartal}`;
  if (ada?.putusan) throw new PermintaanError(409, `Kelompok ini sudah diputus Direksi untuk ${kuartal}.`);
  const snapshot = { ...snap, param: a.param, dihitung: a.hari_ini };
  if (ada) {
    await db()`UPDATE produk_permintaan_review SET usulan = ${usulan}, usulan_catatan = ${catatan}, usulan_oleh = ${oleh}, usulan_at = now(),
                     snapshot = ${db().json(snapshot as never)} WHERE id = ${ada.id}`;
    return { ok: true, id: Number(ada.id), kuartal };
  }
  const [r] = await db()`
    INSERT INTO produk_permintaan_review (kelompok_id, kuartal, usulan, usulan_catatan, usulan_oleh, snapshot)
    VALUES (${kelompokId}, ${kuartal}, ${usulan}, ${catatan}, ${oleh}, ${db().json(snapshot as never)}) RETURNING id::int`;
  return { ok: true, id: Number(r.id), kuartal };
}

/** Direksi memutus satu usulan. Putusan final — tidak bisa diubah lewat layar. */
export async function putuskan(id: number, b: Record<string, unknown>, oleh: string) {
  const putusan = String(b.putusan);
  const catatan = teks(b.catatan);
  if (!(KEPUTUSAN as readonly string[]).includes(putusan)) throw new PermintaanError(400, "Pilih putusan: masuk master, principal baru, atau tolak.");
  if (!catatan) throw new PermintaanError(400, "Alasan putusan wajib ditulis.");
  const r = await db()`UPDATE produk_permintaan_review SET putusan = ${putusan}, putusan_catatan = ${catatan}, putusan_oleh = ${oleh}, putusan_at = now()
                        WHERE id = ${id} AND putusan IS NULL RETURNING id`;
  if (r.length === 0) {
    const [x] = await db()`SELECT putusan FROM produk_permintaan_review WHERE id = ${id}`;
    throw new PermintaanError(x ? 409 : 404, x ? "Usulan ini sudah diputus." : "Usulan tidak ada.");
  }
  return { ok: true };
}

/** Ubah ambang kandidat / SLA (pemegang izin putusan). */
export async function ubahParam(b: Record<string, unknown>, oleh: string) {
  const ubah: [string, number][] = [];
  for (const k of PARAM_KUNCI) {
    if (!(k in b)) continue;
    const n = angka(b[k]);
    if (n === null) throw new PermintaanError(400, `Nilai ${k} harus angka ≥ 0.`);
    if ((k === "kandidat_hari" || k === "kandidat_min_faskes") && (n < 1 || !Number.isInteger(n))) throw new PermintaanError(400, `Nilai ${k} harus bilangan bulat ≥ 1.`);
    ubah.push([k, n]);
  }
  if (ubah.length === 0) throw new PermintaanError(400, "Tidak ada ambang yang diubah.");
  await db().begin(async (tx) => {
    for (const [k, n] of ubah) await tx`UPDATE produk_permintaan_param SET nilai = ${n}, diubah_oleh = ${oleh}, diubah_at = now() WHERE kunci = ${k}`;
  });
  return { ok: true, param: await bacaParam() };
}
