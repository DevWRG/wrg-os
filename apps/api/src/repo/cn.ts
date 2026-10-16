// F151 CN (Kredit Note) Lifecycle — migrasi 230.
//
// CN = rebate ke customer berdasarkan kontrak, diinput lewat form, dasar hitung = FAKTUR (DPP
// accurate_invoice). Alur pengajuan:
//   diajukan → [ditinjau HoD Business, bila diajukan lewat dia] → disetujui (HoD Sales)
//            → divalidasi (Finance) → terealisasi (GA, wajib bukti transfer)
//   ditolak / dibatalkan = final; faktur yang dicakup dilepas supaya bisa diajukan lagi.
//
// Dua bagian, sengaja dipisah:
//   1. LOGIKA MURNI (hitungNilaiCn, cekPindah, cekFakturKontrak, …) — tanpa DB, diuji di cn.test.ts.
//   2. AKSES DB — merakit data lalu menyerahkannya ke (1).
//
// Hak per tahap (siapa boleh menggeser status) ditegakkan di BFF (apps/web/src/lib/cn-access.ts),
// seperti F35/F138: api tidak tahu role. Di sini hanya urutan status & validasi data.

import { db } from "../db.js";

type Sql = ReturnType<typeof db>;

// ── Konstanta ────────────────────────────────────────────────────────────────
export const CN_STATUS = ["diajukan", "ditinjau", "disetujui", "divalidasi", "terealisasi", "ditolak", "dibatalkan"] as const;
export type CnStatus = (typeof CN_STATUS)[number];
export const KONTRAK_STATUS = ["draft", "aktif", "dibatalkan"] as const;
export type KontrakStatus = (typeof KONTRAK_STATUS)[number];
export type CnJenis = "persen" | "nominal";

/** HoD Sales = approver akhir (rocky East / yogi West); HoD Business = peninjau opsional (mufid IVD / arman Medical). */
export const HOD_SALES_KEYS = ["rocky", "yogi"] as const;
export const HOD_BUSINESS_KEYS = ["mufid", "arman"] as const;
export const FAKTUR_MAKS = 100;
export const FAKTUR_CARI_LIMIT = 200;
const TEXT_MAX = 500;
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const TGL = /^\d{4}-\d{2}-\d{2}$/;

export class CnError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 422,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const wibDate = (now = Date.now()): string => new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);

const clean = (v: unknown, max = TEXT_MAX): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const s = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const tglSah = (v: string): boolean => TGL.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// ── 1. Logika murni ──────────────────────────────────────────────────────────

/**
 * Nilai CN per faktur, bilangan bulat Rupiah.
 *  - persen : round(DPP × tarif/100) per faktur.
 *  - nominal: tarif = total Rupiah pengajuan, dibagi sebanding DPP; sisa pembulatan (largest remainder)
 *             dibagikan supaya jumlah item PERSIS sama dengan tarif.
 */
export function hitungNilaiCn(jenis: CnJenis, tarif: number, dpp: readonly number[]): number[] {
  if (jenis === "persen") return dpp.map((d) => Math.round((d * tarif) / 100));
  const total = dpp.reduce((a, b) => a + b, 0);
  if (total <= 0) return dpp.map(() => 0);
  const raw = dpp.map((d) => (d * tarif) / total);
  const lantai = raw.map(Math.floor);
  let sisa = Math.round(tarif) - lantai.reduce((a, b) => a + b, 0);
  const urut = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of urut) {
    if (sisa <= 0) break;
    lantai[i] += 1;
    sisa -= 1;
  }
  return lantai;
}

/** Pengajuan lewat HoD Business bila hod_business_key terisi. */
export const lewatBusiness = (p: { hod_business_key: string | null }): boolean => p.hod_business_key != null;

