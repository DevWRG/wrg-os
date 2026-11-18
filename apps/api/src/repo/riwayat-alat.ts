// F176 Riwayat Alat (Aftersales, keputusan user 17 Nov 2026) — riwayat PM / servis / install / kalibrasi
// PER ALAT, ikut alatnya ke faskes mana pun ia dipasang. Kunci = SN dinormalisasi (alat_sn_key, 328).
// Semua kejadian dari view alat_riwayat_v (#REPORT F175, Google Form lama, jadwal rutin, PM & Kalibrasi,
// install, laporan #servis lama); penempatan alat KSO dari kso_penempatan_v (F169).
// Akses: semua pemegang menu melihat SEMUA alat (alat berpindah wilayah) — gerbang menu di BFF.
import { db, isDbEnabled } from "../db.js";
import { riwayatAlat as penempatanAlat, type PenempatanRow } from "./kso-penempatan.js";

export interface AlatRow {
  sn_key: string;
  sn: string | null;
  alat: string | null;
  /** KSO = kso_asset, Beli = installation_unit, null = hanya dikenal dari riwayat. */
  jenis_alat: "KSO" | "Beli" | null;
  kso_asset_id: number | null;
  installation_unit_id: string | null;
  /** Faskes sekarang (master alat), atau faskes kejadian terakhir bila alat tak ada di master. */
  faskes: string | null;
  kota: string | null;
  aktif: boolean | null;
  kunjungan: number;
  terakhir: string | null;
  terakhir_jenis: string | null;
}

export interface RiwayatRow {
  sumber: "wa" | "form" | "jadwal" | "pm" | "install" | "servis";
  ref: string;
  waktu: string | null;
  jenis: string | null;
  status: string | null;
  faskes: string | null;
  teknisi: string | null;
  keluhan: string | null;
  kegiatan: string | null;
  sparepart: string | null;
  jumlah_tes: number | null;
  kondisi: string | null;
  catatan: string | null;
  alat: string | null;
  sn: string | null;
  /** Foto laporan WA untuk alat ini (336) — jenis tes = jumlah tes, kondisi = kondisi alat. */
  foto: { id: number; jenis: "tes" | "kondisi" }[];
}

export class RiwayatAlatError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
  }
}

