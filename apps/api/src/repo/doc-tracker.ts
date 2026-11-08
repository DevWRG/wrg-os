// DOC — Document Tracker 7-state machine (baca + checklist + tautan faktur). Aturan state ada di
// doc-tracker-state.ts (murni, diuji). Di sini: memuat bukti dari mirror Accurate + shipment_tracking +
// installation_unit + arsip_dokumen. Stempel Review/Approved DIHAPUS (8 Nov 2026) — doc_tracker_stamp
// (migrasi 258) tak lagi dibaca/ditulis; datanya dibiarkan, bisa di-drop kelak.
//
// Unit = satu Sales Order Accurate (accurate_sales_order). SO↔SJ lewat accurate_delivery_order_item.
// sales_order_id; SJ↔pengiriman lewat shipment_tracking.sj_number (nomor DO kanonik, tak peka huruf);
// SJ↔instalasi lewat installation_unit.sj_number (BAST Instalasi = Executed); SJ/faktur↔arsip lewat
// arsip_dokumen.ref_sj / ref_faktur (centang otomatis checklist dokumen).
// Faktur↔SO: gabungan tautan OTOMATIS (accurate_invoice_so, migrasi 296 — diturunkan trigger dari
// detailItem[].salesOrderId faktur Accurate; raw tak pernah dibaca di sini) dan tautan MANUAL
// (doc_tracker_faktur) untuk faktur tanpa rujukan SO. Tautan tak pernah ditebak dari nama customer/tanggal.
// Mirror SO hanya ±500 terbaru (by design) → transaksi lama tak tampil.

import { db } from "../db.js";
import { deriveInvoiceStatus } from "./ar.js";
import {
  DOKUMEN_WAJIB,
  JENIS_DOKUMEN,
  STATES,
  dokumenDariArsip,
  gabungDokumen,
  hariBillingRisiko,
  hitungState,
  kunciNomor,
  type ArsipRujukan,
  type DocState,
  type FakturBukti,
  type HasilState,
  type JenisDokumen,
  type SjBukti,
  type Snapshot,
} from "./doc-tracker-state.js";

export class DocTrackerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const HARI_DEFAULT = 120;
export const HARI_MAKS = 365;
const BATAS_SO = 500;

const wibToday = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | Date).toISOString());

export function parseHari(v: string | undefined): number {
  if (v == null || v === "") return HARI_DEFAULT;
  const n = Number(v);
  // Hanya digit: Number() menerima "1e3" / "0x10" sebagai bilangan bulat.
  if (!/^\d{1,6}$/.test(v) || n < 1 || n > HARI_MAKS) throw new DocTrackerError(400, `hari harus bilangan bulat 1–${HARI_MAKS}`);
  return n;
}
export function parseState(v: string | undefined): DocState | null {
  if (!v) return null;
  if (!(STATES as readonly string[]).includes(v)) throw new DocTrackerError(400, `state tidak dikenal (${STATES.join(", ")})`);
  return v as DocState;
}
export function parseSoId(v: string | undefined): number {
  if (!/^\d{1,15}$/.test(v ?? "")) throw new DocTrackerError(400, "id SO tidak valid");
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new DocTrackerError(400, "id SO tidak valid");
  return n;
}

export interface DocRow {
  so_id: number;
  so_number: string;
  tanggal: string;
  customer: string;
  total: number | null;
  state: DocState;
  umur_hari: number | null;
  anomali: string[];
  dokumen_kurang: JenisDokumen[];
  billing_risiko: boolean;
  dikirim_belum_dibayar: boolean;
  belum_tercatat: DocState[];
  hitungan: HasilState["hitungan"];
}

export interface DocTrackerList {
  asOf: string;
  hari: number;
  hari_billing_risiko: number;
  funnel: Record<DocState, number>;
  ringkas: { total: number; anomali: number; billing_risiko: number; dikirim_belum_dibayar: number };
  rows: DocRow[];
}

interface Bundle {
  snapshots: Map<number, Snapshot>;
  sj: Map<number, SjBukti[]>;
  faktur: Map<number, FakturTaut[]>;
  /** Jenis dokumen tercentang otomatis dari Arsip F156 → nomor arsip sumbernya. */
  arsip: Map<number, Partial<Record<JenisDokumen, string[]>>>;
}

type FakturTaut = FakturBukti & { invoice_id: number; otomatis: boolean };