/** Peta perpindahan; cabang awal bergantung rute pengajuan. */
export function tujuanBerikut(dari: CnStatus, rute: { hod_business_key: string | null }): readonly CnStatus[] {
  switch (dari) {
    case "diajukan": return lewatBusiness(rute) ? ["ditinjau", "ditolak", "dibatalkan"] : ["disetujui", "ditolak", "dibatalkan"];
    case "ditinjau": return ["disetujui", "ditolak", "dibatalkan"];
    case "disetujui": return ["divalidasi", "ditolak"];
    case "divalidasi": return ["terealisasi", "ditolak"];
    default: return [];
  }
}
export const bolehPindah = (dari: CnStatus, ke: CnStatus, rute: { hod_business_key: string | null }): boolean => tujuanBerikut(dari, rute).includes(ke);

/** Bukti = tautan https (belum ada penyimpanan berkas di sistem ini). */
export function cekBuktiUrl(v: unknown): string {
  const t = clean(v, 1000);
  if (!t) throw new CnError(400, "bukti_url wajib diisi untuk merealisasikan", "bukti_url");
  try {
    if (new URL(t).protocol !== "https:") throw new Error("bukan https");
  } catch {
    throw new CnError(400, "bukti_url harus tautan https yang sah", "bukti_url");
  }
  return t;
}

export interface PindahInput { bukti_url: string | null; tanggal_realisasi: string | null; catatan: string | null }

/** Validasi satu perpindahan; mengembalikan input bersih. Tolak & batal wajib beralasan, realisasi wajib bukti + tanggal. */
export function cekPindah(
  dari: CnStatus,
  ke: unknown,
  rute: { hod_business_key: string | null },
  body: { bukti_url?: unknown; tanggal_realisasi?: unknown; catatan?: unknown },
  hariIni: string,
): { ke: CnStatus } & PindahInput {
  if (!CN_STATUS.includes(ke as CnStatus)) throw new CnError(400, `ke harus salah satu: ${CN_STATUS.join(", ")}`, "ke");
  const tujuan = ke as CnStatus;
  if (!bolehPindah(dari, tujuan, rute)) throw new CnError(409, `tidak bisa pindah dari ${dari} ke ${tujuan}`);
  const catatan = clean(body.catatan);
  if ((tujuan === "ditolak" || tujuan === "dibatalkan") && !catatan) throw new CnError(400, "alasan wajib diisi untuk menolak/membatalkan", "catatan");
  if (tujuan !== "terealisasi") return { ke: tujuan, bukti_url: null, tanggal_realisasi: null, catatan };
  const tgl = clean(body.tanggal_realisasi, 10) ?? hariIni;
  if (!tglSah(tgl)) throw new CnError(400, "tanggal_realisasi harus YYYY-MM-DD", "tanggal_realisasi");
  if (tgl > hariIni) throw new CnError(400, "tanggal_realisasi tidak boleh di masa depan", "tanggal_realisasi");
  return { ke: tujuan, bukti_url: cekBuktiUrl(body.bukti_url), tanggal_realisasi: tgl, catatan };
}

export interface KontrakInput {
  customer_id: number; jenis: CnJenis; tarif: number; periode_mulai: string; periode_selesai: string;
  syarat: string | null; file_url: string | null;
}

const idPositif = (v: unknown): number => {
  const n = typeof v === "number" ? v : /^\d{1,15}$/.test(String(v ?? "")) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : NaN;
};

/** Validasi form kontrak; melempar CnError dengan `field` agar form menandai kolomnya. */
export function cekKontrak(b: Record<string, unknown>): KontrakInput {
  const customer_id = idPositif(b.customer_id);
  if (Number.isNaN(customer_id)) throw new CnError(400, "customer wajib dipilih", "customer_id");
  if (b.jenis !== "persen" && b.jenis !== "nominal") throw new CnError(400, "jenis harus persen atau nominal", "jenis");
  const tarif = typeof b.tarif === "number" ? b.tarif : Number(String(b.tarif ?? "").replace(",", "."));
  if (!Number.isFinite(tarif) || tarif <= 0) throw new CnError(400, "tarif harus lebih dari 0", "tarif");
  if (b.jenis === "persen" && tarif > 100) throw new CnError(400, "tarif persen maksimal 100", "tarif");
  const mulai = clean(b.periode_mulai, 10) ?? "";
  const selesai = clean(b.periode_selesai, 10) ?? "";
  if (!tglSah(mulai)) throw new CnError(400, "periode_mulai harus YYYY-MM-DD", "periode_mulai");
  if (!tglSah(selesai)) throw new CnError(400, "periode_selesai harus YYYY-MM-DD", "periode_selesai");
  if (selesai < mulai) throw new CnError(400, "periode_selesai tidak boleh sebelum periode_mulai", "periode_selesai");
  const file = clean(b.file_url, 1000);
  if (file) {
    try {
      if (new URL(file).protocol !== "https:") throw new Error("bukan https");
    } catch {
      throw new CnError(400, "file_url harus tautan https yang sah", "file_url");
    }
  }
  return { customer_id, jenis: b.jenis, tarif: b.jenis === "persen" ? Math.round(tarif * 100) / 100 : Math.round(tarif), periode_mulai: mulai, periode_selesai: selesai, syarat: clean(b.syarat, 1000), file_url: file };
}

