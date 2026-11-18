// F154 Jadwal Kunjungan Rutin Teknisi — disusun otomatis, terbit sebelum tanggal 1.
//
// Keputusan user 18 Okt 2026: MANDIRI di data prod (modul Aftersales dev belum
// dipromosikan) · frekuensi per skema, bisa diubah per faskes · wilayah per teknisi ·
// draft tgl 20 → review HoD Aftersales → terbit (WA ke teknisi, saklar default mati).
//
// Populasi = faskes dengan alat KSO operasional (kso_asset + kso_asset_status_v; faskes
// mengikuti penempatan F169). Wilayah faskes = upper(area_customer(account_id)), cadangan
// kso_asset.kota. Prod 18 Okt: 195 faskes di 15 wilayah; 5 teknisi, semua berbasis Pusat
// (Surabaya) → kunjungan dikelompokkan per WILAYAH jadi trip berhari-hari berurutan.
//
// Jatuh tempo PER ALAT (334, keputusan user 18 Nov 2026): bulan sejak PM terakhir alat itu ≥ interval alat itu.
// PM terakhir = max(Riwayat Alat F176 jenis PM/Maintenance yang tidak Batal/Pending, bulan jadwal rutin non-batal
// terakhir yang memuat SN-nya). Faskes masuk jadwal bila ada ≥1 alat jatuh tempo; baris jadwal_rutin tetap satu
// per faskes, `alat` = hanya alat yang jatuh tempo (digabung satu kunjungan).
// Interval alat: jadwal_pm_alat → frekuensi faskes (isian lama) → jadwal_pm_interval (tipe alat) → default skema
// (PER_TEST 2 bulan, lainnya 3 bulan; kolom kso_asset.ritme_kunjungan tak bisa dipakai: 532/600 kosong).
// Alat tanpa riwayat disebar merata per FASKES: (indeks bulan + hash account_id) mod interval = 0 — alat satu
// faskes tak terpencar ke banyak bulan, dan 195 faskes tak jatuh di bulan pertama semua.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

export const ATURAN = {
  interval_per_test: 2,
  interval_beli_reagen: 3,
  per_hari: Number(process.env.JADWAL_RUTIN_PER_HARI ?? 3) || 3,
} as const;

// ── Murni ────────────────────────────────────────────────────────────────

const indeksBulan = (iso: string): number => { const [y, m] = iso.split("-").map(Number); return y * 12 + (m - 1); };
export const selisihBulan = (dari: string, ke: string): number => indeksBulan(ke) - indeksBulan(dari);
const hashAkun = (id: number): number => ((id * 2654435761) >>> 0) % 997;

export function intervalDefault(skema: string[]): number {
  return skema.includes("PER_TEST") ? ATURAN.interval_per_test : ATURAN.interval_beli_reagen;
}

/** Jatuh tempo di bulan target? `terakhir` = bulan (YYYY-MM-01) kunjungan rutin terakhir, atau null. */
export function jatuhTempo(accountId: number, interval: number, terakhir: string | null, bulan: string): boolean {
  if (terakhir) return selisihBulan(terakhir, bulan) >= interval;
  return (indeksBulan(bulan) + hashAkun(accountId)) % interval === 0;
}

export interface FaskesRencana { account_id: number; nama: string; wilayah: string; kota: string | null; teknisi_id: string | null }
export interface BarisRencana { account_id: number; teknisi_id: string | null; wilayah: string; tanggal: string; urutan: number; melebihi: boolean }

/**
 * Isi hari kerja per teknisi: urut wilayah (terbanyak dulu), lalu kota & nama; maksimal
 * `perHari` faskes/hari; wilayah baru = hari baru (satu trip satu wilayah). Bila hari kerja
 * habis, sisanya ditaruh di hari terakhir dengan tanda `melebihi` (HoD yang membagi ulang).
 */
export function susunHari(faskes: FaskesRencana[], hariKerja: string[], perHari: number = ATURAN.per_hari): BarisRencana[] {
  if (!hariKerja.length) return [];
  const perTeknisi = new Map<string, FaskesRencana[]>();
  for (const f of faskes) {
    const k = f.teknisi_id ?? "";
    perTeknisi.set(k, [...(perTeknisi.get(k) ?? []), f]);
  }
  const out: BarisRencana[] = [];
  for (const [k, list] of perTeknisi) {
    const jumlah = new Map<string, number>();
    for (const f of list) jumlah.set(f.wilayah, (jumlah.get(f.wilayah) ?? 0) + 1);
    const urut = [...list].sort((a, b) => (jumlah.get(b.wilayah)! - jumlah.get(a.wilayah)!) || a.wilayah.localeCompare(b.wilayah)
      || (a.kota ?? "").localeCompare(b.kota ?? "") || a.nama.localeCompare(b.nama));
    let hari = 0, isi = 0, wil: string | null = null;
    for (const f of urut) {
      if ((wil !== null && f.wilayah !== wil && isi > 0) || isi >= perHari) { hari += 1; isi = 0; }
      const melebihi = hari >= hariKerja.length;
      const h = Math.min(hari, hariKerja.length - 1);
      isi += 1;
      wil = f.wilayah;
      out.push({ account_id: f.account_id, teknisi_id: k || null, wilayah: f.wilayah, tanggal: hariKerja[h], urutan: isi, melebihi });
    }
  }
  return out;
}