// installation_unit (migrasi 130) & arsip_dokumen (279) milik fitur lain — bila tabelnya belum ada
// (mis. saat tracker dipromosikan ke cabang yang belum punya fitur itu) sumbernya dilewati, bukan 503.
// Hanya hasil "ada" yang di-cache: tabel tak akan hilang setelah dibuat.
const tabelAda = new Set<string>();
async function cekTabel(): Promise<{ instalasi: boolean; arsip: boolean }> {
  if (!(tabelAda.has("installation_unit") && tabelAda.has("arsip_dokumen"))) {
    const [r] = await db()`
      SELECT to_regclass('installation_unit') IS NOT NULL AS instalasi, to_regclass('arsip_dokumen') IS NOT NULL AS arsip`;
    if (r?.instalasi) tabelAda.add("installation_unit");
    if (r?.arsip) tabelAda.add("arsip_dokumen");
  }
  return { instalasi: tabelAda.has("installation_unit"), arsip: tabelAda.has("arsip_dokumen") };
}

/** Muat semua bukti untuk daftar SO sekaligus (kueri per sumber untuk SELURUH daftar, bukan per-SO). */
async function muatBukti(so: { id: number; trans_date: string }[], today: string): Promise<Bundle> {
  const sql = db();
  const ids = so.map((s) => s.id);
  const snapshots = new Map<number, Snapshot>();
  const sjMap = new Map<number, SjBukti[]>();
  const fakMap = new Map<number, FakturTaut[]>();
  const arsipMap = new Map<number, Partial<Record<JenisDokumen, string[]>>>();
  if (!ids.length) return { snapshots, sj: sjMap, faktur: fakMap, arsip: arsipMap };

  const [ada, dok, sjRows, fakRows] = await Promise.all([
    cekTabel(),
    sql`SELECT so_id, jenis, ada FROM doc_tracker_dokumen WHERE so_id = ANY(${ids}::bigint[])`,
    sql`
      SELECT x.so_id, x.nomor, x.tanggal, st.kirim_at, st.terima_at, st.bast_at
      FROM (SELECT DISTINCT dei.sales_order_id AS so_id, d.number AS nomor, d.trans_date::text AS tanggal
            FROM accurate_delivery_order_item dei JOIN accurate_delivery_order d ON d.id = dei.delivery_id
            WHERE dei.sales_order_id = ANY(${ids}::bigint[])) x
      LEFT JOIN LATERAL (
        SELECT kirim_at, terima_at, bast_at FROM shipment_tracking
        WHERE lower(sj_number) = lower(x.nomor) ORDER BY created_at DESC LIMIT 1
      ) st ON true`,
    // Manual ∪ otomatis, satu baris per (SO, faktur); otomatis menang bila keduanya ada.
    sql`
      SELECT l.so_id, ai.id AS invoice_id, ai.number, ai.tanggal::text AS tanggal, ai.status, ai.outstanding::float8 AS outstanding,
             ai.lunas_at::text AS lunas_at, bool_or(l.otomatis) AS otomatis
      FROM (SELECT so_id, invoice_id, false AS otomatis FROM doc_tracker_faktur WHERE so_id = ANY(${ids}::bigint[])
            UNION ALL
            SELECT so_id, invoice_id, true FROM accurate_invoice_so WHERE so_id = ANY(${ids}::bigint[])) l
      JOIN accurate_invoice ai ON ai.id = l.invoice_id
      GROUP BY l.so_id, ai.id`,
  ]);

  // Tahap kedua: sumber yang dicocokkan lewat NOMOR SJ/faktur (sekali untuk seluruh daftar).
  const sjKunci = [...new Set(sjRows.map((r) => kunciNomor(String(r.nomor))).filter(Boolean))];
  const fakKunci = [...new Set(fakRows.map((r) => kunciNomor(String(r.number))).filter(Boolean))];
  const [instRows, arsipRows] = await Promise.all([
    ada.instalasi && sjKunci.length
      ? // installation_unit.sj_number bisa ketikan lama (migrasi 159) → dipangkas di sini; tabelnya kecil.
        sql`
          SELECT upper(btrim(sj_number)) AS kunci, min(coalesce(bast_at, updated_at)) AS bast_at
          FROM installation_unit
          WHERE bast_done AND upper(btrim(sj_number)) = ANY(${sjKunci}::text[])
          GROUP BY 1`
      : Promise.resolve([]),
    ada.arsip && (sjKunci.length || fakKunci.length)
      ? // ref_* arsip sudah dipangkas saat simpan (arsip-dokumen.ts teks()) → upper() saja agar indeks upper(ref_*) terpakai.
        sql`
          SELECT nomor, buku_kode, ref_sj, ref_po, ref_faktur
          FROM arsip_dokumen
          WHERE dihapus_at IS NULL
            AND (upper(ref_sj) = ANY(${sjKunci}::text[]) OR upper(ref_faktur) = ANY(${fakKunci}::text[]))`
      : Promise.resolve([]),
  ]);

  const instBy = new Map<string, string>();
  for (const r of instRows) if (r.bast_at) instBy.set(String(r.kunci), iso(r.bast_at)!);
  const arsipList: ArsipRujukan[] = arsipRows.map((r) => ({
    nomor: String(r.nomor), buku_kode: String(r.buku_kode),
    ref_sj: (r.ref_sj as string | null) ?? null, ref_po: (r.ref_po as string | null) ?? null, ref_faktur: (r.ref_faktur as string | null) ?? null,
  }));

  const dokBy = new Map<number, Partial<Record<JenisDokumen, boolean>>>();
  for (const r of dok) {
    const m = dokBy.get(Number(r.so_id)) ?? {};
    m[String(r.jenis) as JenisDokumen] = Boolean(r.ada);
    dokBy.set(Number(r.so_id), m);
  }
  for (const r of sjRows) {
    const a = sjMap.get(Number(r.so_id)) ?? [];
    a.push({
      nomor: String(r.nomor), tanggal: (r.tanggal as string | null) ?? null, kirimAt: iso(r.kirim_at), terimaAt: iso(r.terima_at), bastAt: iso(r.bast_at),
      bastInstalasiAt: instBy.get(kunciNomor(String(r.nomor))) ?? null,
    });
    sjMap.set(Number(r.so_id), a);
  }
  for (const r of fakRows) {
    const a = fakMap.get(Number(r.so_id)) ?? [];
    const st = deriveInvoiceStatus({ status: r.status as string | null, outstanding: Number(r.outstanding) || 0 }, null, today);
    a.push({ invoice_id: Number(r.invoice_id), nomor: String(r.number), tanggal: String(r.tanggal), lunas: st.state === "PAID", lunasAt: (r.lunas_at as string | null) ?? null, otomatis: Boolean(r.otomatis) });
    fakMap.set(Number(r.so_id), a);
  }

  for (const s of so) {
    const sj = sjMap.get(s.id) ?? [];
    const faktur = fakMap.get(s.id) ?? [];
    const dariArsip = arsipList.length ? dokumenDariArsip(sj.map((x) => x.nomor), faktur.map((f) => f.nomor), arsipList) : {};
    arsipMap.set(s.id, dariArsip);
    snapshots.set(s.id, {
      soTanggal: s.trans_date,
      sj,
      faktur,
      dokumen: gabungDokumen(dokBy.get(s.id) ?? {}, dariArsip),
      today,
    });
  }
  return { snapshots, sj: sjMap, faktur: fakMap, arsip: arsipMap };
}