export interface FakturKandidat {
  invoice_id: number; invoice_number: string; tanggal: string; customer_id: number | null;
  dpp: number; salesman_name: string | null; sudah_dicakup: boolean;
}

/** Validasi CN per transaksi (SOP 4): faktur ada, milik customer kontrak, dalam periode, DPP > 0, belum dicakup pengajuan aktif. */
export function cekFakturKontrak(f: FakturKandidat | undefined, k: { customer_id: number; periode_mulai: string; periode_selesai: string }, invoiceId: number): FakturKandidat {
  if (!f) throw new CnError(404, `faktur ${invoiceId} tidak ditemukan`, "invoice_ids");
  const no = f.invoice_number || String(invoiceId);
  if (f.customer_id !== k.customer_id) throw new CnError(422, `faktur ${no} bukan milik customer kontrak`, "invoice_ids");
  if (f.tanggal < k.periode_mulai || f.tanggal > k.periode_selesai) throw new CnError(422, `faktur ${no} (${f.tanggal}) di luar periode kontrak`, "invoice_ids");
  if (!(f.dpp > 0)) throw new CnError(422, `faktur ${no} tanpa DPP`, "invoice_ids");
  if (f.sudah_dicakup) throw new CnError(409, `faktur ${no} sudah dicakup pengajuan CN aktif`, "invoice_ids");
  return f;
}

export function cekDaftarFaktur(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new CnError(400, "pilih minimal satu faktur", "invoice_ids");
  if (v.length > FAKTUR_MAKS) throw new CnError(400, `maksimal ${FAKTUR_MAKS} faktur per pengajuan`, "invoice_ids");
  const ids = v.map(idPositif);
  if (ids.some(Number.isNaN)) throw new CnError(400, "invoice_ids berisi id tidak valid", "invoice_ids");
  if (new Set(ids).size !== ids.length) throw new CnError(400, "faktur dobel dalam satu pengajuan", "invoice_ids");
  return ids;
}

// ── 2. Akses DB ──────────────────────────────────────────────────────────────

export interface KontrakRow {
  id: number; kode: string; customer_id: number; customer_name: string; jenis: CnJenis; tarif: number;
  periode_mulai: string; periode_selesai: string; syarat: string | null; file_url: string | null;
  status: KontrakStatus; created_by: string | null; approved_by: string | null; created_at: string;
}
export interface CnRow {
  id: number; kode: string; kontrak_id: number; customer_id: number; customer_name: string; jenis: CnJenis; tarif: number;
  total_dpp: number; total_cn: number; hod_sales_key: string; hod_business_key: string | null; status: CnStatus;
  bukti_url: string | null; tanggal_realisasi: string | null; catatan: string | null; requested_by: string | null;
  created_at: string; updated_at: string;
}
export interface CnItem { invoice_id: number; invoice_number: string; tanggal_invoice: string; salesman_name: string | null; dpp: number; nilai_cn: number }
export interface CnEvent { id: number; dari: CnStatus | null; ke: CnStatus; oleh: string | null; catatan: string | null; at: string }