/** Hari kerja (Sen–Jum, bukan master_holiday) dalam bulan YYYY-MM-01. */
export function hariKerjaBulan(bulan: string, libur: Set<string>): string[] {
  const [y, m] = bulan.split("-").map(Number);
  const out: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) break;
    const iso = t.toISOString().slice(0, 10);
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6 && !libur.has(iso)) out.push(iso);
  }
  return out;
}

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
export const labelBulan = (iso: string): string => { const [y, m] = iso.split("-").map(Number); return `${BLN[m - 1]} ${y}`; };
const labelTgl = (iso: string): string => { const t = new Date(`${iso}T00:00:00Z`); return `${HARI[t.getUTCDay()]} ${t.getUTCDate()} ${BLN[t.getUTCMonth()]}`; };

export function pesanJadwal(nama: string, bulan: string, baris: { tanggal: string; faskes: string; wilayah: string | null; alat: number; status: string }[]): string {
  if (!baris.length) return `📅 *Jadwal kunjungan rutin ${labelBulan(bulan)} — ${nama}*\nTidak ada kunjungan rutin terjadwal.`;
  const perTgl = new Map<string, typeof baris>();
  for (const b of baris) perTgl.set(b.tanggal, [...(perTgl.get(b.tanggal) ?? []), b]);
  const out = [`📅 *Jadwal kunjungan rutin ${labelBulan(bulan)} — ${nama}*`, `${baris.length} faskes:`];
  for (const [t, list] of [...perTgl.entries()].sort()) {
    out.push(`*${labelTgl(t)}*${list[0].wilayah ? ` · ${list[0].wilayah}` : ""}`);
    for (const b of list) out.push(`${b.status === "selesai" ? "✅" : b.status === "batal" ? "✖️" : "•"} ${b.faskes} (${b.alat} alat)`);
  }
  return out.join("\n");
}