const kosongFunnel = (): Record<DocState, number> => Object.fromEntries(STATES.map((s) => [s, 0])) as Record<DocState, number>;

export async function listDocTracker(opts: { hari?: number; state?: DocState | null; q?: string; billingRisiko?: boolean; dikirimBelumDibayar?: boolean } = {}): Promise<DocTrackerList> {
  const sql = db();
  const hari = opts.hari ?? HARI_DEFAULT;
  const today = wibToday();
  const q = (opts.q ?? "").trim();
  const so = await sql`
    SELECT id, number, trans_date::text AS trans_date, customer_name, total_amount::float8 AS total
    FROM accurate_sales_order
    WHERE trans_date >= ${today}::date - ${hari}::int
      ${q ? sql`AND (number ILIKE ${`%${q}%`} OR customer_name ILIKE ${`%${q}%`})` : sql``}
    ORDER BY trans_date DESC, id DESC
    LIMIT ${BATAS_SO}`;
  const header = so.map((r) => ({ id: Number(r.id), trans_date: String(r.trans_date) }));
  const { snapshots } = await muatBukti(header, today);

  const funnel = kosongFunnel();
  const semua: DocRow[] = so.map((r) => {
    const h = hitungState(snapshots.get(Number(r.id))!);
    funnel[h.state]++;
    return {
      so_id: Number(r.id),
      so_number: String(r.number),
      tanggal: String(r.trans_date),
      customer: String(r.customer_name ?? ""),
      total: r.total == null ? null : Number(r.total),
      state: h.state,
      umur_hari: h.umurHari,
      anomali: h.anomali,
      dokumen_kurang: h.dokumenKurang,
      billing_risiko: h.billingRisiko,
      // Cross-check inti rapat: sudah dikirim (SJ/DO terbit = Sent) tetapi belum lunas.
      dikirim_belum_dibayar: h.tahap.sent.selesai && !h.tahap.paid.selesai,
      belum_tercatat: h.belumTercatat,
      hitungan: h.hitungan,
    };
  });
  const ringkas = {
    total: semua.length,
    anomali: semua.filter((r) => r.anomali.length > 0).length,
    billing_risiko: semua.filter((r) => r.billing_risiko).length,
    dikirim_belum_dibayar: semua.filter((r) => r.dikirim_belum_dibayar).length,
  };
  const rows = semua.filter(
    (r) => (!opts.state || r.state === opts.state) && (!opts.billingRisiko || r.billing_risiko) && (!opts.dikirimBelumDibayar || r.dikirim_belum_dibayar),
  );
  return { asOf: today, hari, hari_billing_risiko: hariBillingRisiko(), funnel, ringkas, rows };
}