const KONTRAK_COLS = (sql: Sql) => sql`
  id, kode, customer_id, customer_name, jenis, tarif, periode_mulai::text AS periode_mulai, periode_selesai::text AS periode_selesai,
  syarat, file_url, status, created_by, approved_by, created_at::text AS created_at`;
const CN_COLS = (sql: Sql) => sql`
  id, kode, kontrak_id, customer_id, customer_name, jenis, tarif, total_dpp, total_cn, hod_sales_key, hod_business_key, status,
  bukti_url, tanggal_realisasi::text AS tanggal_realisasi, catatan, requested_by, created_at::text AS created_at, updated_at::text AS updated_at`;

const mapKontrak = (r: Record<string, unknown>): KontrakRow => ({
  id: Number(r.id), kode: String(r.kode), customer_id: Number(r.customer_id), customer_name: String(r.customer_name),
  jenis: r.jenis as CnJenis, tarif: Number(r.tarif), periode_mulai: String(r.periode_mulai), periode_selesai: String(r.periode_selesai),
  syarat: s(r.syarat), file_url: s(r.file_url), status: r.status as KontrakStatus, created_by: s(r.created_by),
  approved_by: s(r.approved_by), created_at: String(r.created_at),
});
const mapCn = (r: Record<string, unknown>): CnRow => ({
  id: Number(r.id), kode: String(r.kode), kontrak_id: Number(r.kontrak_id), customer_id: Number(r.customer_id),
  customer_name: String(r.customer_name), jenis: r.jenis as CnJenis, tarif: Number(r.tarif), total_dpp: Number(r.total_dpp),
  total_cn: Number(r.total_cn), hod_sales_key: String(r.hod_sales_key), hod_business_key: s(r.hod_business_key),
  status: r.status as CnStatus, bukti_url: s(r.bukti_url), tanggal_realisasi: s(r.tanggal_realisasi), catatan: s(r.catatan),
  requested_by: s(r.requested_by), created_at: String(r.created_at), updated_at: String(r.updated_at),
});

const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === "23505";

export async function cariCustomer(q: string | null): Promise<{ id: number; name: string }[]> {
  const sql = db();
  const like = q?.trim() ? `%${q.trim().slice(0, 100)}%` : null;
  if (!like) return [];
  const rows = await sql`
    SELECT id, COALESCE(NULLIF(name, ''), '(tanpa nama)') AS name FROM accurate_customer
    WHERE name ILIKE ${like} ORDER BY name LIMIT 30`;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
}

export async function listKontrak(filter: { status?: string | null; q?: string | null; customer_id?: number | null }): Promise<{ items: KontrakRow[] }> {
  const sql = db();
  const st = KONTRAK_STATUS.includes(filter.status as KontrakStatus) ? (filter.status as KontrakStatus) : null;
  const like = filter.q?.trim() ? `%${filter.q.trim().slice(0, 100)}%` : null;
  const rows = await sql`
    SELECT ${KONTRAK_COLS(sql)} FROM cn_kontrak
    WHERE true ${st ? sql`AND status = ${st}` : sql``} ${filter.customer_id ? sql`AND customer_id = ${filter.customer_id}` : sql``}
      ${like ? sql`AND (customer_name ILIKE ${like} OR kode ILIKE ${like})` : sql``}
    ORDER BY (status = 'dibatalkan'), periode_selesai DESC, id DESC LIMIT 500`;
  return { items: rows.map(mapKontrak) };
}

export async function buatKontrak(input: Record<string, unknown>, oleh: string | null): Promise<{ id: number; kode: string }> {
  if (!oleh) throw new CnError(400, "pelaku (oleh) wajib ada", "oleh");
  const k = cekKontrak(input);
  const sql = db();
  const [c] = await sql`SELECT id, COALESCE(NULLIF(name, ''), '') AS name FROM accurate_customer WHERE id = ${k.customer_id}`;
  if (!c) throw new CnError(404, "customer tidak ditemukan", "customer_id");
  const [row] = await sql`
    INSERT INTO cn_kontrak (customer_id, customer_name, jenis, tarif, periode_mulai, periode_selesai, syarat, file_url, created_by)
    VALUES (${k.customer_id}, ${String(c.name) || `Customer ${k.customer_id}`}, ${k.jenis}, ${k.tarif}, ${k.periode_mulai},
            ${k.periode_selesai}, ${k.syarat}, ${k.file_url}, ${oleh})
    RETURNING id, kode`;
  return { id: Number(row.id), kode: String(row.kode) };
}

