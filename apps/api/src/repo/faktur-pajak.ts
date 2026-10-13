// F27 Faktur Pajak / CoreTax Workflow — migrasi 215.
//
// Tracker langkah Faktur Pajak (FP) per invoice penjualan: diminta → diinput_coretax → disetujui
// → selesai (bukti). FP-nya sendiri dibuat di CoreTax (DJP); sistem ini hanya melacak langkahnya.
//
// Dua bagian, sengaja dipisah:
//   1. LOGIKA MURNI (masaPajak, batasTerbit, bolehPindah, cekPindah, terlambat) — tanpa DB, diuji di faktur-pajak.test.ts.
//   2. AKSES DB — merakit data lalu menyerahkannya ke (1).
//
// Keputusan desain (tercatat di docs/features/F27-faktur-pajak-coretax.md):
//   - Sumber = accurate_invoice (tax_amount > 0). DPP/PPN di-SNAPSHOT apa adanya, tak dihitung ulang.
//   - Satu invoice = satu FP aktif (indeks unik parsial); dibatalkan boleh diminta ulang.
//   - Perpindahan status satu langkah; mundur & batal wajib beralasan; semua tercatat di faktur_pajak_event.
//   - Gerbang izin di BFF (kunci menu "faktur-pajak": create = ajukan, edit = geser status), seperti F34.

import { db } from "../db.js";

type Sql = ReturnType<typeof db>;

// ── Konstanta ────────────────────────────────────────────────────────────────
export const FP_STATUS = ["diminta", "diinput_coretax", "disetujui", "selesai", "dibatalkan"] as const;
export type FpStatus = (typeof FP_STATUS)[number];

/** Batas penerbitan FP: tanggal ini pada bulan SESUDAH masa pajak (UU PPN pasal 13: paling lambat tgl 15 bulan berikutnya). */
export const BATAS_TERBIT_TANGGAL = 15;
/** Invoice kandidat dibatasi sekian bulan ke belakang (lewat itu pasti sudah lewat batas terbit). */
export const KANDIDAT_BULAN = 4;
export const KANDIDAT_LIMIT = 200;
const TEXT_MAX = 500;
const NOMOR_FP_RE = /^[0-9.\-]{10,25}$/;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export class FakturPajakError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 422,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const wibDate = (now = Date.now()): string => new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);

// ── 1. Logika murni ──────────────────────────────────────────────────────────

/** "2026-09-30" → "2026-09". */
export const masaPajak = (tanggal: string): string => tanggal.slice(0, 7);