export interface DocDetail {
  so: { id: number; number: string; tanggal: string; customer: string; customer_id: number | null; total: number | null; status: string | null };
  hasil: HasilState;
  sj: SjBukti[];
  /** otomatis = dari rujukan SO di faktur Accurate (tak bisa dilepas); false = tautan manual. */
  faktur: { invoice_id: number; nomor: string; tanggal: string; lunas: boolean; otomatis: boolean }[];
  /** Centang MANUAL (doc_tracker_dokumen). Centang efektif = manual ATAU dokumen_arsip. */
  dokumen: Record<JenisDokumen, { ada: boolean; by: string; at: string } | null>;
  /** Jenis dokumen yang tercentang otomatis dari Arsip F156 → nomor arsip sumbernya (tak bisa dibatalkan manual). */
  dokumen_arsip: Partial<Record<JenisDokumen, string[]>>;
  dokumen_wajib: readonly JenisDokumen[];
  /** Faktur customer yang sama (180 hari) belum tertaut ke SO ini dan tanpa rujukan SO otomatis — kandidat tautan manual. */
  kandidat_faktur: { invoice_id: number; nomor: string; tanggal: string; total: number }[];
}

export async function getDocTracker(soId: number): Promise<DocDetail> {
  const sql = db();
  const [so] = await sql`
    SELECT id, number, trans_date::text AS trans_date, customer_name, customer_id, total_amount::float8 AS total, status
    FROM accurate_sales_order WHERE id = ${soId}`;
  if (!so) throw new DocTrackerError(404, "SO tidak ditemukan");
  const today = wibToday();
  const { snapshots, sj, faktur, arsip } = await muatBukti([{ id: soId, trans_date: String(so.trans_date) }], today);
  const [dok, kandidat] = await Promise.all([
    sql`SELECT jenis, ada, by, at FROM doc_tracker_dokumen WHERE so_id = ${soId}`,
    so.customer_id == null
      ? Promise.resolve([])
      : sql`
          SELECT ai.id AS invoice_id, ai.number, ai.tanggal::text AS tanggal, ai.total::float8 AS total
          FROM accurate_invoice ai
          WHERE ai.customer_id = ${so.customer_id} AND ai.tanggal >= ${String(so.trans_date)}::date - 7
            AND ai.tanggal >= ${today}::date - 180
            AND NOT EXISTS (SELECT 1 FROM doc_tracker_faktur l WHERE l.so_id = ${soId} AND l.invoice_id = ai.id)
            -- Faktur yang sudah membawa rujukan SO (ke SO mana pun) bukan kandidat: SO-nya sudah jelas dari Accurate.
            AND NOT EXISTS (SELECT 1 FROM accurate_invoice_so a WHERE a.invoice_id = ai.id)
          ORDER BY ai.tanggal DESC LIMIT 30`,
  ]);
  const dokumen = Object.fromEntries(JENIS_DOKUMEN.map((j) => [j, null])) as DocDetail["dokumen"];
  for (const r of dok) dokumen[String(r.jenis) as JenisDokumen] = { ada: Boolean(r.ada), by: String(r.by), at: new Date(r.at as string).toISOString() };
  return {
    so: { id: soId, number: String(so.number), tanggal: String(so.trans_date), customer: String(so.customer_name ?? ""), customer_id: so.customer_id == null ? null : Number(so.customer_id), total: so.total == null ? null : Number(so.total), status: (so.status as string | null) ?? null },
    hasil: hitungState(snapshots.get(soId)!),
    sj: sj.get(soId) ?? [],
    faktur: (faktur.get(soId) ?? []).map((f) => ({ invoice_id: f.invoice_id, nomor: f.nomor, tanggal: f.tanggal, lunas: f.lunas, otomatis: f.otomatis })),
    dokumen,
    dokumen_arsip: arsip.get(soId) ?? {},
    dokumen_wajib: DOKUMEN_WAJIB,
    kandidat_faktur: kandidat.map((r) => ({ invoice_id: Number(r.invoice_id), nomor: String(r.number), tanggal: String(r.tanggal), total: Number(r.total) || 0 })),
  };
}

