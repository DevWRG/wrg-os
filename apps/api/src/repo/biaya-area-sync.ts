// F150 (tahap 2) — puller biaya operasional Accurate → biaya_area_baris (migrasi 257).
// READ-ONLY ke Accurate (hanya GET list/detail). Izin Direktur: YA (2026-10-26).
//
// Sumber: other-payment (kas/bank, detailAccount) + purchase-invoice (detailExpense).
// journal-voucher (penyusutan/amortisasi 6200-04..07) BELUM ditarik: list.do tak bisa
// difilter per akun dan ±11,6 rb jurnal/4 bulan = 1 detail.do per jurnal; ditunda sampai
// ada cara menyaring (lihat docs/features/F150-biaya-vs-revenue-area.md).
// Hanya akun 6100/6200/6300 — HPP 5100 sengaja tak ikut (Laba Kotor dihitung terpisah).
// Aturan area: biaya-area-rules.ts. Detail = N+1 → berbatas per run, lanjut run berikutnya.

import { db } from "../db.js";
import { accDate, accDateTime, accGet, loadCreds, type Creds } from "./accurateSync.js";
import {
  buatKonteks,
  kelompokAkun,
  tebakArea,
  type Karyawan,
  type KonteksArea,
  type SumberBiaya,
} from "./biaya-area-rules.js";

export const BIAYA_AREA_ENTITY = "biaya-area";

/** Awal rentang tarik (Direktur memulai dari Jul 2026). Ganti lewat env BIAYA_AREA_SINCE. */
export function biayaSince(): string {
  const v = process.env.BIAYA_AREA_SINCE ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "2026-07-01";
}

export interface BiayaAreaSyncResult {
  ok: boolean;
  error?: string;
  since: string;
  headers: number;
  details: number;
  detail_failed: number;
  lines: number;
  pending_details: number;
  cappedByPages?: boolean;
}

let running = false;
export const biayaAreaSyncBusy = () => running;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const oneLine = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

/** Konteks aturan area dari DB (kamus kota, alias, karyawan + riwayat cabang, override payee). */
export async function muatKonteksArea(): Promise<KonteksArea> {
  const sql = db();
  const [areaKota, alias, orang, riwayat, payeeManual] = await Promise.all([
    sql`SELECT kota, cabang FROM area_kota`,
    sql`SELECT kata_kunci, area FROM biaya_kamus_alias_kota`,
    sql`SELECT am_id::text AS am_id, nama, panggilan, cabang FROM master_user`,
    sql`SELECT am_id::text AS am_id, cabang, berlaku_mulai::text AS berlaku_mulai FROM am_cabang_riwayat`,
    sql`SELECT payee, area FROM biaya_kamus_payee`,
  ]);
  const rw = new Map<string, { cabang: string; berlaku_mulai: string }[]>();
  for (const r of riwayat) {
    const arr = rw.get(String(r.am_id)) ?? [];
    arr.push({ cabang: String(r.cabang), berlaku_mulai: String(r.berlaku_mulai) });
    rw.set(String(r.am_id), arr);
  }
  const karyawan: Karyawan[] = orang.map((o) => ({
    nama: String(o.nama ?? ""),
    panggilan: o.panggilan ? String(o.panggilan) : null,
    cabang: String(o.cabang ?? ""),
    riwayat: rw.get(String(o.am_id)),
  }));
  return buatKonteks({
    areaKota: areaKota.map((r) => ({ kota: String(r.kota), cabang: String(r.cabang) })),
    alias: alias.map((r) => ({ kata: String(r.kata_kunci), area: String(r.area) })),
    karyawan,
    payeeManual: payeeManual.map((r) => ({ payee: String(r.payee), area: String(r.area) })),
  });
}

interface BarisBiaya {
  sumber: SumberBiaya;
  accurate_id: number;
  seq: number;
  tanggal: string;
  nomor: string | null;
  akun: string;
  nama_akun: string | null;
  kelompok: string;
  jumlah: number;
  keterangan: string;
  payee: string;
  departemen: string | null;
  accurate_last_update: string | null;
}

const namaDept = (x: Doc, h: Doc): string | null => {
  const v = x?.department?.name ?? x?.departmentName ?? h?.department?.name ?? h?.departmentName ?? null;
  const s = oneLine(v);
  return s && s !== "-" ? s : null;
};

/** other-payment detail → baris biaya (murni; diuji). */
export function barisOtherPayment(h: Doc, akunById: Map<number, { no: string; name: string }>, lastUpdate: string | null): BarisBiaya[] {
  const tanggal = accDate(h?.transDate);
  const id = Number(h?.id);
  if (!tanggal || !id) return [];
  const out: BarisBiaya[] = [];
  (h.detailAccount ?? []).forEach((x: Doc, i: number) => {
    const a = x.account ?? akunById.get(Number(x.accountId)) ?? {};
    const kel = kelompokAkun(a.no);
    if (!kel) return;
    out.push({
      sumber: "other-payment", accurate_id: id, seq: i, tanggal, nomor: h.number ?? null, akun: String(a.no), nama_akun: a.name ?? null,
      kelompok: kel, jumlah: num(x.amount), keterangan: oneLine(h.description), payee: oneLine(h.payee), departemen: namaDept(x, h),
      accurate_last_update: lastUpdate,
    });
  });
  return out;
}