// ── Kueri ────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;
export class JadwalError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string, public field?: string) { super(message); }
}
const ISO_BULAN = /^\d{4}-\d{2}-01$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export const bulanDepan = (hari: string = hariIniWib()): string => { const [y, m] = hari.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const bulanIni = (hari: string = hariIniWib()): string => `${hari.slice(0, 7)}-01`;

function cekBulan(bulan: string): string {
  if (!ISO_BULAN.test(bulan)) throw new JadwalError(400, "bulan harus YYYY-MM-01", "bulan");
  return bulan;
}

async function liburBulan(sql: Sql, bulan: string): Promise<Set<string>> {
  const rows = await sql`SELECT tanggal::text AS t FROM master_holiday WHERE date_trunc('month', tanggal)::date = ${bulan}::date`;
  return new Set(rows.map((r) => String(r.t)));
}

export interface AlatPm { id: number; sn: string | null; nama: string | null; skema: string | null; tipe: string | null; interval: number; terakhir: string | null }

/**
 * Faskes KSO operasional + wilayah + teknisi + kunjungan rutin terakhir sebelum `bulan`, dengan daftar alat yang
 * membawa interval efektif & bulan PM terakhir masing-masing (334). `alat_jatuh` = alat yang jatuh tempo di `bulan`.
 */
async function populasi(sql: Sql, bulan: string) {
  const rows = await sql`
    WITH pm AS (
      SELECT sn_key, max(waktu) AS terakhir FROM alat_riwayat_v
      WHERE sn_key IS NOT NULL AND lower(coalesce(jenis, '')) IN ('pm', 'maintenance')
        AND coalesce(status, '') !~* '^(batal|pending|revisit)'
        AND waktu < ${bulan}::date
      GROUP BY sn_key
    ), jr AS (
      SELECT alat_sn_key(x.el->>'sn') AS sn_key, max(j.bulan) AS bulan
      FROM jadwal_rutin j CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.alat, '[]'::jsonb)) AS x(el)
      WHERE j.status <> 'batal' AND j.bulan < ${bulan}::date
      GROUP BY 1
    ), a AS (
      SELECT a.account_id, array_agg(DISTINCT a.skema) AS skema,
             jsonb_agg(jsonb_build_object(
               'id', a.id, 'sn', a.sn_raw, 'nama', COALESCE(NULLIF(a.nama_alat, ''), a.type_alat), 'skema', a.skema,
               'tipe', NULLIF(btrim(a.type_alat), ''),
               'interval', COALESCE(pa.interval_bulan, f.interval_bulan, pi.interval_bulan, CASE WHEN a.skema = 'PER_TEST' THEN 2 ELSE 3 END),
               'terakhir', to_char(date_trunc('month', GREATEST((pm.terakhir AT TIME ZONE 'Asia/Jakarta')::date, jr.bulan)), 'YYYY-MM-DD')
             ) ORDER BY a.sn_raw) AS alat,
             min(NULLIF(btrim(a.kota), '')) AS kota_alat
      FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      LEFT JOIN jadwal_pm_alat pa ON pa.kso_asset_id = a.id
      LEFT JOIN jadwal_rutin_frekuensi f ON f.account_id = a.account_id
      LEFT JOIN jadwal_pm_interval pi ON pi.type_alat = upper(btrim(a.type_alat))
      LEFT JOIN pm ON pm.sn_key = a.sn_key
      LEFT JOIN jr ON jr.sn_key = a.sn_key
      WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
      GROUP BY a.account_id
    )
    SELECT a.account_id, COALESCE(NULLIF(ac.name, ''), 'Customer #' || a.account_id::text) AS nama,
           upper(btrim(COALESCE(NULLIF(area_customer(a.account_id), ''), a.kota_alat, 'TANPA WILAYAH'))) AS wilayah,
           a.kota_alat AS kota, a.skema, a.alat, f.interval_bulan, tw.teknisi_id,
           (SELECT max(j.bulan)::text FROM jadwal_rutin j WHERE j.account_id = a.account_id AND j.status <> 'batal' AND j.bulan < ${bulan}::date) AS terakhir
    FROM a
    JOIN accurate_customer ac ON ac.id = a.account_id
    LEFT JOIN jadwal_rutin_frekuensi f ON f.account_id = a.account_id
    LEFT JOIN teknisi_wilayah tw ON tw.wilayah = upper(btrim(COALESCE(NULLIF(area_customer(a.account_id), ''), a.kota_alat, 'TANPA WILAYAH')))`;
  return rows.map((p) => {
    const alat = ((p.alat as Record<string, unknown>[]) ?? []).map((x): AlatPm => ({
      id: Number(x.id), sn: (x.sn as string) ?? null, nama: (x.nama as string) ?? null, skema: (x.skema as string) ?? null,
      tipe: (x.tipe as string) ?? null, interval: Number(x.interval), terakhir: (x.terakhir as string) ?? null,
    }));
    const alat_jatuh = alat.filter((x) => jatuhTempo(Number(p.account_id), x.interval, x.terakhir, bulan));
    return {
      account_id: Number(p.account_id), nama: String(p.nama), wilayah: String(p.wilayah), kota: p.kota ? String(p.kota) : null,
      skema: (p.skema as string[]) ?? [], interval_bulan: p.interval_bulan == null ? null : Number(p.interval_bulan),
      teknisi_id: p.teknisi_id ? String(p.teknisi_id) : null, terakhir: p.terakhir ? String(p.terakhir) : null,
      alat, alat_jatuh,
    };
  });
}

/** Snapshot alat di jadwal_rutin.alat — bentuk lama {sn, nama, skema} (dibaca #JADWAL, Kinerja, efek F175). */
export const snapshotAlat = (xs: AlatPm[]) => xs.map((x) => ({ sn: x.sn, nama: x.nama, skema: x.skema }));

export async function daftarTeknisi() {
  const rows = await db()`
    SELECT am_id AS id, nama, panggilan, NULLIF(btrim(wa_number), '') IS NOT NULL AS ada_wa
    FROM master_user WHERE aktif AND upper(role) = 'TEKNISI' ORDER BY nama`;
  return rows.map((r) => ({ id: String(r.id), nama: String(r.nama), panggilan: r.panggilan ? String(r.panggilan) : null, ada_wa: Boolean(r.ada_wa) }));
}

/** Hitung rencana bulan TANPA menulis (dipakai susunDraft & pratinjau). `ada` = faskes yang sudah berbaris aktif. */
async function hitungRencana(sql: Sql, bulan: string, ada: Set<number>) {
  const [pop, libur] = await Promise.all([populasi(sql, bulan), liburBulan(sql, bulan)]);
  const hariKerja = hariKerjaBulan(bulan, libur);
  // Faskes jatuh tempo = punya ≥1 alat jatuh tempo bulan ini (334).
  const due = pop.filter((p) => !ada.has(Number(p.account_id)) && p.alat_jatuh.length > 0);
  const rencana = susunHari(due.map((p) => ({ account_id: Number(p.account_id), nama: String(p.nama), wilayah: String(p.wilayah), kota: p.kota ? String(p.kota) : null, teknisi_id: p.teknisi_id ? String(p.teknisi_id) : null })), hariKerja);
  return { pop, due, rencana, hariKerja, libur };
}

/** Pratinjau baca-saja: berapa faskes jatuh tempo, per wilayah & teknisi, tanpa menulis. */
export async function pratinjau(bulan0: string) {
  const bulan = cekBulan(bulan0);
  const sql = db();
  const ada = new Set((await sql`SELECT account_id FROM jadwal_rutin WHERE bulan = ${bulan}::date AND status <> 'batal' AND NOT (sumber = 'auto' AND status = 'rencana')`).map((r) => Number(r.account_id)));
  const { pop, due, rencana, hariKerja, libur } = await hitungRencana(sql, bulan, ada);
  const tek = new Map((await daftarTeknisi()).map((t) => [t.id, t.nama]));
  const perWil = new Map<string, number>();
  for (const d of due) perWil.set(String(d.wilayah), (perWil.get(String(d.wilayah)) ?? 0) + 1);
  const perTek = new Map<string, { teknisi: string; kunjungan: number; hari: number }>();
  for (const r of rencana) {
    const k = r.teknisi_id ?? "";
    const x = perTek.get(k) ?? { teknisi: r.teknisi_id ? tek.get(r.teknisi_id) ?? r.teknisi_id : "(belum ada teknisi)", kunjungan: 0, hari: 0 };
    x.kunjungan += 1; perTek.set(k, x);
  }
  for (const [k, x] of perTek) x.hari = new Set(rencana.filter((r) => (r.teknisi_id ?? "") === k).map((r) => r.tanggal)).size;
  return { bulan, populasi: pop.length, jatuh_tempo: due.length, alat_jatuh_tempo: due.reduce((n, d) => n + d.alat_jatuh.length, 0),
           alat_total: pop.reduce((n, d) => n + d.alat.length, 0), hari_kerja: hariKerja.length, libur_tercatat: libur.size,
           melebihi: rencana.filter((r) => r.melebihi).length,
           per_wilayah: [...perWil.entries()].map(([wilayah, n]) => ({ wilayah, faskes: n })).sort((a, b) => b.faskes - a.faskes),
           per_teknisi: [...perTek.values()].sort((a, b) => b.kunjungan - a.kunjungan) };
}

/** Susun (ulang) draft bulan: baris auto+rencana dihapus & dihitung ulang; baris manual/selesai/batal dipertahankan. */
export async function susunDraft(bulan0: string, oleh: string) {
  const bulan = cekBulan(bulan0);
  const sql = db();
  const [b] = await sql`SELECT status FROM jadwal_rutin_bulan WHERE bulan = ${bulan}::date`;
  if (b?.status === "terbit") throw new JadwalError(409, `Jadwal ${labelBulan(bulan)} sudah terbit — ubah per baris, bukan susun ulang`);
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`INSERT INTO jadwal_rutin_bulan (bulan, status, disusun_at, disusun_oleh) VALUES (${bulan}::date, 'draft', now(), ${oleh})
            ON CONFLICT (bulan) DO UPDATE SET disusun_at = now(), disusun_oleh = EXCLUDED.disusun_oleh`;
    await t`DELETE FROM jadwal_rutin WHERE bulan = ${bulan}::date AND sumber = 'auto' AND status = 'rencana'`;
    const ada = new Set((await t`SELECT account_id FROM jadwal_rutin WHERE bulan = ${bulan}::date AND status <> 'batal'`).map((r) => Number(r.account_id)));
    const { pop, due, rencana, hariKerja } = await hitungRencana(t, bulan, ada);
    const alat = new Map(due.map((p) => [Number(p.account_id), snapshotAlat(p.alat_jatuh)]));
    for (const r of rencana) {
      await t`INSERT INTO jadwal_rutin (bulan, tanggal, urutan, teknisi_id, account_id, wilayah, alat, sumber, oleh, catatan)
              VALUES (${bulan}::date, ${r.tanggal}::date, ${r.urutan}, ${r.teknisi_id}, ${r.account_id}, ${r.wilayah}, ${t.json(alat.get(r.account_id) as never)}, 'auto', ${oleh},
                      ${r.melebihi ? "Hari kerja bulan ini tidak cukup — bagi ulang" : null})`;
    }
    return { bulan, hari_kerja: hariKerja.length, populasi: pop.length, jatuh_tempo: due.length, disusun: rencana.length,
             tanpa_teknisi: rencana.filter((r) => !r.teknisi_id).length, melebihi: rencana.filter((r) => r.melebihi).length };
  });
}