/** Kunci dari URL: SN dinormalisasi (huruf/angka/tanda baca SN), maks 80 karakter. */
export function bacaKunci(raw: string | undefined | null): string {
  const k = String(raw ?? "").trim();
  if (!k || k.length > 80 || /\s/.test(k)) throw new RiwayatAlatError("SN tidak valid", 400);
  return k;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

// Waktu ditampilkan sebagai jam WIB (teks), bukan Date — kolom timestamptz ke JS bergeser zona.
// `satu` = detail satu alat: filter SN ($1) ditaruh di DALAM tiap CTE supaya tak mengagregasi semua alat.
const daftarSql = (satu: boolean) => {
  const f = satu ? "AND sn_key = $1" : "";
  return `
  WITH ev AS (
    SELECT sn_key, count(*)::int AS n, max(waktu) AS terakhir,
           (array_agg(jenis ORDER BY waktu DESC NULLS LAST))[1] AS jenis_terakhir,
           (array_agg(faskes ORDER BY waktu DESC NULLS LAST) FILTER (WHERE faskes IS NOT NULL))[1] AS faskes_ev,
           (array_agg(alat ORDER BY waktu DESC NULLS LAST) FILTER (WHERE alat IS NOT NULL))[1] AS alat_ev,
           (array_agg(sn ORDER BY waktu DESC NULLS LAST) FILTER (WHERE sn IS NOT NULL))[1] AS sn_ev
    FROM alat_riwayat_v WHERE sn_key IS NOT NULL ${f} GROUP BY sn_key
  ), k AS (
    SELECT a.sn_key, a.id AS kso_id, a.sn_raw, COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) AS nama,
           COALESCE(ac.name, a.customer_raw) AS faskes, a.kota, a.aktif
    FROM kso_asset a LEFT JOIN accurate_customer ac ON ac.id = a.account_id
    WHERE a.sn_key NOT LIKE 'NOSN:%' ${satu ? "AND a.sn_key = $1" : ""}
  ), b AS (
    SELECT DISTINCT ON (alat_sn_key(iu.serial_number)) alat_sn_key(iu.serial_number) AS sn_key,
           iu.id::text AS unit_id, iu.serial_number, iu.alat_name, COALESCE(ac.name, iu.customer_name) AS faskes
    FROM installation_unit iu LEFT JOIN accurate_customer ac ON ac.id = iu.account_id
    WHERE alat_sn_key(iu.serial_number) IS NOT NULL ${satu ? "AND alat_sn_key(iu.serial_number) = $1" : ""}
    ORDER BY alat_sn_key(iu.serial_number), iu.updated_at DESC
  ), kunci AS (
    SELECT sn_key FROM k UNION SELECT sn_key FROM b UNION SELECT sn_key FROM ev
  )
  SELECT kunci.sn_key,
         COALESCE(k.sn_raw, b.serial_number, ev.sn_ev) AS sn,
         COALESCE(k.nama, b.alat_name, ev.alat_ev) AS alat,
         CASE WHEN k.kso_id IS NOT NULL THEN 'KSO' WHEN b.unit_id IS NOT NULL THEN 'Beli' END AS jenis_alat,
         k.kso_id, b.unit_id,
         COALESCE(k.faskes, b.faskes, ev.faskes_ev) AS faskes, k.kota, k.aktif,
         COALESCE(ev.n, 0) AS kunjungan,
         to_char(ev.terakhir AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS terakhir,
         ev.jenis_terakhir
  FROM kunci
  LEFT JOIN k ON k.sn_key = kunci.sn_key
  LEFT JOIN b ON b.sn_key = kunci.sn_key
  LEFT JOIN ev ON ev.sn_key = kunci.sn_key`;
};

function petaAlat(r: Record<string, unknown>): AlatRow {
  return {
    sn_key: String(r.sn_key),
    sn: (r.sn as string) ?? null,
    alat: (r.alat as string) ?? null,
    jenis_alat: (r.jenis_alat as AlatRow["jenis_alat"]) ?? null,
    kso_asset_id: num(r.kso_id),
    installation_unit_id: (r.unit_id as string) ?? null,
    faskes: (r.faskes as string) ?? null,
    kota: (r.kota as string) ?? null,
    aktif: r.aktif == null ? null : !!r.aktif,
    kunjungan: Number(r.kunjungan ?? 0),
    terakhir: (r.terakhir as string) ?? null,
    terakhir_jenis: (r.jenis_terakhir as string) ?? null,
  };
}

/** Semua alat yang dikenal (master KSO + alat beli + SN yang hanya muncul di riwayat). Tanpa batas baris:
 *  tabel di web menghitung & mencari di sisi klien, jadi daftarnya harus utuh. */
export async function daftarAlat(): Promise<AlatRow[]> {
  if (!isDbEnabled()) return [];
  const rows = await db().unsafe(`${daftarSql(false)} ORDER BY ev.terakhir DESC NULLS LAST, kunci.sn_key`);
  return rows.map((r) => petaAlat(r));
}

export async function detailAlat(snKey: string): Promise<{
  alat: AlatRow;
  riwayat: RiwayatRow[];
  penempatan: PenempatanRow[];
}> {
  const sql = db();
  const [a] = await sql.unsafe(daftarSql(true), [snKey]);
  if (!a) throw new RiwayatAlatError("Alat tidak ditemukan", 404);
  const alat = petaAlat(a);
  const rows = await sql`
    SELECT sumber, ref, to_char(waktu AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS waktu,
           jenis, status, faskes, teknisi, keluhan, kegiatan, sparepart, jumlah_tes, kondisi, catatan, alat, sn
    FROM alat_riwayat_v WHERE sn_key = ${snKey}
    ORDER BY alat_riwayat_v.waktu DESC NULLS LAST, ref`;
  const riwayat: RiwayatRow[] = rows.map((r) => ({
    sumber: r.sumber as RiwayatRow["sumber"],
    ref: String(r.ref),
    waktu: (r.waktu as string) ?? null,
    jenis: (r.jenis as string) ?? null,
    status: (r.status as string) ?? null,
    faskes: (r.faskes as string) ?? null,
    teknisi: (r.teknisi as string) ?? null,
    keluhan: (r.keluhan as string) ?? null,
    kegiatan: (r.kegiatan as string) ?? null,
    sparepart: (r.sparepart as string) ?? null,
    jumlah_tes: num(r.jumlah_tes),
    kondisi: (r.kondisi as string) ?? null,
    catatan: (r.catatan as string) ?? null,
    alat: (r.alat as string) ?? null,
    sn: (r.sn as string) ?? null,
    foto: [],
  }));
  // Foto #REPORT per alat (sumber wa): foto bertaut ke alat itu, atau foto umum kunjungan beralat tunggal.
  const kaIds = riwayat.filter((r) => r.sumber === "wa").map((r) => Number(r.ref.slice(3))).filter(Number.isFinite);
  if (kaIds.length) {
    const fotos = await sql`
      SELECT ka.id AS ka_id, f.id, COALESCE(f.jenis, 'kondisi') AS jenis
      FROM teknisi_kunjungan_alat ka
      JOIN teknisi_kunjungan_foto f ON f.kunjungan_id = ka.kunjungan_id
        AND (f.kunjungan_alat_id = ka.id
             OR (f.kunjungan_alat_id IS NULL
                 AND (SELECT count(*) FROM teknisi_kunjungan_alat y WHERE y.kunjungan_id = ka.kunjungan_id) = 1))
      WHERE ka.id IN ${sql(kaIds)}
      ORDER BY f.jenis DESC NULLS LAST, f.id`;
    const per = new Map<string, RiwayatRow["foto"]>();
    for (const f of fotos) {
      const k = `wa:${f.ka_id}`;
      per.set(k, [...(per.get(k) ?? []), { id: Number(f.id), jenis: f.jenis === "tes" ? "tes" : "kondisi" }]);
    }
    for (const r of riwayat) r.foto = per.get(r.ref) ?? [];
  }
  const penempatan = alat.kso_asset_id != null ? await penempatanAlat(alat.kso_asset_id) : [];
  return { alat, riwayat, penempatan };
}


/** Path berkas satu foto laporan teknisi (336) — untuk /riwayat-alat/foto/:id. null = tak ada. */
export async function pathFotoTeknisi(id: number): Promise<string | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [r] = await db()`SELECT media_path FROM teknisi_kunjungan_foto WHERE id = ${id}`;
  return r?.media_path ? String(r.media_path) : null;
}