/** purchase-invoice detail → baris biaya (detailExpense). */
export function barisPurchaseInvoice(h: Doc, akunById: Map<number, { no: string; name: string }>, lastUpdate: string | null): BarisBiaya[] {
  const tanggal = accDate(h?.transDate);
  const id = Number(h?.id);
  if (!tanggal || !id) return [];
  const out: BarisBiaya[] = [];
  (h.detailExpense ?? []).forEach((x: Doc, i: number) => {
    const a = x.account ?? akunById.get(Number(x.accountId)) ?? {};
    const kel = kelompokAkun(a.no);
    if (!kel) return;
    out.push({
      sumber: "purchase-invoice", accurate_id: id, seq: i, tanggal, nomor: h.number ?? null, akun: String(a.no), nama_akun: a.name ?? null,
      kelompok: kel, jumlah: num(x.expenseAmount ?? x.amount), keterangan: oneLine(`${h.description ?? ""} ${x.expenseName ?? ""}`),
      payee: oneLine(h.vendor?.name), departemen: namaDept(x, h), accurate_last_update: lastUpdate,
    });
  });
  return out;
}

async function detailDenganRetry(creds: Creds, path: string, id: number): Promise<Doc | null> {
  for (let k = 0; k < 3; k++) {
    try {
      const d = await accGet(creds, path, `id=${id}`);
      if (d.s === true && d.d) return d.d;
    } catch {
      /* ulang */
    }
    await sleep(1500 * (k + 1));
  }
  return null;
}

async function simpanBaris(docIds: { sumber: SumberBiaya; id: number }[], baris: BarisBiaya[], ctx: KonteksArea): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    for (const d of docIds) await tx`DELETE FROM biaya_area_baris WHERE sumber = ${d.sumber} AND accurate_id = ${d.id}`;
    for (const b of baris) {
      const h = tebakArea({ sumber: b.sumber, tanggal: b.tanggal, akun: b.akun, keterangan: b.keterangan, payee: b.payee, departemen: b.departemen }, ctx);
      await tx`
        INSERT INTO biaya_area_baris (sumber, accurate_id, seq, tanggal, nomor, akun, nama_akun, kelompok, jumlah, keterangan, payee, departemen,
                                      area, area_bagi, dasar, tertandai, accurate_last_update, updated_at)
        VALUES (${b.sumber}, ${b.accurate_id}, ${b.seq}, ${b.tanggal}, ${b.nomor}, ${b.akun}, ${b.nama_akun}, ${b.kelompok}, ${b.jumlah}, ${b.keterangan},
                ${b.payee}, ${b.departemen}, ${h.area}, ${h.bagi}, ${h.dasar}, ${h.tertandai}, ${b.accurate_last_update}, now())`;
    }
  });
}

interface ListRow {
  id: number;
  lastUpdate: string | null;
}

async function listDokumen(creds: Creds, path: string, since: string, to: string, maxPages: number): Promise<{ rows: ListRow[]; capped: boolean }> {
  const f = `filter.transDate.op=BETWEEN&filter.transDate.val[0]=${since.slice(8)}/${since.slice(5, 7)}/${since.slice(0, 4)}&filter.transDate.val[1]=${to.slice(8)}/${to.slice(5, 7)}/${to.slice(0, 4)}`;
  const rows: ListRow[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await accGet(creds, path, `sp.page=${page}&sp.pageSize=100&fields=id,lastUpdate&${f}`);
    if (r.s !== true) throw new Error(`${path} gagal di halaman ${page}`);
    const part = Array.isArray(r.d) ? (r.d as Doc[]) : [];
    if (part.length === 0) return { rows, capped: false };
    for (const p of part) rows.push({ id: Number(p.id), lastUpdate: accDateTime(p.lastUpdate) });
    if (part.length < 100) return { rows, capped: false };
  }
  return { rows, capped: true };
}

async function akunMap(creds: Creds): Promise<Map<number, { no: string; name: string }>> {
  const m = new Map<number, { no: string; name: string }>();
  for (let page = 1; page <= 20; page++) {
    const r = await accGet(creds, "/accurate/api/glaccount/list.do", `sp.page=${page}&sp.pageSize=100&fields=id,no,name`);
    if (r.s !== true) throw new Error(`glaccount/list.do gagal di halaman ${page}`);
    const part = Array.isArray(r.d) ? (r.d as Doc[]) : [];
    for (const a of part) m.set(Number(a.id), { no: String(a.no), name: String(a.name ?? "") });
    if (part.length < 100) break;
  }
  return m;
}