export async function jadwalBulan(bulan0: string) {
  const bulan = cekBulan(bulan0);
  const sql = db();
  const [b] = await sql`SELECT status, disusun_at, disusun_oleh, terbit_at, terbit_oleh FROM jadwal_rutin_bulan WHERE bulan = ${bulan}::date`;
  const rows = await sql`
    SELECT j.id::text, j.tanggal::text, j.urutan, j.teknisi_id, mu.nama AS teknisi, j.account_id::text,
           COALESCE(NULLIF(ac.name, ''), 'Customer #' || j.account_id::text) AS faskes, j.wilayah, j.alat, j.status, j.sumber, j.catatan,
           j.selesai_at, j.oleh
    FROM jadwal_rutin j
    LEFT JOIN master_user mu ON mu.am_id = j.teknisi_id
    LEFT JOIN accurate_customer ac ON ac.id = j.account_id
    WHERE j.bulan = ${bulan}::date
    ORDER BY j.tanggal, mu.nama NULLS LAST, j.urutan`;
  const libur = await liburBulan(sql, bulan);
  return {
    bulan, status: b?.status ?? null, disusun_at: b?.disusun_at ?? null, disusun_oleh: b?.disusun_oleh ?? null,
    terbit_at: b?.terbit_at ?? null, terbit_oleh: b?.terbit_oleh ?? null,
    hari_kerja: hariKerjaBulan(bulan, libur), kalender_libur_ada: libur.size > 0 || (await sql`SELECT 1 FROM master_holiday WHERE extract(year FROM tanggal) = ${Number(bulan.slice(0, 4))} LIMIT 1`).length > 0,
    baris: rows.map((r) => ({ ...r, alat: (r.alat as unknown[]) ?? [], selesai_at: r.selesai_at ? new Date(r.selesai_at as string).toISOString() : null })),
    teknisi: await daftarTeknisi(),
  };
}