async function pastikanSo(soId: number): Promise<void> {
  const [so] = await db()`SELECT 1 FROM accurate_sales_order WHERE id = ${soId}`;
  if (!so) throw new DocTrackerError(404, "SO tidak ditemukan");
}

const cleanBy = (by: string): string => {
  const b = (by ?? "").trim();
  if (!b) throw new DocTrackerError(400, "identitas pengguna kosong");
  return b.slice(0, 120);
};
const cleanCatatan = (c?: string | null): string | null => (c && c.trim() ? c.trim().slice(0, 500) : null);

export async function setDokumen(soId: number, jenis: string, ada: boolean, by: string, catatan?: string | null): Promise<void> {
  if (!(JENIS_DOKUMEN as readonly string[]).includes(jenis)) throw new DocTrackerError(400, `jenis dokumen tidak dikenal (${JENIS_DOKUMEN.join(", ")})`);
  await pastikanSo(soId);
  await db()`
    INSERT INTO doc_tracker_dokumen (so_id, jenis, ada, by, catatan) VALUES (${soId}, ${jenis}, ${ada}, ${cleanBy(by)}, ${cleanCatatan(catatan)})
    ON CONFLICT (so_id, jenis) DO UPDATE SET ada = EXCLUDED.ada, by = EXCLUDED.by, at = now(), catatan = EXCLUDED.catatan`;
}

export async function tautkanFaktur(soId: number, invoiceId: number, by: string): Promise<void> {
  const sql = db();
  const [so] = await sql`SELECT customer_id FROM accurate_sales_order WHERE id = ${soId}`;
  if (!so) throw new DocTrackerError(404, "SO tidak ditemukan");
  const [inv] = await sql`SELECT customer_id FROM accurate_invoice WHERE id = ${invoiceId}`;
  if (!inv) throw new DocTrackerError(404, "faktur tidak ditemukan");
  // Customer harus sama bila keduanya diketahui — tautan lintas customer hampir pasti salah pilih.
  if (so.customer_id != null && inv.customer_id != null && String(so.customer_id) !== String(inv.customer_id)) {
    throw new DocTrackerError(409, "faktur milik customer lain");
  }
  if (await tautOtomatis(soId, invoiceId)) throw new DocTrackerError(409, "faktur sudah tertaut otomatis dari Accurate");
  await sql`INSERT INTO doc_tracker_faktur (so_id, invoice_id, by) VALUES (${soId}, ${invoiceId}, ${cleanBy(by)}) ON CONFLICT DO NOTHING`;
}

async function tautOtomatis(soId: number, invoiceId: number): Promise<boolean> {
  const [r] = await db()`SELECT 1 FROM accurate_invoice_so WHERE so_id = ${soId} AND invoice_id = ${invoiceId}`;
  return !!r;
}

/** Hanya tautan manual yang bisa dilepas; tautan otomatis mengikuti rujukan SO di faktur Accurate. */
export async function lepasFaktur(soId: number, invoiceId: number): Promise<void> {
  await pastikanSo(soId);
  if (await tautOtomatis(soId, invoiceId)) {
    throw new DocTrackerError(409, "tautan otomatis dari Accurate tidak bisa dilepas — koreksi rujukan SO di faktur Accurate");
  }
  await db()`DELETE FROM doc_tracker_faktur WHERE so_id = ${soId} AND invoice_id = ${invoiceId}`;
}

