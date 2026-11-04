// Papan status job terjadwal (migrasi 275). Pembungkus cron di scheduler.ts memanggil
// catatJalan() untuk SETIAP eksekusi job; statusJob() menyusun papan untuk /status-job.
//
// Kebanyakan job menangkap galatnya sendiri lalu console.error — dari luar terlihat "sukses".
// Karena itu console.error/console.log disadap per eksekusi lewat AsyncLocalStorage: galat yang
// ditulis di dalam job (termasuk dari fungsi yang ia panggil) menandai eksekusi itu gagal, tanpa
// tercampur job lain yang jalan bersamaan.
import { AsyncLocalStorage } from "node:async_hooks";

import { db, isDbEnabled } from "../db.js";

interface Konteks {
  galat: string | null;
  ringkasan: string | null;
}

const konteks = new AsyncLocalStorage<Konteks>();
let tersadap = false;

const teks = (a: unknown[]): string =>
  a
    .map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x)))
    .join(" ")
    .slice(0, 500);

function pasangPenyadap(): void {
  if (tersadap) return;
  tersadap = true;
  const asliError = console.error.bind(console);
  const asliLog = console.log.bind(console);
  console.error = (...a: unknown[]) => {
    const k = konteks.getStore();
    if (k && !k.galat) k.galat = teks(a);
    asliError(...a);
  };
  console.log = (...a: unknown[]) => {
    const k = konteks.getStore();
    if (k) k.ringkasan = teks(a);
    asliLog(...a);
  };
}

/** Jalankan satu eksekusi job dan catat hasilnya ke job_run. Tak pernah melempar. */
export async function catatJalan(
  job: string,
  expr: string,
  berikut: () => Date | null,
  fn: () => unknown,
): Promise<void> {
  pasangPenyadap();
  const k: Konteks = { galat: null, ringkasan: null };
  const mulai = new Date();
  try {
    await konteks.run(k, async () => {
      await fn();
    });
  } catch (e) {
    k.galat ??= teks([e]);
    console.error(`[scheduler] ${job} melempar galat:`, e);
  }
  if (!isDbEnabled()) return;
  try {
    const sql = db();
    await sql`
      INSERT INTO job_run (job, expr, mulai, selesai, ok, galat, ringkasan, berikut)
      VALUES (${job}, ${expr}, ${mulai}, ${new Date()}, ${k.galat === null}, ${k.galat}, ${k.ringkasan}, ${berikut()})`;
    await sql`DELETE FROM job_run WHERE job = ${job} AND mulai < now() - interval '30 days'`;
  } catch (e) {
    console.error(`[job-run] gagal mencatat ${job}:`, e);
  }
}

export type StatusJob = "OK" | "GAGAL" | "TERLEWAT" | "BELUM_JALAN" | "NONAKTIF";

export interface BarisStatusJob {
  job: string;
  expr: string | null;
  aktif: boolean;
  status: StatusJob;
  berikut: string | null;
  terakhir: { mulai: string; selesai: string; durasi_detik: number; ok: boolean; galat: string | null; ringkasan: string | null } | null;
  terakhir_ok: string | null;
  gagal_7_hari: number;
  jalan_7_hari: number;
}

/** Toleransi sebelum jadwal yang lewat dianggap terlewat (job panjang / jam sibuk). */
const TOLERANSI_MS = 15 * 60_000;

export function tentukanStatus(
  aktif: boolean,
  terakhir: { ok: boolean; berikut: Date | null } | null,
  sekarang: Date,
): StatusJob {
  if (!aktif) return "NONAKTIF";
  if (!terakhir) return "BELUM_JALAN";
  if (terakhir.berikut && sekarang.getTime() - terakhir.berikut.getTime() > TOLERANSI_MS) return "TERLEWAT";
  return terakhir.ok ? "OK" : "GAGAL";
}

const URUTAN: Record<StatusJob, number> = { GAGAL: 0, TERLEWAT: 1, BELUM_JALAN: 2, OK: 3, NONAKTIF: 4 };

export async function statusJob(terdaftar: { nama: string; expr: string; berikut: string | null }[]): Promise<BarisStatusJob[]> {
  const sql = db();
  const rows = await sql`
    SELECT DISTINCT ON (r.job) r.job, r.expr, r.mulai, r.selesai, r.ok, r.galat, r.ringkasan, r.berikut,
      (SELECT max(o.mulai) FROM job_run o WHERE o.job = r.job AND o.ok) AS terakhir_ok,
      (SELECT count(*)::int FROM job_run g WHERE g.job = r.job AND NOT g.ok AND g.mulai > now() - interval '7 days') AS gagal_7,
      (SELECT count(*)::int FROM job_run j WHERE j.job = r.job AND j.mulai > now() - interval '7 days') AS jalan_7
    FROM job_run r
    ORDER BY r.job, r.mulai DESC`;
  const sekarang = new Date();
  const perJob = new Map(rows.map((r) => [String(r.job), r]));
  const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
  const baris = (nama: string, expr: string | null, aktif: boolean, berikutAktif: string | null): BarisStatusJob => {
    const r = perJob.get(nama);
    const terakhir = r
      ? {
          mulai: iso(r.mulai)!,
          selesai: iso(r.selesai)!,
          durasi_detik: Math.round((new Date(r.selesai).getTime() - new Date(r.mulai).getTime()) / 1000),
          ok: r.ok === true,
          galat: r.galat ? String(r.galat) : null,
          ringkasan: r.ringkasan ? String(r.ringkasan) : null,
        }
      : null;
    return {
      job: nama,
      expr: expr ?? (r ? String(r.expr) : null),
      aktif,
      status: tentukanStatus(aktif, r ? { ok: r.ok === true, berikut: r.berikut ? new Date(r.berikut) : null } : null, sekarang),
      berikut: aktif ? berikutAktif : null,
      terakhir,
      terakhir_ok: r ? iso(r.terakhir_ok) : null,
      gagal_7_hari: r ? Number(r.gagal_7) : 0,
      jalan_7_hari: r ? Number(r.jalan_7) : 0,
    };
  };
  const hasil = terdaftar.map((t) => baris(t.nama, t.expr, true, t.berikut));
  const namaAktif = new Set(terdaftar.map((t) => t.nama));
  for (const nama of perJob.keys()) if (!namaAktif.has(nama)) hasil.push(baris(nama, null, false, null));
  return hasil.sort((a, b) => URUTAN[a.status] - URUTAN[b.status] || a.job.localeCompare(b.job));
}