export async function ubahBaris(id: string, b: { tanggal?: string; teknisi_id?: string | null; status?: string; catatan?: string | null }, oleh: string) {
  if (!/^\d+$/.test(id)) throw new JadwalError(400, "id tidak valid");
  const sql = db();
  const [r] = await sql`SELECT id, bulan::text, status, tanggal::text, teknisi_id FROM jadwal_rutin WHERE id = ${id}`;
  if (!r) throw new JadwalError(404, "baris jadwal tidak ditemukan");
  if (b.tanggal !== undefined) {
    if (!ISO.test(b.tanggal) || `${b.tanggal.slice(0, 7)}-01` !== String(r.bulan)) throw new JadwalError(400, `tanggal harus di bulan ${labelBulan(String(r.bulan))}`, "tanggal");
  }
  if (b.teknisi_id) {
    const [t] = await sql`SELECT 1 FROM master_user WHERE am_id = ${b.teknisi_id} AND aktif AND upper(role) = 'TEKNISI'`;
    if (!t) throw new JadwalError(400, "teknisi tidak dikenal", "teknisi_id");
  }
  if (b.status !== undefined && !["rencana", "selesai", "batal"].includes(b.status)) throw new JadwalError(400, "status harus rencana/selesai/batal", "status");
  // Kunjungan Selesai = sudah dikerjakan seseorang pada tanggalnya: wajib ada teknisi dan
  // tanggalnya sudah tiba (uji user 18 Okt: baris tanpa teknisi, 2 Nov, bisa "Selesai").
  const statusAkhir = b.status ?? String(r.status);
  const teknisiAkhir = b.teknisi_id !== undefined ? b.teknisi_id : (r.teknisi_id ? String(r.teknisi_id) : null);
  const tanggalAkhir = b.tanggal ?? String(r.tanggal);
  if (statusAkhir === "selesai") {
    if (!teknisiAkhir) throw new JadwalError(400, "Tetapkan teknisi dulu sebelum menandai Selesai", "teknisi_id");
    if (tanggalAkhir > hariIniWib()) throw new JadwalError(400, `Belum bisa Selesai — kunjungan dijadwalkan ${labelTgl(tanggalAkhir)}`, "status");
  }
  if (b.status === "rencana" && r.status === "batal") {
    const [dup] = await sql`SELECT 1 FROM jadwal_rutin j1 JOIN jadwal_rutin j2 ON j2.bulan = j1.bulan AND j2.account_id = j1.account_id AND j2.id <> j1.id AND j2.status <> 'batal' WHERE j1.id = ${id}`;
    if (dup) throw new JadwalError(409, "faskes ini sudah punya jadwal aktif lain bulan ini");
  }
  // Semua parameter diberi tipe eksplisit: nilai null tanpa tipe di CASE/COALESCE membuat
  // Postgres menolak seluruh UPDATE ("could not determine data type of parameter") —
  // uji user 18 Okt: ganti tanggal di layar gagal diam-diam.
  const adaTeknisi = b.teknisi_id !== undefined;
  const adaCatatan = b.catatan !== undefined;
  const manual = b.tanggal !== undefined || adaTeknisi;
  const status = b.status ?? null;
  const [u] = await sql`
    UPDATE jadwal_rutin SET
      tanggal = COALESCE(${b.tanggal ?? null}::date, tanggal),
      teknisi_id = CASE WHEN ${adaTeknisi}::boolean THEN ${b.teknisi_id ?? null}::text ELSE teknisi_id END,
      status = COALESCE(${status}::text, status),
      selesai_at = CASE WHEN ${status}::text = 'selesai' THEN now() WHEN ${status}::text IS NOT NULL THEN NULL ELSE selesai_at END,
      catatan = CASE WHEN ${adaCatatan}::boolean THEN ${b.catatan ?? null}::text ELSE catatan END,
      sumber = CASE WHEN ${manual}::boolean THEN 'manual' ELSE sumber END,
      oleh = ${oleh}::text, updated_at = now()
    WHERE id = ${id}::bigint RETURNING id::text, status`;
  return u;
}

export async function tambahManual(b: { bulan: string; account_id: number; tanggal: string; teknisi_id?: string | null; catatan?: string | null }, oleh: string) {
  const bulan = cekBulan(b.bulan);
  if (!ISO.test(b.tanggal) || `${b.tanggal.slice(0, 7)}-01` !== bulan) throw new JadwalError(400, `tanggal harus di bulan ${labelBulan(bulan)}`, "tanggal");
  if (!Number.isInteger(b.account_id)) throw new JadwalError(400, "account_id wajib", "account_id");
  const sql = db();
  const [ac] = await sql`SELECT 1 FROM accurate_customer WHERE id = ${b.account_id}`;
  if (!ac) throw new JadwalError(404, "faskes tidak ditemukan");
  await sql`INSERT INTO jadwal_rutin_bulan (bulan) VALUES (${bulan}::date) ON CONFLICT DO NOTHING`;
  const alat = await sql`SELECT COALESCE(jsonb_agg(jsonb_build_object('sn', a.sn_raw, 'nama', COALESCE(NULLIF(a.nama_alat, ''), a.type_alat), 'skema', a.skema)), '[]'::jsonb) AS j
                         FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id WHERE v.status_kode = 'operasional' AND a.account_id = ${b.account_id}`;
  try {
    const [r] = await sql`
      INSERT INTO jadwal_rutin (bulan, tanggal, teknisi_id, account_id, wilayah, alat, sumber, catatan, oleh)
      VALUES (${bulan}::date, ${b.tanggal}::date, ${b.teknisi_id ?? null}, ${b.account_id},
              upper(btrim(COALESCE(NULLIF(area_customer(${b.account_id}::bigint), ''), 'TANPA WILAYAH'))), ${sql.json(alat[0].j as never)}, 'manual', ${b.catatan ?? null}, ${oleh})
      RETURNING id::text`;
    return r;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new JadwalError(409, "faskes ini sudah punya jadwal aktif bulan ini");
    throw e;
  }
}