/** draft → aktif (Direktur) atau draft/aktif → dibatalkan. Kontrak yang punya pengajuan aktif tak bisa dibatalkan. */
export async function ubahStatusKontrakCn(id: number, ke: unknown, oleh: string | null): Promise<{ status: KontrakStatus }> {
  if (!oleh) throw new CnError(400, "pelaku (oleh) wajib ada", "oleh");
  if (ke !== "aktif" && ke !== "dibatalkan") throw new CnError(400, "ke harus aktif atau dibatalkan", "ke");
  const sql = db();
  return await sql.begin(async (tx) => {
    const [cur] = await tx`SELECT status FROM cn_kontrak WHERE id = ${id} FOR UPDATE`;
    if (!cur) throw new CnError(404, "kontrak tidak ditemukan");
    const dari = cur.status as KontrakStatus;
    if (ke === "aktif" && dari !== "draft") throw new CnError(409, `kontrak ${dari} tidak bisa diaktifkan`);
    if (ke === "dibatalkan" && dari === "dibatalkan") throw new CnError(409, "kontrak sudah dibatalkan");
    if (ke === "dibatalkan") {
      const [x] = await tx`SELECT 1 FROM cn_pengajuan WHERE kontrak_id = ${id} AND status NOT IN ('ditolak', 'dibatalkan') LIMIT 1`;
      if (x) throw new CnError(409, "kontrak masih punya pengajuan CN aktif");
    }
    await tx`UPDATE cn_kontrak SET status = ${ke}, updated_at = now(), approved_by = ${ke === "aktif" ? oleh : null} WHERE id = ${id}`;
    return { status: ke };
  });
}

/** Faktur milik customer kontrak dalam periode, yang belum dicakup pengajuan aktif — bahan checklist form pengajuan. */
export async function listFakturKandidat(kontrakId: number): Promise<{ items: FakturKandidat[] }> {
  const sql = db();
  const [k] = await sql`SELECT customer_id, periode_mulai::text AS periode_mulai, periode_selesai::text AS periode_selesai FROM cn_kontrak WHERE id = ${kontrakId}`;
  if (!k) throw new CnError(404, "kontrak tidak ditemukan");
  const rows = await sql`
    SELECT i.id AS invoice_id, i.number AS invoice_number, i.tanggal::text AS tanggal, i.customer_id,
           COALESCE(i.taxable_amount, 0) AS dpp, NULLIF(i.salesman_name, '') AS salesman_name,
           EXISTS (SELECT 1 FROM cn_pengajuan_item x WHERE x.invoice_id = i.id AND x.aktif) AS sudah_dicakup
    FROM accurate_invoice i
    WHERE i.customer_id = ${Number(k.customer_id)} AND i.tanggal BETWEEN ${String(k.periode_mulai)} AND ${String(k.periode_selesai)}
      AND COALESCE(i.taxable_amount, 0) > 0
    ORDER BY i.tanggal DESC, i.id DESC LIMIT ${FAKTUR_CARI_LIMIT}`;
  return { items: rows.map(mapFaktur).filter((f) => !f.sudah_dicakup) };
}

const mapFaktur = (r: Record<string, unknown>): FakturKandidat => ({
  invoice_id: Number(r.invoice_id), invoice_number: String(r.invoice_number ?? ""), tanggal: String(r.tanggal),
  customer_id: r.customer_id == null ? null : Number(r.customer_id), dpp: Number(r.dpp ?? 0),
  salesman_name: s(r.salesman_name), sudah_dicakup: Boolean(r.sudah_dicakup),
});

/**
 * Ajukan CN. Tarif & jenis di-SNAPSHOT dari kontrak; nilai per faktur dihitung SERVER dari DPP mirror
 * (angka dari klien diabaikan). Kontrak harus aktif dan periodenya mencakup tiap faktur.
 */