/** Tgl 15 bulan sesudah masa pajak. Desember → 15 Januari tahun berikutnya. */
export function batasTerbit(tanggal: string): string {
  const [y, m] = tanggal.slice(0, 7).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(BATAS_TERBIT_TANGGAL).padStart(2, "0")}`;
}

/** FP terlambat = belum selesai/dibatalkan DAN hari ini (WIB) lewat batas terbit. */
export function terlambat(r: { status: FpStatus; batas_terbit: string }, today: string): boolean {
  return r.status !== "selesai" && r.status !== "dibatalkan" && r.batas_terbit < today;
}

/** Peta perpindahan: maju satu langkah, mundur satu langkah, atau batal. selesai & dibatalkan final. */
const PINDAH: Record<FpStatus, readonly FpStatus[]> = {
  diminta: ["diinput_coretax", "dibatalkan"],
  diinput_coretax: ["disetujui", "diminta", "dibatalkan"],
  disetujui: ["selesai", "diinput_coretax", "dibatalkan"],
  selesai: [],
  dibatalkan: [],
};
export const bolehPindah = (dari: FpStatus, ke: FpStatus): boolean => PINDAH[dari].includes(ke);

const URUTAN: Record<FpStatus, number> = { diminta: 0, diinput_coretax: 1, disetujui: 2, selesai: 3, dibatalkan: -1 };

const clean = (v: unknown, max = TEXT_MAX): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/** Nomor FP: angka dengan pemisah titik/strip, 10–25 karakter. Sengaja longgar — format resmi CoreTax
 *  berubah dari e-Faktur; keunikan dijaga indeks, bukan regex. */
export function cekNomorFp(v: unknown): string {
  const s = clean(v, 40);
  if (!s) throw new FakturPajakError(400, "nomor_fp wajib diisi untuk menyetujui", "nomor_fp");
  if (!NOMOR_FP_RE.test(s)) throw new FakturPajakError(400, "nomor_fp harus 10–25 karakter angka (boleh titik/strip)", "nomor_fp");
  return s;
}

/** Bukti = tautan https (Drive/penyimpanan). Belum ada penyimpanan berkas di sistem ini. */
export function cekBuktiUrl(v: unknown): string {
  const s = clean(v, 1000);
  if (!s) throw new FakturPajakError(400, "bukti_url wajib diisi untuk menyelesaikan", "bukti_url");
  try {
    if (new URL(s).protocol !== "https:") throw new Error("bukan https");
  } catch {
    throw new FakturPajakError(400, "bukti_url harus tautan https yang sah", "bukti_url");
  }
  return s;
}

export interface PindahInput { nomor_fp: string | null; bukti_url: string | null; catatan: string | null }

/** Validasi satu perpindahan status; mengembalikan input yang sudah dibersihkan. Melempar FakturPajakError. */
export function cekPindah(dari: FpStatus, ke: unknown, body: { nomor_fp?: unknown; bukti_url?: unknown; catatan?: unknown }): { ke: FpStatus } & PindahInput {
  if (!FP_STATUS.includes(ke as FpStatus)) throw new FakturPajakError(400, `ke harus salah satu: ${FP_STATUS.join(", ")}`, "ke");
  const tujuan = ke as FpStatus;
  if (!bolehPindah(dari, tujuan)) throw new FakturPajakError(409, `tidak bisa pindah dari ${dari} ke ${tujuan}`);
  const catatan = clean(body.catatan);
  const mundur = tujuan !== "dibatalkan" && URUTAN[tujuan] < URUTAN[dari];
  if ((tujuan === "dibatalkan" || mundur) && !catatan) throw new FakturPajakError(400, "alasan wajib diisi untuk membatalkan/mengembalikan status", "catatan");
  return {
    ke: tujuan,
    nomor_fp: tujuan === "disetujui" ? cekNomorFp(body.nomor_fp) : null,
    bukti_url: tujuan === "selesai" ? cekBuktiUrl(body.bukti_url) : null,
    catatan,
  };
}

// ── 2. Akses DB ──────────────────────────────────────────────────────────────

export interface FpRow {
  id: number; invoice_id: number; invoice_number: string; customer_id: number | null; customer_name: string | null;
  customer_npwp: string | null; tanggal_invoice: string; dpp: number; ppn: number; masa_pajak: string; batas_terbit: string;
  status: FpStatus; nomor_fp: string | null; bukti_url: string | null; catatan: string | null; requested_by: string | null;
  created_at: string; updated_at: string; terlambat: boolean;
}
export interface FpEvent { id: number; dari: FpStatus | null; ke: FpStatus; oleh: string | null; catatan: string | null; at: string }

const FP_COLS = (sql: Sql) => sql`
  id, invoice_id, invoice_number, customer_id, customer_name, customer_npwp, tanggal_invoice::text AS tanggal_invoice,
  dpp, ppn, masa_pajak, batas_terbit::text AS batas_terbit, status, nomor_fp, bukti_url, catatan, requested_by,
  created_at::text AS created_at, updated_at::text AS updated_at`;

const s = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

const mapRow = (r: Record<string, unknown>, today: string): FpRow => ({
  id: Number(r.id), invoice_id: Number(r.invoice_id), invoice_number: String(r.invoice_number),
  customer_id: r.customer_id == null ? null : Number(r.customer_id), customer_name: s(r.customer_name), customer_npwp: s(r.customer_npwp),
  tanggal_invoice: String(r.tanggal_invoice), dpp: Number(r.dpp), ppn: Number(r.ppn), masa_pajak: String(r.masa_pajak),
  batas_terbit: String(r.batas_terbit), status: r.status as FpStatus, nomor_fp: s(r.nomor_fp), bukti_url: s(r.bukti_url),
  catatan: s(r.catatan), requested_by: s(r.requested_by), created_at: String(r.created_at), updated_at: String(r.updated_at),
  terlambat: terlambat({ status: r.status as FpStatus, batas_terbit: String(r.batas_terbit) }, today),
});

export interface Ringkasan { total: number; per_status: Record<FpStatus, number>; terlambat: number }

export async function listFp(filter: { status?: string | null; masa?: string | null; q?: string | null }): Promise<{ items: FpRow[]; ringkasan: Ringkasan }> {
  const sql = db();
  const today = wibDate();
  const st = FP_STATUS.includes(filter.status as FpStatus) ? (filter.status as FpStatus) : null;
  const masa = filter.masa && /^\d{4}-(0[1-9]|1[0-2])$/.test(filter.masa) ? filter.masa : null;
  const q = filter.q?.trim() ? `%${filter.q.trim().slice(0, 100)}%` : null;
  const rows = await sql`
    SELECT ${FP_COLS(sql)} FROM faktur_pajak
    WHERE true ${st ? sql`AND status = ${st}` : sql``} ${masa ? sql`AND masa_pajak = ${masa}` : sql``}
      ${q ? sql`AND (invoice_number ILIKE ${q} OR customer_name ILIKE ${q} OR nomor_fp ILIKE ${q})` : sql``}
    ORDER BY (status IN ('selesai','dibatalkan')), batas_terbit, id DESC`;
  const items = rows.map((r) => mapRow(r, today));
  const per_status = Object.fromEntries(FP_STATUS.map((x) => [x, 0])) as Record<FpStatus, number>;
  for (const i of items) per_status[i.status] += 1;
  return { items, ringkasan: { total: items.length, per_status, terlambat: items.filter((i) => i.terlambat).length } };
}

export async function getFp(id: number): Promise<(FpRow & { events: FpEvent[] }) | null> {
  const sql = db();
  const [r] = await sql`SELECT ${FP_COLS(sql)} FROM faktur_pajak WHERE id = ${id}`;
  if (!r) return null;
  const ev = await sql`SELECT id, dari, ke, oleh, catatan, at::text AS at FROM faktur_pajak_event WHERE fp_id = ${id} ORDER BY id`;
  return {
    ...mapRow(r, wibDate()),
    events: ev.map((e) => ({ id: Number(e.id), dari: (e.dari as FpStatus | null) ?? null, ke: e.ke as FpStatus, oleh: s(e.oleh), catatan: s(e.catatan), at: String(e.at) })),
  };
}

export interface Kandidat {
  invoice_id: number; invoice_number: string; tanggal: string; customer_name: string | null; customer_npwp: string | null;
  dpp: number; ppn: number; batas_terbit: string; terlambat: boolean;
}

// Nama customer: kolom mirror bisa '' (bukan NULL) → NULLIF sebelum COALESCE (CLAUDE.md).
const CUST_NAME = (sql: Sql) => sql`COALESCE(NULLIF(c.name, ''), NULLIF(i.raw->'customer'->>'name', ''), NULLIF(i.raw->>'retailWpName', ''))`;
const CUST_NPWP = (sql: Sql) => sql`NULLIF(btrim(COALESCE(c.raw->>'npwpNo', '')), '')`;

/** Invoice ber-PPN dalam KANDIDAT_BULAN terakhir yang belum punya FP aktif, terlama dulu (paling mendesak). */
export async function listKandidat(q: string | null): Promise<Kandidat[]> {
  const sql = db();
  const today = wibDate();
  const like = q?.trim() ? `%${q.trim().slice(0, 100)}%` : null;
  const rows = await sql`
    SELECT i.id AS invoice_id, i.number AS invoice_number, i.tanggal::text AS tanggal, ${CUST_NAME(sql)} AS customer_name,
           ${CUST_NPWP(sql)} AS customer_npwp, i.taxable_amount AS dpp, i.tax_amount AS ppn
    FROM accurate_invoice i LEFT JOIN accurate_customer c ON c.id = i.customer_id
    WHERE COALESCE(i.tax_amount, 0) > 0 AND i.tanggal IS NOT NULL
      AND i.tanggal >= (${today}::date - make_interval(months => ${KANDIDAT_BULAN}))
      AND NOT EXISTS (SELECT 1 FROM faktur_pajak f WHERE f.invoice_id = i.id AND f.status <> 'dibatalkan')
      ${like ? sql`AND (i.number ILIKE ${like} OR ${CUST_NAME(sql)} ILIKE ${like})` : sql``}
    ORDER BY i.tanggal, i.id LIMIT ${KANDIDAT_LIMIT}`;
  return rows.map((r) => {
    const bt = batasTerbit(String(r.tanggal));
    return {
      invoice_id: Number(r.invoice_id), invoice_number: String(r.invoice_number ?? ""), tanggal: String(r.tanggal),
      customer_name: s(r.customer_name), customer_npwp: s(r.customer_npwp), dpp: Number(r.dpp ?? 0), ppn: Number(r.ppn ?? 0),
      batas_terbit: bt, terlambat: bt < today,
    };
  });
}

const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === "23505";

/** Ajukan FP untuk satu invoice. Snapshot dari mirror Accurate; transaksi: baris + event awal. */
export async function requestFp(
  input: { invoice_id?: unknown; customer_npwp?: unknown; catatan?: unknown },
  oleh: string | null,
): Promise<{ id: number }> {
  if (!oleh) throw new FakturPajakError(400, "pelaku (oleh) wajib ada", "oleh");
  const invoiceId = typeof input.invoice_id === "number" ? input.invoice_id : /^\d{1,15}$/.test(String(input.invoice_id ?? "")) ? Number(input.invoice_id) : NaN;
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new FakturPajakError(400, "invoice_id tidak valid", "invoice_id");
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [inv] = await t`
        SELECT i.id, i.number, i.customer_id, i.tanggal::text AS tanggal, i.taxable_amount, i.tax_amount,
               ${CUST_NAME(t)} AS customer_name, ${CUST_NPWP(t)} AS customer_npwp
        FROM accurate_invoice i LEFT JOIN accurate_customer c ON c.id = i.customer_id WHERE i.id = ${invoiceId}`;
      if (!inv) throw new FakturPajakError(404, "invoice tidak ditemukan");
      if (!(Number(inv.tax_amount ?? 0) > 0) || !inv.tanggal) throw new FakturPajakError(422, "invoice tanpa PPN tidak perlu faktur pajak");
      const tanggal = String(inv.tanggal);
      const [row] = await t`
        INSERT INTO faktur_pajak (invoice_id, invoice_number, customer_id, customer_name, customer_npwp, tanggal_invoice,
                                  dpp, ppn, masa_pajak, batas_terbit, catatan, requested_by)
        VALUES (${invoiceId}, ${String(inv.number ?? "")}, ${inv.customer_id ?? null}, ${s(inv.customer_name)},
                ${clean(input.customer_npwp, 40) ?? s(inv.customer_npwp)}, ${tanggal},
                ${Number(inv.taxable_amount ?? 0)}, ${Number(inv.tax_amount)}, ${masaPajak(tanggal)}, ${batasTerbit(tanggal)},
                ${clean(input.catatan)}, ${oleh})
        RETURNING id`;
      await t`INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh, catatan) VALUES (${Number(row.id)}, NULL, 'diminta', ${oleh}, ${clean(input.catatan)})`;
      return { id: Number(row.id) };
    });
  } catch (e) {
    if (isUnique(e)) throw new FakturPajakError(409, "invoice ini sudah punya faktur pajak aktif");
    throw e;
  }
}

/** Ubah NPWP/catatan selama FP belum disetujui (angka & invoice tak bisa diubah). */
export async function updateFp(id: number, input: { customer_npwp?: unknown; catatan?: unknown }): Promise<{ ok: true }> {
  const patch: Record<string, string | null> = {};
  if (input.customer_npwp !== undefined) patch.customer_npwp = clean(input.customer_npwp, 40);
  if (input.catatan !== undefined) patch.catatan = clean(input.catatan);
  const keys = Object.keys(patch);
  if (!keys.length) throw new FakturPajakError(400, "tidak ada field yang diubah");
  const sql = db();
  const rows = await sql`
    UPDATE faktur_pajak SET ${sql(patch, ...keys)}, updated_at = now()
    WHERE id = ${id} AND status IN ('diminta','diinput_coretax') RETURNING id`;
  if (rows.length) return { ok: true };
  const [x] = await sql`SELECT status FROM faktur_pajak WHERE id = ${id}`;
  if (!x) throw new FakturPajakError(404, "faktur pajak tidak ditemukan");
  throw new FakturPajakError(409, `data tidak bisa diubah pada status ${String(x.status)}`);
}

/** Pindah status satu langkah. Baris dikunci (FOR UPDATE) → dua klik bersamaan: yang kedua melihat status baru → 409. */
export async function pindahStatus(
  id: number,
  input: { ke?: unknown; nomor_fp?: unknown; bukti_url?: unknown; catatan?: unknown },
  oleh: string | null,
): Promise<{ status: FpStatus }> {
  if (!oleh) throw new FakturPajakError(400, "pelaku (oleh) wajib ada", "oleh");
  const sql = db();
  try {
    return await sql.begin(async (tx) => {
      const [cur] = await tx`SELECT status FROM faktur_pajak WHERE id = ${id} FOR UPDATE`;
      if (!cur) throw new FakturPajakError(404, "faktur pajak tidak ditemukan");
      const dari = cur.status as FpStatus;
      const p = cekPindah(dari, input.ke, input);
      // Nomor/bukti hanya ditulis pada langkah yang memintanya; langkah lain membiarkan nilai lama.
      await tx`
        UPDATE faktur_pajak SET status = ${p.ke}, updated_at = now(),
          nomor_fp  = COALESCE(${p.nomor_fp}, nomor_fp),
          bukti_url = COALESCE(${p.bukti_url}, bukti_url)
        WHERE id = ${id}`;
      await tx`INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh, catatan) VALUES (${id}, ${dari}, ${p.ke}, ${oleh}, ${p.catatan})`;
      return { status: p.ke };
    });
  } catch (e) {
    if (isUnique(e)) throw new FakturPajakError(409, "nomor_fp sudah dipakai faktur pajak lain", "nomor_fp");
    throw e;
  }
}