export async function syncBiayaArea(opts: { detailLimit?: number; maxPages?: number } = {}): Promise<BiayaAreaSyncResult> {
  const since = biayaSince();
  const empty = { since, headers: 0, details: 0, detail_failed: 0, lines: 0, pending_details: 0 };
  if (running) return { ok: false, error: "sinkron biaya area sedang berjalan", ...empty };
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia", ...empty };
  running = true;
  try {
    const res = await jalankan(creds, since, opts);
    await catatState(res);
    return res;
  } catch (e) {
    const res = { ok: false, error: String((e as Error)?.message ?? e), ...empty };
    await catatState(res).catch(() => {});
    return res;
  } finally {
    running = false;
  }
}

async function catatState(res: BiayaAreaSyncResult): Promise<void> {
  const sql = db();
  const summary = JSON.parse(JSON.stringify(res));
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES (${BIAYA_AREA_ENTITY}, now(), ${res.ok}, ${sql.json(summary)})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${res.ok}, last_run_summary = ${sql.json(summary)}`;
}

async function jalankan(creds: Creds, since: string, opts: { detailLimit?: number; maxPages?: number }): Promise<BiayaAreaSyncResult> {
  const sql = db();
  const detailLimit = opts.detailLimit ?? 400;
  const maxPages = opts.maxPages ?? 60;
  const to = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const [akun, ctx] = await Promise.all([akunMap(creds), muatKonteksArea()]);

  const plan: { sumber: SumberBiaya; path: string; susun: typeof barisOtherPayment }[] = [
    { sumber: "other-payment", path: "/accurate/api/other-payment", susun: barisOtherPayment },
    { sumber: "purchase-invoice", path: "/accurate/api/purchase-invoice", susun: barisPurchaseInvoice },
  ];
  let headers = 0, details = 0, failed = 0, lines = 0, pending = 0;
  let capped = false;
  let sisa = detailLimit;

  for (const p of plan) {
    const { rows, capped: c } = await listDokumen(creds, `${p.path}/list.do`, since, to, maxPages);
    capped ||= c;
    headers += rows.length;
    // Dokumen yang belum ada / lastUpdate-nya lebih baru dari yang tersimpan. Dokumen tanpa
    // baris biaya (mis. pembayaran bukan 6xxx) tak punya baris → ikut ditarik ulang tiap run;
    // dibatasi detailLimit, jadi biayanya terkendali.
    const ids = rows.map((r) => r.id);
    const tersimpan = new Map(
      (await sql`SELECT accurate_id, max(accurate_last_update)::text AS lu FROM biaya_area_baris WHERE sumber = ${p.sumber} AND accurate_id = ANY(${ids}::bigint[]) GROUP BY 1`).map(
        (r) => [Number(r.accurate_id), r.lu ? new Date(String(r.lu)).getTime() : 0] as const,
      ),
    );
    const perlu = rows.filter((r) => {
      const t = tersimpan.get(r.id);
      return t === undefined || (r.lastUpdate != null && new Date(r.lastUpdate).getTime() > t);
    });
    const ambil = perlu.slice(0, Math.max(0, sisa));
    pending += perlu.length - ambil.length;
    sisa -= ambil.length;

    for (let i = 0; i < ambil.length; i += 4) {
      const chunk = ambil.slice(i, i + 4);
      const docs = await Promise.all(chunk.map(async (r) => ({ r, d: await detailDenganRetry(creds, `${p.path}/detail.do`, r.id) })));
      const baris: BarisBiaya[] = [];
      const selesai: { sumber: SumberBiaya; id: number }[] = [];
      for (const { r, d } of docs) {
        if (!d) { failed++; continue; }
        details++;
        selesai.push({ sumber: p.sumber, id: r.id });
        baris.push(...p.susun(d, akun, r.lastUpdate));
      }
      lines += baris.length;
      if (selesai.length) await simpanBaris(selesai, baris, ctx);
      await sleep(250);
    }
  }
  return { ok: true, since, headers, details, detail_failed: failed, lines, pending_details: pending, ...(capped ? { cappedByPages: true } : {}) };
}

/** Terapkan ulang aturan area ke baris tersimpan (setelah kamus/override payee berubah) — tanpa memanggil Accurate. */
export async function hitungUlangArea(): Promise<{ rows: number }> {
  const sql = db();
  const ctx = await muatKonteksArea();
  const rows = await sql`SELECT sumber, accurate_id, seq, tanggal::text AS tanggal, akun, keterangan, payee, departemen FROM biaya_area_baris`;
  for (const r of rows) {
    const h = tebakArea(
      { sumber: r.sumber as SumberBiaya, tanggal: String(r.tanggal), akun: String(r.akun), keterangan: String(r.keterangan ?? ""), payee: String(r.payee ?? ""), departemen: r.departemen ? String(r.departemen) : null },
      ctx,
    );
    await sql`UPDATE biaya_area_baris SET area = ${h.area}, area_bagi = ${h.bagi}, dasar = ${h.dasar}, tertandai = ${h.tertandai}, updated_at = now()
              WHERE sumber = ${r.sumber} AND accurate_id = ${r.accurate_id} AND seq = ${r.seq}`;
  }
  return { rows: rows.length };
}