export async function buatPengajuan(input: Record<string, unknown>, oleh: string | null): Promise<{ id: number; kode: string; total_cn: number }> {
  if (!oleh) throw new CnError(400, "pelaku (oleh) wajib ada", "oleh");
  const kontrakId = idPositif(input.kontrak_id);
  if (Number.isNaN(kontrakId)) throw new CnError(400, "kontrak wajib dipilih", "kontrak_id");
  const hodSales = clean(input.hod_sales_key, 30);
  if (!hodSales || !(HOD_SALES_KEYS as readonly string[]).includes(hodSales)) throw new CnError(400, `hod_sales_key harus salah satu: ${HOD_SALES_KEYS.join(", ")}`, "hod_sales_key");
  const hodBiz = clean(input.hod_business_key, 30);
  if (hodBiz && !(HOD_BUSINESS_KEYS as readonly string[]).includes(hodBiz)) throw new CnError(400, `hod_business_key harus salah satu: ${HOD_BUSINESS_KEYS.join(", ")}`, "hod_business_key");
  const ids = cekDaftarFaktur(input.invoice_ids);
  const catatan = clean(input.catatan);
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [k] = await t`SELECT id, customer_id, customer_name, jenis, tarif, periode_mulai::text AS periode_mulai, periode_selesai::text AS periode_selesai, status FROM cn_kontrak WHERE id = ${kontrakId} FOR SHARE`;
      if (!k) throw new CnError(404, "kontrak tidak ditemukan", "kontrak_id");
      if (k.status !== "aktif") throw new CnError(422, `kontrak berstatus ${String(k.status)}; hanya kontrak aktif yang bisa dipakai`, "kontrak_id");
      const kk = { customer_id: Number(k.customer_id), periode_mulai: String(k.periode_mulai), periode_selesai: String(k.periode_selesai) };
      const rows = await t`
        SELECT i.id AS invoice_id, i.number AS invoice_number, i.tanggal::text AS tanggal, i.customer_id,
               COALESCE(i.taxable_amount, 0) AS dpp, NULLIF(i.salesman_name, '') AS salesman_name,
               EXISTS (SELECT 1 FROM cn_pengajuan_item x WHERE x.invoice_id = i.id AND x.aktif) AS sudah_dicakup
        FROM accurate_invoice i WHERE i.id = ANY(${ids}::bigint[])`;
      const byId = new Map(rows.map((r) => [Number(r.invoice_id), mapFaktur(r)]));
      const fakturs = ids.map((id) => cekFakturKontrak(byId.get(id), kk, id));
      const dpp = fakturs.map((f) => Math.round(f.dpp));
      const nilai = hitungNilaiCn(k.jenis as CnJenis, Number(k.tarif), dpp);
      const totalDpp = dpp.reduce((a, b) => a + b, 0);
      const totalCn = nilai.reduce((a, b) => a + b, 0);
      const [p] = await t`
        INSERT INTO cn_pengajuan (kontrak_id, customer_id, customer_name, jenis, tarif, total_dpp, total_cn, hod_sales_key, hod_business_key, catatan, requested_by)
        VALUES (${kontrakId}, ${kk.customer_id}, ${String(k.customer_name)}, ${String(k.jenis)}, ${Number(k.tarif)}, ${totalDpp}, ${totalCn},
                ${hodSales}, ${hodBiz}, ${catatan}, ${oleh})
        RETURNING id, kode`;
      for (let i = 0; i < fakturs.length; i++) {
        const f = fakturs[i];
        await t`
          INSERT INTO cn_pengajuan_item (pengajuan_id, invoice_id, invoice_number, tanggal_invoice, salesman_name, dpp, nilai_cn)
          VALUES (${Number(p.id)}, ${f.invoice_id}, ${f.invoice_number}, ${f.tanggal}, ${f.salesman_name}, ${dpp[i]}, ${nilai[i]})`;
      }
      await t`INSERT INTO cn_event (pengajuan_id, dari, ke, oleh, catatan) VALUES (${Number(p.id)}, NULL, 'diajukan', ${oleh}, ${catatan})`;
      return { id: Number(p.id), kode: String(p.kode), total_cn: totalCn };
    });
  } catch (e) {
    // Balapan dua pengajuan atas faktur yang sama: indeks unik parsial yang menang.
    if (isUnique(e)) throw new CnError(409, "salah satu faktur baru saja dicakup pengajuan CN lain", "invoice_ids");
    throw e;
  }
}

