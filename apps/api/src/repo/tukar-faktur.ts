// F31 — Tukar Faktur Tracker + Klinik Calendar (Fase 1, murni BACA, tanpa migrasi).
//
// Keputusan Direktur (16 Okt 2026): TTF diabaikan, status ikut Accurate, reminder
// cukup di dashboard (tanpa WA, tanpa cron — dihitung saat halaman dibuka).
// Hasil probe Accurate (JAWABAN-BRIEF-ACCURATE-F31): tahap tukar faktur dan data
// kalender customer (jam buka, hari tanda tangan, PIC) TIDAK dicatat di Accurate.
// Jadi tahap yang bisa ditampilkan hanya yang memang ada di Accurate:
//   Terbit (faktur ada) → Dicetak (raw.printedTime terisi) → Lunas (sisa tagihan 0).
// Tahap "dikirim" & "ditandatangani" = Fase 2, menunggu keputusan Direktur.
//
// Status lunas memakai deriveInvoiceStatus (ar.ts) — satu definisi dengan F91.
// Jatuh tempo & tanggal bayar memakai fragmen SQL pembayaran.ts (bukan
// ar_aging_mv.due_date, lihat faktur.ts). Mirror invoice hanya disegarkan untuk
// transDate ≤7 hari, jadi faktur lama bisa tampak belum lunas padahal sudah.

import { db } from "../db.js";
import { deriveInvoiceStatus, normalizeAccurateDate } from "./ar.js";
import { jatuhTempoSql, tglBayarSql } from "./pembayaran.js";
import { wibToday } from "./watchpoint-week.js";

export type TahapFaktur = "terbit" | "dicetak" | "lunas";

export const LABEL_TAHAP: Record<TahapFaktur, string> = {
  terbit: "Terbit",
  dicetak: "Dicetak",
  lunas: "Lunas",
};

/** Lewat ambang ini (>, bukan ≥) faktur belum-lunas ditandai TUA. */
export const HARI_TUA = 7;
/** Jendela default & batas atas tanggal faktur yang dimuat (hari ke belakang). */
export const HARI_DEFAULT = 90;
export const HARI_MAKS = 365;
/** Batas baris per respons — jaga ukuran payload. */
const BATAS_BARIS = 5000;
/** Tipe customer klinik di crm_account.tipe; cadangan: nama diawali "KLINIK". */
const TIPE_KLINIK = "Klinik";

export class TukarFakturError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ── Fungsi murni ─────────────────────────────────────────────────

const MS_HARI = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal (YYYY-MM-DD) dari printedTime Accurate; format tak dikenal → null. */
export function tanggalCetak(printedTime: unknown): string | null {
  if (typeof printedTime !== "string") return null;
  const ymd = normalizeAccurateDate(printedTime.trim());
  return ymd && isTanggalValid(ymd) ? ymd : null;
}

function isTanggalValid(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === ymd;
}