export async function terbitkan(bulan0: string, oleh: string) {
  const bulan = cekBulan(bulan0);
  const sql = db();
  const [b] = await sql`SELECT status FROM jadwal_rutin_bulan WHERE bulan = ${bulan}::date`;
  if (!b) throw new JadwalError(404, `Jadwal ${labelBulan(bulan)} belum disusun`);
  const [kosong] = await sql`SELECT count(*)::int AS n FROM jadwal_rutin WHERE bulan = ${bulan}::date AND status <> 'batal' AND teknisi_id IS NULL`;
  if (Number(kosong.n) > 0) throw new JadwalError(409, `${kosong.n} kunjungan belum punya teknisi — tetapkan dulu (atau batalkan) sebelum terbit`);
  await sql`UPDATE jadwal_rutin_bulan SET status = 'terbit', terbit_at = now(), terbit_oleh = ${oleh} WHERE bulan = ${bulan}::date`;
  const kirim = await kirimKeTeknisi(sql, bulan);
  return { bulan, status: "terbit", kirim };
}

const waAktif = (): boolean => (process.env.JADWAL_RUTIN_WA_ENABLED ?? "false").toLowerCase() === "true";

async function barisTeknisi(sql: Sql, teknisiId: string, bulan: string) {
  const rows = await sql`
    SELECT j.tanggal::text, COALESCE(NULLIF(ac.name, ''), 'Customer #' || j.account_id::text) AS faskes, j.wilayah,
           jsonb_array_length(j.alat) AS alat, j.status
    FROM jadwal_rutin j LEFT JOIN accurate_customer ac ON ac.id = j.account_id
    WHERE j.bulan = ${bulan}::date AND j.teknisi_id = ${teknisiId} AND j.status <> 'batal'
    ORDER BY j.tanggal, j.urutan`;
  return rows.map((r) => ({ tanggal: String(r.tanggal), faskes: String(r.faskes), wilayah: r.wilayah ? String(r.wilayah) : null, alat: Number(r.alat), status: String(r.status) }));
}

async function kirimKeTeknisi(sql: Sql, bulan: string) {
  const tek = await sql`
    SELECT DISTINCT mu.am_id, mu.nama, NULLIF(btrim(mu.wa_number), '') AS wa
    FROM jadwal_rutin j JOIN master_user mu ON mu.am_id = j.teknisi_id
    WHERE j.bulan = ${bulan}::date AND j.status <> 'batal'`;
  const hasil: { teknisi: string; kunjungan: number; terkirim: boolean; alasan?: string }[] = [];
  for (const t of tek) {
    const baris = await barisTeknisi(sql, String(t.am_id), bulan);
    if (!t.wa) { hasil.push({ teknisi: String(t.nama), kunjungan: baris.length, terkirim: false, alasan: "nomor WA kosong" }); continue; }
    if (!waAktif()) { hasil.push({ teknisi: String(t.nama), kunjungan: baris.length, terkirim: false, alasan: "JADWAL_RUTIN_WA_ENABLED mati" }); continue; }
    const gw = await sendViaWaGateway(String(t.wa), pesanJadwal(String(t.nama), bulan, baris));
    hasil.push({ teknisi: String(t.nama), kunjungan: baris.length, terkirim: Boolean(gw.sent && !gw.stub && !gw.dryRun) });
  }
  return hasil;
}

// ── Wilayah & frekuensi ──────────────────────────────────────────────────

export async function daftarWilayah() {
  const sql = db();
  const pop = await populasi(sql, bulanDepan());
  const peta = new Map((await sql`SELECT wilayah, teknisi_id FROM teknisi_wilayah`).map((r) => [String(r.wilayah), String(r.teknisi_id)]));
  const per = new Map<string, { wilayah: string; faskes: number; alat: number }>();
  for (const p of pop) {
    const w = String(p.wilayah);
    const x = per.get(w) ?? { wilayah: w, faskes: 0, alat: 0 };
    x.faskes += 1; x.alat += p.alat.length;
    per.set(w, x);
  }
  return { wilayah: [...per.values()].map((w) => ({ ...w, teknisi_id: peta.get(w.wilayah) ?? null })).sort((a, b) => b.faskes - a.faskes), teknisi: await daftarTeknisi() };
}