// ── Alat siap pasang (idle) — keputusan user 18 Nov 2026 ─────────────────────
// Alat milik WRG (aset tetap KSO-n di Accurate, dicatat Accounting) yang BELUM terpasang di customer.
// Status per aset Accurate (prefiks KSO/KS, belum dilepas):
//   tertaut ke alat KSO (fixed_asset_override F34, atau SN di `notes` = kso_asset.sn_key) → ikut status Daftar Alat:
//     operasional = terpasang (tak tampil); stok_kantor / backup / not_ready / perlu_cek = tampil.
//   tak tertaut: pekerjaan terakhir di Riwayat Alat = Tarik Alat → "ditarik"; lokasi Accurate "GUDANG …" → "gudang";
//   ada kunjungan teknisi lain ≤12 bulan → dianggap terpasang (tak tampil); selain itu "belum_tertaut" (perlu dicek).
//   Uji dev 18 Nov: 706 aset "Kantor Pusat" tak tertaut, 222 di antaranya punya kunjungan teknisi = terpasang.
// Ditambah alat Daftar Alat yang non-operasional tapi tak punya aset Accurate.

export type KategoriIdle = "ditarik" | "gudang" | "stok_kantor" | "backup" | "not_ready" | "perlu_cek" | "belum_tertaut";

export interface AlatIdleRow {
  kunci: string;
  sn_key: string | null;
  sn: string | null;
  nomor_aset: string | null;
  alat: string | null;
  lokasi: string | null;
  kategori: KategoriIdle;
  tgl_perolehan: string | null;
  kso_asset_id: number | null;
  riwayat_terakhir: string | null;
  riwayat_terakhir_jenis: string | null;
  riwayat_terakhir_faskes: string | null;
}