/** Hari penuh dari `sejak` ke `today` (keduanya YYYY-MM-DD); rusak = null, masa depan = 0. */
export function umurHari(sejak: string | null, today: string): number | null {
  if (!sejak || !isTanggalValid(sejak) || !isTanggalValid(today)) return null;
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${sejak}T00:00:00Z`)) / MS_HARI);
  return Math.max(0, d);
}

export interface FakturInput {
  status: string | null;
  outstanding: number;
  tanggal: string | null;
  /** raw->>'printedTime' mentah. */
  printed: string | null;
  due: string | null;
}

export interface FakturTahap {
  tahap: TahapFaktur;
  overdue: boolean;
  /** Tanggal awal hitung umur: tanggal cetak, cadangan tanggal faktur. */
  sejak: string | null;
  /** Umur sejak `sejak`; null untuk faktur lunas atau tanggal tak diketahui. */
  umur_hari: number | null;
  tua: boolean;
}

export function hitungTahap(f: FakturInput, today: string): FakturTahap {
  const st = deriveInvoiceStatus({ status: f.status, outstanding: f.outstanding }, f.due, today);
  const cetak = tanggalCetak(f.printed);
  const sejak = cetak ?? (f.tanggal && isTanggalValid(f.tanggal) ? f.tanggal : null);
  if (st.state === "PAID") return { tahap: "lunas", overdue: false, sejak, umur_hari: null, tua: false };
  const umur = umurHari(sejak, today);
  return {
    tahap: f.printed && f.printed.trim() !== "" ? "dicetak" : "terbit",
    overdue: st.state === "OVERDUE",
    sejak,
    umur_hari: umur,
    tua: umur !== null && umur > HARI_TUA,
  };
}

/** `hari` dari query: kosong → default; bukan bilangan bulat 1..HARI_MAKS → 400. */
export function parseHari(v: string | undefined): number {
  if (v === undefined || v === "") return HARI_DEFAULT;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > HARI_MAKS) {
    throw new TukarFakturError(400, `hari harus bilangan bulat 1–${HARI_MAKS}`);
  }
  return n;
}

/** `bulan` YYYY-MM dari query: kosong → bulan ini (WIB); format/bulan salah → 400. */
export function parseBulan(v: string | undefined, now: Date = new Date()): string {
  if (v === undefined || v === "") return wibToday(now).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new TukarFakturError(400, "bulan harus berformat YYYY-MM");
  return v;
}

/** Rentang [awal, akhir) bulan YYYY-MM sebagai YYYY-MM-DD. */
export function rentangBulan(bulan: string): { awal: string; akhir: string } {
  const [y, m] = bulan.split("-").map(Number) as [number, number];
  return {
    awal: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10),
    akhir: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
}

// ── Tracker ──────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const sn = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const nn = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

export interface TukarFakturItem extends FakturTahap {
  id: string;
  nomor: string;
  customer_id: string | null;
  customer: string;
  tanggal: string | null;
  jatuh_tempo: string | null;
  tgl_bayar: string | null;
  total: number;
  outstanding: number;
  /** Kategori pengadaan baris barang (ECAT/KSO/PL/REGULAR/RUTIN), bisa lebih dari satu. */
  kategori: string[];
}

export interface TukarFakturHasil {
  generated_at: string;
  hari: number;
  total: number;
  per_tahap: Record<TahapFaktur, number>;
  tua: number;
  /** true bila hasil dipotong BATAS_BARIS. */
  terpotong: boolean;
  items: TukarFakturItem[];
}

export function hitungPerTahap(items: Pick<TukarFakturItem, "tahap">[]): Record<TahapFaktur, number> {
  const out: Record<TahapFaktur, number> = { terbit: 0, dicetak: 0, lunas: 0 };
  for (const i of items) out[i.tahap] += 1;
  return out;
}

/** Belum-lunas dulu, yang tertua di atas; lunas di bawah, terbaru dulu. */
export function urutkanTracker<T extends Pick<TukarFakturItem, "tahap" | "umur_hari" | "tanggal" | "nomor">>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    Number(a.tahap === "lunas") - Number(b.tahap === "lunas")
    || (b.umur_hari ?? -1) - (a.umur_hari ?? -1)
    || (b.tanggal ?? "").localeCompare(a.tanggal ?? "")
    || a.nomor.localeCompare(b.nomor));
}

export async function listTukarFaktur(hari: number = HARI_DEFAULT, now: Date = new Date()): Promise<TukarFakturHasil> {
  const sql = db();
  const today = wibToday(now).toISOString().slice(0, 10);
  const rows: Row[] = await sql`
    SELECT ai.id::text AS id, ai.number, ai.customer_id::text AS customer_id,
           COALESCE(NULLIF(ac.name, ''), ai.raw->'customer'->>'name', ai.raw->>'retailWpName', '') AS customer,
           ai.tanggal::text AS tanggal, ai.total::float8 AS total, ai.outstanding::float8 AS outstanding,
           ai.status, ai.raw->>'printedTime' AS printed,
           ${jatuhTempoSql(sql)}::text AS due, ${tglBayarSql(sql)}::text AS tgl_bayar,
           (SELECT array_agg(DISTINCT e->>'charField1' ORDER BY e->>'charField1')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ai.raw->'detailItem') = 'array'
                                             THEN ai.raw->'detailItem' ELSE '[]'::jsonb END) e
             WHERE NULLIF(e->>'charField1', '') IS NOT NULL) AS kategori
    FROM accurate_invoice ai
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    WHERE ai.tanggal >= (${today}::date - ${hari}::int)
    ORDER BY ai.tanggal DESC, ai.id DESC
    LIMIT ${BATAS_BARIS + 1}`;
  const terpotong = rows.length > BATAS_BARIS;
  const items = urutkanTracker(rows.slice(0, BATAS_BARIS).map((r): TukarFakturItem => {
    const t = hitungTahap({
      status: sn(r.status), outstanding: nn(r.outstanding), tanggal: sn(r.tanggal),
      printed: sn(r.printed), due: sn(r.due),
    }, today);
    return {
      ...t,
      id: String(r.id), nomor: String(r.number ?? r.id), customer_id: sn(r.customer_id),
      customer: String(r.customer ?? ""), tanggal: sn(r.tanggal), jatuh_tempo: sn(r.due),
      tgl_bayar: sn(r.tgl_bayar), total: nn(r.total), outstanding: nn(r.outstanding),
      kategori: Array.isArray(r.kategori) ? (r.kategori as string[]) : [],
    };
  }));
  return {
    generated_at: now.toISOString(), hari, total: items.length,
    per_tahap: hitungPerTahap(items), tua: items.filter((i) => i.tua).length, terpotong, items,
  };
}

// ── Klinik Calendar ──────────────────────────────────────────────

export type JenisKejadian = "jatuh_tempo" | "bayar";

export interface KejadianKlinik {
  tanggal: string;
  jenis: JenisKejadian;
  customer_id: string;
  customer: string;
  nomor: string;
  nominal: number;
  /** PIC = kontak utama di Accounts 360 (crm_contact); null bila belum diisi. */
  pic_nama: string | null;
  pic_hp: string | null;
}

export interface KalenderKlinikHasil {
  generated_at: string;
  bulan: string;
  total: number;
  terpotong: boolean;
  events: KejadianKlinik[];
}

export function urutkanKejadian<T extends Pick<KejadianKlinik, "tanggal" | "jenis" | "customer" | "nomor">>(ev: T[]): T[] {
  return [...ev].sort((a, b) =>
    a.tanggal.localeCompare(b.tanggal) || a.jenis.localeCompare(b.jenis)
    || a.customer.localeCompare(b.customer) || a.nomor.localeCompare(b.nomor));
}

/**
 * Jatuh tempo (faktur belum lunas) & tanggal bayar (faktur lunas) customer klinik
 * dalam satu bulan. Jam buka & hari tanda tangan belum punya tempat (Fase 2).
 */
export async function listKalenderKlinik(bulan: string, now: Date = new Date()): Promise<KalenderKlinikHasil> {
  const sql = db();
  const { awal, akhir } = rentangBulan(bulan);
  const rows: Row[] = await sql`
    WITH f AS (
      SELECT ai.id, ai.number, ai.customer_id, ai.status, ai.outstanding,
             ${jatuhTempoSql(sql)} AS due, ${tglBayarSql(sql)} AS bayar,
             COALESCE(NULLIF(ac.name, ''), ai.raw->'customer'->>'name', ai.raw->>'retailWpName', '') AS customer,
             ai.total, ai.paid
      FROM accurate_invoice ai
      JOIN accurate_customer ac ON ac.id = ai.customer_id
      LEFT JOIN crm_account oa ON oa.account_id = ai.customer_id
      WHERE oa.tipe = ${TIPE_KLINIK} OR ac.name ILIKE 'klinik%'
    )
    SELECT * FROM (
      SELECT f.due::text AS tanggal, 'jatuh_tempo' AS jenis, f.customer_id::text AS customer_id, f.customer,
             f.number, f.outstanding::float8 AS nominal
      FROM f
      WHERE f.due >= ${awal}::date AND f.due < ${akhir}::date
        AND NOT (upper(coalesce(f.status, '')) = 'PAID' OR NOT (coalesce(f.outstanding, 0) > 0))
      UNION ALL
      SELECT f.bayar::text, 'bayar', f.customer_id::text, f.customer, f.number, f.paid::float8
      FROM f
      WHERE f.bayar >= ${awal}::date AND f.bayar < ${akhir}::date
        AND (upper(coalesce(f.status, '')) = 'PAID' OR NOT (coalesce(f.outstanding, 0) > 0))
    ) e
    LEFT JOIN LATERAL (
      SELECT c.nama AS pic_nama, c.hp_wa AS pic_hp FROM crm_contact c
      WHERE c.account_id = e.customer_id::bigint ORDER BY c.is_primary DESC, c.seq, c.id LIMIT 1
    ) p ON TRUE
    ORDER BY e.tanggal, e.jenis, e.customer, e.number
    LIMIT ${BATAS_BARIS + 1}`;
  const terpotong = rows.length > BATAS_BARIS;
  const events = urutkanKejadian(rows.slice(0, BATAS_BARIS).map((r): KejadianKlinik => ({
    tanggal: String(r.tanggal), jenis: r.jenis as JenisKejadian, customer_id: String(r.customer_id),
    customer: String(r.customer ?? ""), nomor: String(r.number ?? ""), nominal: nn(r.nominal),
    pic_nama: sn(r.pic_nama), pic_hp: sn(r.pic_hp),
  })));
  return { generated_at: now.toISOString(), bulan, total: events.length, terpotong, events };
}