export async function setWilayah(wilayah: string, teknisiId: string | null, oleh: string) {
  const w = wilayah.trim().toUpperCase();
  if (!w) throw new JadwalError(400, "wilayah wajib", "wilayah");
  const sql = db();
  if (!teknisiId) { await sql`DELETE FROM teknisi_wilayah WHERE wilayah = ${w}`; return { wilayah: w, teknisi_id: null }; }
  const [t] = await sql`SELECT 1 FROM master_user WHERE am_id = ${teknisiId} AND aktif AND upper(role) = 'TEKNISI'`;
  if (!t) throw new JadwalError(400, "teknisi tidak dikenal", "teknisi_id");
  await sql`INSERT INTO teknisi_wilayah (wilayah, teknisi_id, oleh) VALUES (${w}, ${teknisiId}, ${oleh})
            ON CONFLICT (wilayah) DO UPDATE SET teknisi_id = EXCLUDED.teknisi_id, oleh = EXCLUDED.oleh, updated_at = now()`;
  return { wilayah: w, teknisi_id: teknisiId };
}

export async function daftarFrekuensi() {
  const sql = db();
  const pop = await populasi(sql, bulanDepan());
  return pop.map((p) => ({
    account_id: String(p.account_id), nama: String(p.nama), wilayah: String(p.wilayah), skema: (p.skema as string[]) ?? [],
    alat: p.alat.length, interval_default: intervalDefault((p.skema as string[]) ?? []),
    interval_bulan: p.interval_bulan == null ? null : Number(p.interval_bulan), terakhir: p.terakhir ? String(p.terakhir) : null,
  })).sort((a, b) => a.wilayah.localeCompare(b.wilayah) || a.nama.localeCompare(b.nama));
}

export async function setFrekuensi(accountId: number, intervalBulan: number | null, catatan: string | null, oleh: string) {
  if (!Number.isInteger(accountId)) throw new JadwalError(400, "account_id wajib", "account_id");
  const sql = db();
  if (intervalBulan == null) { await sql`DELETE FROM jadwal_rutin_frekuensi WHERE account_id = ${accountId}`; return { account_id: accountId, interval_bulan: null }; }
  if (!Number.isInteger(intervalBulan) || intervalBulan < 1 || intervalBulan > 12) throw new JadwalError(400, "interval 1–12 bulan", "interval_bulan");
  await sql`INSERT INTO jadwal_rutin_frekuensi (account_id, interval_bulan, catatan, oleh) VALUES (${accountId}, ${intervalBulan}, ${catatan}, ${oleh})
            ON CONFLICT (account_id) DO UPDATE SET interval_bulan = EXCLUDED.interval_bulan, catatan = EXCLUDED.catatan, oleh = EXCLUDED.oleh, updated_at = now()`;
  return { account_id: accountId, interval_bulan: intervalBulan };
}

// ── Interval PM per tipe alat & per alat (334) ─────────────────────────────

const tambahBulan = (iso: string, n: number): string => {
  const i = indeksBulan(iso) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
};
const cekInterval = (v: number | null) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 12) throw new JadwalError(400, "interval 1–12 bulan", "interval_bulan");
  return v;
};

/** Tab Interval PM: interval per tipe alat + daftar alat dengan PM terakhir & perkiraan PM berikutnya. */
export async function daftarIntervalPm() {
  const sql = db();
  const bulan = bulanDepan();
  const [pop, tipeRows, alatRows] = await Promise.all([
    populasi(sql, bulan),
    sql`SELECT type_alat, interval_bulan FROM jadwal_pm_interval`,
    sql`SELECT kso_asset_id, interval_bulan, catatan FROM jadwal_pm_alat`,
  ]);
  const perTipe = new Map(tipeRows.map((r) => [String(r.type_alat), Number(r.interval_bulan)]));
  const perAlat = new Map(alatRows.map((r) => [Number(r.kso_asset_id), { interval: Number(r.interval_bulan), catatan: r.catatan ? String(r.catatan) : null }]));
  const tipe = new Map<string, { tipe: string; alat: number; per_test: number }>();
  const alat = [];
  for (const p of pop) {
    for (const x of p.alat) {
      const k = (x.tipe ?? "").trim().toUpperCase();
      if (k) {
        const t = tipe.get(k) ?? { tipe: x.tipe!.trim(), alat: 0, per_test: 0 };
        t.alat += 1; if (x.skema === "PER_TEST") t.per_test += 1; tipe.set(k, t);
      }
      const khusus = perAlat.get(x.id);
      const sumber = khusus ? "alat" : p.interval_bulan != null ? "faskes" : k && perTipe.has(k) ? "tipe" : "default";
      alat.push({
        id: x.id, sn: x.sn, nama: x.nama, tipe: x.tipe, skema: x.skema, faskes: p.nama, account_id: p.account_id, wilayah: p.wilayah,
        interval: x.interval, interval_alat: khusus?.interval ?? null, catatan: khusus?.catatan ?? null, sumber_interval: sumber,
        pm_terakhir: x.terakhir, pm_berikutnya: x.terakhir ? tambahBulan(x.terakhir, x.interval) : null,
        jatuh_tempo_bulan_depan: p.alat_jatuh.some((y) => y.id === x.id),
      });
    }
  }
  return {
    bulan_depan: bulan,
    tipe: [...tipe.entries()].map(([k, t]) => ({ ...t, kunci: k, interval_bulan: perTipe.get(k) ?? null }))
      .sort((a, b) => b.alat - a.alat || a.tipe.localeCompare(b.tipe)),
    alat: alat.sort((a, b) => (a.pm_berikutnya ?? "0000").localeCompare(b.pm_berikutnya ?? "0000") || a.faskes.localeCompare(b.faskes)),
  };
}