export async function daftarAlatIdle(): Promise<AlatIdleRow[]> {
  if (!isDbEnabled()) return [];
  const rows = await db()`
    WITH acc AS (
      SELECT f.id, f.number, f.description, f.notes, f.location_name,
             COALESCE(f.usage_date, f.trans_date) AS tgl,
             COALESCE(o.kso_asset_id, ks.id) AS kso_id
      FROM accurate_fixed_asset f
      LEFT JOIN fixed_asset_override o ON o.accurate_id = f.id
      LEFT JOIN LATERAL (
        SELECT a.id FROM kso_asset a
        WHERE o.kso_asset_id IS NULL AND alat_sn_key(f.notes) IS NOT NULL AND a.sn_key = alat_sn_key(f.notes)
        ORDER BY a.aktif DESC, a.id LIMIT 1
      ) ks ON true
      WHERE f.prefix IN ('KSO', 'KS') AND NOT f.disposed
    ), gab AS (
      SELECT 'acc:' || acc.id AS kunci, COALESCE(a.sn_key, alat_sn_key(acc.notes)) AS sn_key,
             COALESCE(a.sn_raw, NULLIF(btrim(acc.notes), '')) AS sn, acc.number AS nomor_aset,
             COALESCE(NULLIF(a.nama_alat, ''), a.type_alat, acc.description) AS alat,
             CASE WHEN v.status_kode IS NOT NULL AND v.status_kode <> 'operasional'
                  THEN COALESCE(NULLIF(btrim(a.customer_raw), ''), acc.location_name) ELSE acc.location_name END AS lokasi,
             v.status_kode, acc.location_name AS lokasi_acc,
             acc.tgl, acc.kso_id
      FROM acc
      LEFT JOIN kso_asset a ON a.id = acc.kso_id
      LEFT JOIN kso_asset_status_v v ON v.id = a.id
      UNION ALL
      SELECT 'kso:' || a.id, a.sn_key, a.sn_raw, NULL, COALESCE(NULLIF(a.nama_alat, ''), a.type_alat),
             NULLIF(btrim(a.customer_raw), ''), v.status_kode, NULL, NULL::date, a.id
      FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      WHERE v.status_kode <> 'operasional' AND NOT EXISTS (SELECT 1 FROM acc WHERE acc.kso_id = a.id)
    )
    SELECT * FROM (
    SELECT g.*, to_char(g.tgl, 'YYYY-MM-DD') AS tgl_perolehan,
           CASE WHEN g.status_kode = 'operasional' THEN NULL
                WHEN g.status_kode IS NOT NULL THEN g.status_kode
                WHEN r.jenis ILIKE 'tarik%' THEN 'ditarik'
                WHEN g.lokasi_acc ILIKE 'gudang%' THEN 'gudang'
                WHEN r.waktu > now() - interval '12 months' THEN NULL
                ELSE 'belum_tertaut' END AS kategori,
           to_char(r.waktu AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS riwayat_terakhir, r.jenis AS riwayat_jenis, r.faskes AS riwayat_faskes
    FROM gab g
    LEFT JOIN LATERAL (
      SELECT waktu, jenis, faskes FROM alat_riwayat_v rv WHERE g.sn_key IS NOT NULL AND rv.sn_key = g.sn_key
      ORDER BY waktu DESC NULLS LAST LIMIT 1
    ) r ON true
    ) z
    WHERE z.kategori IS NOT NULL
    ORDER BY CASE z.kategori WHEN 'ditarik' THEN 0 WHEN 'gudang' THEN 1 WHEN 'stok_kantor' THEN 2 WHEN 'backup' THEN 3
                             WHEN 'not_ready' THEN 4 WHEN 'perlu_cek' THEN 5 ELSE 6 END, z.lokasi NULLS LAST, z.alat NULLS LAST`;
  return rows.map((r) => ({
    kunci: String(r.kunci), sn_key: (r.sn_key as string) ?? null, sn: (r.sn as string) ?? null,
    nomor_aset: (r.nomor_aset as string) ?? null, alat: (r.alat as string) ?? null, lokasi: (r.lokasi as string) ?? null,
    kategori: r.kategori as KategoriIdle, tgl_perolehan: (r.tgl_perolehan as string) ?? null,
    kso_asset_id: r.kso_id == null ? null : Number(r.kso_id),
    riwayat_terakhir: (r.riwayat_terakhir as string) ?? null, riwayat_terakhir_jenis: (r.riwayat_jenis as string) ?? null,
    riwayat_terakhir_faskes: (r.riwayat_faskes as string) ?? null,
  }));
}