export interface Ringkasan { total: number; per_status: Record<CnStatus, number>; total_cn_berjalan: number; total_cn_terealisasi: number }

export async function listPengajuan(filter: { status?: string | null; q?: string | null; customer_id?: number | null }): Promise<{ items: CnRow[]; ringkasan: Ringkasan }> {
  const sql = db();
  const st = CN_STATUS.includes(filter.status as CnStatus) ? (filter.status as CnStatus) : null;
  const like = filter.q?.trim() ? `%${filter.q.trim().slice(0, 100)}%` : null;
  const rows = await sql`
    SELECT ${CN_COLS(sql)} FROM cn_pengajuan
    WHERE true ${st ? sql`AND status = ${st}` : sql``} ${filter.customer_id ? sql`AND customer_id = ${filter.customer_id}` : sql``}
      ${like ? sql`AND (customer_name ILIKE ${like} OR kode ILIKE ${like})` : sql``}
    ORDER BY (status IN ('terealisasi', 'ditolak', 'dibatalkan')), created_at DESC LIMIT 500`;
  const items = rows.map(mapCn);
  const per_status = Object.fromEntries(CN_STATUS.map((x) => [x, 0])) as Record<CnStatus, number>;
  let berjalan = 0;
  let real = 0;
  for (const i of items) {
    per_status[i.status] += 1;
    if (i.status === "terealisasi") real += i.total_cn;
    else if (i.status !== "ditolak" && i.status !== "dibatalkan") berjalan += i.total_cn;
  }
  return { items, ringkasan: { total: items.length, per_status, total_cn_berjalan: berjalan, total_cn_terealisasi: real } };
}

export async function getPengajuan(id: number): Promise<(CnRow & { items: CnItem[]; events: CnEvent[] }) | null> {
  const sql = db();
  const [r] = await sql`SELECT ${CN_COLS(sql)} FROM cn_pengajuan WHERE id = ${id}`;
  if (!r) return null;
  const it = await sql`
    SELECT invoice_id, invoice_number, tanggal_invoice::text AS tanggal_invoice, salesman_name, dpp, nilai_cn
    FROM cn_pengajuan_item WHERE pengajuan_id = ${id} ORDER BY tanggal_invoice, invoice_id`;
  const ev = await sql`SELECT id, dari, ke, oleh, catatan, at::text AS at FROM cn_event WHERE pengajuan_id = ${id} ORDER BY id`;
  return {
    ...mapCn(r),
    items: it.map((x) => ({ invoice_id: Number(x.invoice_id), invoice_number: String(x.invoice_number), tanggal_invoice: String(x.tanggal_invoice), salesman_name: s(x.salesman_name), dpp: Number(x.dpp), nilai_cn: Number(x.nilai_cn) })),
    events: ev.map((e) => ({ id: Number(e.id), dari: (e.dari as CnStatus | null) ?? null, ke: e.ke as CnStatus, oleh: s(e.oleh), catatan: s(e.catatan), at: String(e.at) })),
  };
}

/**
 * Pindah status. Baris dikunci FOR UPDATE → dua klik bersamaan: yang kedua melihat status baru → 409.
 * Ditolak/dibatalkan melepas faktur (aktif=false) supaya bisa diajukan ulang.
 */