export async function setIntervalTipe(tipe0: string, interval0: number | null, oleh: string) {
  const tipe = String(tipe0 ?? "").trim().toUpperCase();
  if (!tipe || tipe.length > 80) throw new JadwalError(400, "tipe alat wajib", "type_alat");
  const interval = cekInterval(interval0);
  const sql = db();
  if (interval == null) { await sql`DELETE FROM jadwal_pm_interval WHERE type_alat = ${tipe}`; return { type_alat: tipe, interval_bulan: null }; }
  await sql`INSERT INTO jadwal_pm_interval (type_alat, interval_bulan, oleh) VALUES (${tipe}, ${interval}, ${oleh})
            ON CONFLICT (type_alat) DO UPDATE SET interval_bulan = EXCLUDED.interval_bulan, oleh = EXCLUDED.oleh, updated_at = now()`;
  return { type_alat: tipe, interval_bulan: interval };
}

export async function setIntervalAlat(id: number, interval0: number | null, catatan: string | null, oleh: string) {
  if (!Number.isInteger(id) || id <= 0) throw new JadwalError(400, "kso_asset_id wajib", "kso_asset_id");
  const interval = cekInterval(interval0);
  const sql = db();
  if (interval == null) { await sql`DELETE FROM jadwal_pm_alat WHERE kso_asset_id = ${id}`; return { kso_asset_id: id, interval_bulan: null }; }
  const [a] = await sql`SELECT 1 FROM kso_asset WHERE id = ${id}`;
  if (!a) throw new JadwalError(404, "alat tidak ditemukan", "kso_asset_id");
  await sql`INSERT INTO jadwal_pm_alat (kso_asset_id, interval_bulan, catatan, oleh) VALUES (${id}, ${interval}, ${catatan}, ${oleh})
            ON CONFLICT (kso_asset_id) DO UPDATE SET interval_bulan = EXCLUDED.interval_bulan, catatan = EXCLUDED.catatan, oleh = EXCLUDED.oleh, updated_at = now()`;
  return { kso_asset_id: id, interval_bulan: interval };
}

// ── WA #JADWAL ───────────────────────────────────────────────────────────

/**
 * Teknisi → jadwalnya sendiri (bulan ini; bulan depan juga bila sudah terbit).
 * HoD/admin/direktur → "#JADWAL <nama teknisi>". Lainnya ditolak sopan.
 * Hanya jadwal yang SUDAH TERBIT yang dibagikan — draft masih bisa berubah.
 */
export async function balasanJadwal(arg: string, pengirim: { am_id: string | null; nama: string | null; role: string | null }): Promise<string> {
  const sql = db();
  const role = (pengirim.role ?? "").toLowerCase();
  let target: { id: string; nama: string } | null = null;
  if (role === "teknisi" && pengirim.am_id) target = { id: pengirim.am_id, nama: pengirim.nama ?? "Anda" };
  else if (["hod", "admin", "direktur", "superuser"].includes(role)) {
    const q = arg.trim();
    if (!q) return "Ketik #JADWAL diikuti nama teknisi, mis. #JADWAL Martin.";
    const t = await sql`SELECT am_id, nama FROM master_user WHERE aktif AND upper(role) = 'TEKNISI'
                        AND (nama ILIKE ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"} OR panggilan ILIKE ${q.replace(/[%_\\]/g, "\\$&")}) LIMIT 2`;
    if (t.length !== 1) return t.length ? `Nama "${q}" cocok ke lebih dari satu teknisi — tulis lebih lengkap.` : `Teknisi "${q}" tidak ditemukan.`;
    target = { id: String(t[0].am_id), nama: String(t[0].nama) };
  } else return "#JADWAL hanya untuk teknisi dan HoD.";
  const hari = hariIniWib();
  const bulan = [bulanIni(hari)];
  const [dep] = await sql`SELECT 1 FROM jadwal_rutin_bulan WHERE bulan = ${bulanDepan(hari)}::date AND status = 'terbit'`;
  if (dep) bulan.push(bulanDepan(hari));
  const bagian: string[] = [];
  for (const b of bulan) {
    const [st] = await sql`SELECT status FROM jadwal_rutin_bulan WHERE bulan = ${b}::date`;
    if (st?.status !== "terbit") { bagian.push(`📅 Jadwal kunjungan rutin ${labelBulan(b)} belum terbit.`); continue; }
    const baris = (await barisTeknisi(sql, target.id, b)).filter((x) => b !== bulanIni(hari) || x.tanggal >= hari);
    bagian.push(pesanJadwal(target.nama, b, baris));
  }
  return bagian.join("\n\n");
}