export async function pindahStatus(
  id: number,
  input: { ke?: unknown; bukti_url?: unknown; tanggal_realisasi?: unknown; catatan?: unknown },
  oleh: string | null,
): Promise<{ status: CnStatus }> {
  if (!oleh) throw new CnError(400, "pelaku (oleh) wajib ada", "oleh");
  const sql = db();
  return await sql.begin(async (tx) => {
    const [cur] = await tx`SELECT status, hod_business_key FROM cn_pengajuan WHERE id = ${id} FOR UPDATE`;
    if (!cur) throw new CnError(404, "pengajuan CN tidak ditemukan");
    const dari = cur.status as CnStatus;
    const p = cekPindah(dari, input.ke, { hod_business_key: s(cur.hod_business_key) }, input, wibDate());
    await tx`
      UPDATE cn_pengajuan SET status = ${p.ke}, updated_at = now(),
        bukti_url = COALESCE(${p.bukti_url}, bukti_url),
        tanggal_realisasi = COALESCE(${p.tanggal_realisasi}::date, tanggal_realisasi)
      WHERE id = ${id}`;
    if (p.ke === "ditolak" || p.ke === "dibatalkan") await tx`UPDATE cn_pengajuan_item SET aktif = false WHERE pengajuan_id = ${id}`;
    await tx`INSERT INTO cn_event (pengajuan_id, dari, ke, oleh, catatan) VALUES (${id}, ${dari}, ${p.ke}, ${oleh}, ${p.catatan})`;
    return { status: p.ke };
  });
}

export interface LaporanBaris { kunci: string; label: string; jumlah_pengajuan: number; total_dpp: number; total_cn: number; total_terealisasi: number }

/**
 * Laporan CN (SOP 5) + pembagian CN (SOP 6): agregat per customer dan per sales (salesman faktur).
 * Pengajuan ditolak/dibatalkan tidak dihitung. `periode` memfilter tanggal faktur (YYYY-MM-DD..YYYY-MM-DD).
 */
export async function laporan(filter: { dari?: string | null; sampai?: string | null }): Promise<{ per_customer: LaporanBaris[]; per_sales: LaporanBaris[] }> {
  const dari = filter.dari && tglSah(filter.dari) ? filter.dari : null;
  const sampai = filter.sampai && tglSah(filter.sampai) ? filter.sampai : null;
  const sql = db();
  const rentang = sql`${dari ? sql`AND it.tanggal_invoice >= ${dari}` : sql``} ${sampai ? sql`AND it.tanggal_invoice <= ${sampai}` : sql``}`;
  const peta = (r: Record<string, unknown>): LaporanBaris => ({
    kunci: String(r.kunci), label: String(r.label), jumlah_pengajuan: Number(r.jumlah_pengajuan), total_dpp: Number(r.total_dpp),
    total_cn: Number(r.total_cn), total_terealisasi: Number(r.total_terealisasi),
  });
  const pc = await sql`
    SELECT p.customer_id::text AS kunci, p.customer_name AS label, COUNT(DISTINCT p.id) AS jumlah_pengajuan,
           SUM(it.dpp) AS total_dpp, SUM(it.nilai_cn) AS total_cn,
           COALESCE(SUM(it.nilai_cn) FILTER (WHERE p.status = 'terealisasi'), 0) AS total_terealisasi
    FROM cn_pengajuan p JOIN cn_pengajuan_item it ON it.pengajuan_id = p.id
    WHERE p.status NOT IN ('ditolak', 'dibatalkan') ${rentang}
    GROUP BY p.customer_id, p.customer_name ORDER BY SUM(it.nilai_cn) DESC`;
  const ps = await sql`
    SELECT COALESCE(it.salesman_name, '(tanpa sales)') AS kunci, COALESCE(it.salesman_name, '(tanpa sales)') AS label,
           COUNT(DISTINCT p.id) AS jumlah_pengajuan, SUM(it.dpp) AS total_dpp, SUM(it.nilai_cn) AS total_cn,
           COALESCE(SUM(it.nilai_cn) FILTER (WHERE p.status = 'terealisasi'), 0) AS total_terealisasi
    FROM cn_pengajuan p JOIN cn_pengajuan_item it ON it.pengajuan_id = p.id
    WHERE p.status NOT IN ('ditolak', 'dibatalkan') ${rentang}
    GROUP BY COALESCE(it.salesman_name, '(tanpa sales)') ORDER BY SUM(it.nilai_cn) DESC`;
  return { per_customer: pc.map(peta), per_sales: ps.map(peta) };
}
