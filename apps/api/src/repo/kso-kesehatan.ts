// F73 KSO Utilization & Health Monitor.
//
// Status per faskes KSO — SEHAT / WASPADA / KRITIS + alasan — dihitung
// DETERMINISTIK dari data sumber. Ambang = varian "D" (13 Okt 2026), dipilih
// sesudah ambang usulan awal disimulasikan ke data prod dan menghasilkan 132/196
// faskes KRITIS (67%) — kebanyakan karena utilisasi vs target kontrak yang belum
// diverifikasi & data sheet berumur 7–21 bulan:
//   KRITIS : tak ada pembelian KSO di 2 bulan tutup terakhir · piutang lewat jatuh
//            tempo >90 hari · kontrak TERVERIFIKASI sudah lewat
//   WASPADA: revenue KSO 3 bln turun >30% · utilisasi <50% target · median bayar
//            >90 hari · kontrak terverifikasi habis ≤90 hari
//   (prod 13 Okt dgn varian D: 91 Kritis · 44 Waspada · 61 Sehat dari 196.)
//   Kontrak BELUM terverifikasi (isian awal F47) yang sudah lewat = penanda "perlu
//   verifikasi" saja — prod 13 Okt: 61/130 kontrak isian awal tercatat lewat.
//
// Utilisasi = tes TERTAGIH di Accurate (qty baris "PEMERIKSAAN…"/"…PENGULANGAN…",
// periode = bulan faktur − 1 — aturan yang SAMA dgn kso_asset_produktivitas_v 197)
// dibanding target tes/bln aset. Jendela = 3 periode yang tagihannya sudah lengkap
// (faktur di 3 bulan tutup terakhir). Cadangan: tes dari sheet
// (kso_asset_test_monthly, 3 bulan terlapor terakhir) — HANYA bila bulan datanya
// ≤6 bulan lalu (SHEET_MAKS_BULAN), diberi label bulan datanya; impor sheet manual
// (prod 13 Okt: s/d Juli 2026, banyak faskes terakhir melapor 2025).
// "Pembelian KSO" = revenue kategori yang berlaku untuk skema faskes
// (kso_kategori_skema) di kso_customer_revenue_mv.
//
// Scope: AM = faskes miliknya (crm_account.owner_am_id); HoD = cabang pemilik,
// atau wilayah faskes (area_customer) bila belum ada pemilik; admin = semua.

import { db } from "../db.js";
import { scopeOnClause, FULL_SCOPE, type DataScope } from "./access-scope.js";
import { jatuhTempoSql, tglBayarSql } from "./pembayaran.js";
import { sendViaWaGateway } from "../wasend.js";
import { waHod } from "./hod-wa.js";

export type StatusKesehatan = "SEHAT" | "WASPADA" | "KRITIS";
export type Tingkat = "kritis" | "waspada" | "info";
export interface Alasan { tingkat: Tingkat; kode: string; teks: string }

export interface MetrikKso {
  account_id: string;
  nama: string;
  cabang: string | null;
  pemilik: string | null;
  aset: number;
  skema: string[];
  alat: string[];
  target_bln: number;            // jumlah target tes/bln aset yang punya target (0 = tanpa target)
  ada_per_test: boolean;
  beli_m1: boolean;              // ada pembelian KSO bulan tutup terakhir
  beli_m2: boolean;              // … dan bulan sebelumnya
  rev3: number;                  // revenue KSO 3 bulan tutup terakhir
  rev3_sebelum: number;          // 3 bulan sebelumnya
  tes_tagih_3bln: number | null; // jumlah tes tertagih Accurate di jendela 3 periode
  tes_sheet_rata: number | null; // rata 3 bulan terlapor terakhir di sheet
  sheet_sampai: string | null;   // bulan data sheet terakhir (YYYY-MM-DD)
  median_bayar: number | null;   // hari, faktur lunas 12 bln
  lewat_tempo_hari: number | null; // terlama, piutang terbuka
  kontrak_berakhir: string | null;
  kontrak_terverifikasi: boolean | null;
}

export interface HasilKesehatan extends MetrikKso {
  status: StatusKesehatan;
  alasan: Alasan[];
  utilisasi: { rasio: number | null; sumber: "accurate" | "sheet" | null; rata_tes: number | null };
}

// ── Murni ────────────────────────────────────────────────────────────────

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const labelBulan = (iso: string): string => {
  const [y, m] = iso.split("-").map(Number);
  return `${BULAN[m - 1]} ${y}`;
};
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const selisihHari = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Bulan tutup ke-n sebelum bulan berjalan (n=1 → bulan lalu), format YYYY-MM-01. */
export function bulanTutup(hariIni: string, n: number): string {
  const [y, m] = hariIni.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 10);
}

export const AMBANG = { utilisasi_waspada: 0.5, bayar_waspada_hari: 90, piutang_kritis_hari: 90, revenue_turun: 0.3, kontrak_waspada_hari: 90 } as const;
export const SHEET_MAKS_BULAN = 6;

const umurBulan = (iso: string, hariIni: string): number => {
  const [y, m] = iso.split("-").map(Number);
  const [hy, hm] = hariIni.split("-").map(Number);
  return (hy - y) * 12 + (hm - m);
};

export function nilaiKesehatan(m: MetrikKso, hariIni: string): HasilKesehatan {
  const alasan: Alasan[] = [];
  const tambah = (tingkat: Tingkat, kode: string, teks: string) => alasan.push({ tingkat, kode, teks });

  // 1. Pembelian rutin
  if (!m.beli_m1 && !m.beli_m2) {
    tambah("kritis", "tanpa_beli", `Tidak ada pembelian KSO di ${labelBulan(bulanTutup(hariIni, 2))} dan ${labelBulan(bulanTutup(hariIni, 1))}`);
  }
  // 2. Tren revenue
  if (m.rev3_sebelum > 0 && m.rev3 < m.rev3_sebelum * (1 - AMBANG.revenue_turun)) {
    tambah("waspada", "revenue_turun", `Revenue KSO 3 bulan terakhir turun ${pct(1 - m.rev3 / m.rev3_sebelum)} dibanding 3 bulan sebelumnya`);
  }
  // 3. Utilisasi
  let utilisasi: HasilKesehatan["utilisasi"] = { rasio: null, sumber: null, rata_tes: null };
  if (m.target_bln > 0) {
    if (m.ada_per_test && m.tes_tagih_3bln != null && m.tes_tagih_3bln > 0) {
      const rata = m.tes_tagih_3bln / 3;
      utilisasi = { rasio: rata / m.target_bln, sumber: "accurate", rata_tes: rata };
    } else if (m.tes_sheet_rata != null && m.sheet_sampai && umurBulan(m.sheet_sampai, hariIni) <= SHEET_MAKS_BULAN) {
      utilisasi = { rasio: m.tes_sheet_rata / m.target_bln, sumber: "sheet", rata_tes: m.tes_sheet_rata };
    }
    if (utilisasi.rasio != null) {
      const asal = utilisasi.sumber === "sheet" && m.sheet_sampai ? ` (data sheet s/d ${labelBulan(m.sheet_sampai)})` : " (tes tertagih Accurate)";
      if (utilisasi.rasio < AMBANG.utilisasi_waspada) {
        tambah("waspada", "utilisasi_rendah", `Utilisasi ${pct(utilisasi.rasio)} dari target ${Math.round(m.target_bln).toLocaleString("id-ID")} tes/bln${asal}`);
      }
    } else if (m.sheet_sampai && umurBulan(m.sheet_sampai, hariIni) > SHEET_MAKS_BULAN) {
      tambah("info", "utilisasi_tak_terukur", `Utilisasi tak terukur — data sheet terakhir ${labelBulan(m.sheet_sampai)}, terlalu lama`);
    } else {
      tambah("info", "utilisasi_tak_terukur", "Utilisasi tak terukur — belum ada tes tertagih maupun data sheet");
    }
  }
  // 4. Pembayaran
  if (m.lewat_tempo_hari != null && m.lewat_tempo_hari > AMBANG.piutang_kritis_hari) {
    tambah("kritis", "piutang_lama", `Piutang lewat jatuh tempo ${m.lewat_tempo_hari} hari`);
  }
  if (m.median_bayar != null && m.median_bayar > AMBANG.bayar_waspada_hari) {
    tambah("waspada", "bayar_lambat", `Median bayar ${m.median_bayar} hari setelah faktur`);
  }
  // 5. Kontrak
  if (m.kontrak_berakhir) {
    const sisa = selisihHari(hariIni, m.kontrak_berakhir);
    if (m.kontrak_terverifikasi) {
      if (sisa < 0) tambah("kritis", "kontrak_lewat", `Kontrak KSO sudah berakhir ${-sisa} hari lalu`);
      else if (sisa <= AMBANG.kontrak_waspada_hari) tambah("waspada", "kontrak_habis", `Kontrak KSO berakhir dalam ${sisa} hari`);
    } else if (sisa < 0) {
      tambah("info", "kontrak_perlu_verifikasi", "Kontrak (isian awal) tercatat sudah lewat — perlu verifikasi di Kontrak KSO");
    }
  }

  const status: StatusKesehatan = alasan.some((a) => a.tingkat === "kritis") ? "KRITIS"
    : alasan.some((a) => a.tingkat === "waspada") ? "WASPADA" : "SEHAT";
  return { ...m, status, alasan, utilisasi };
}

const URUT: Record<StatusKesehatan, number> = { KRITIS: 0, WASPADA: 1, SEHAT: 2 };
const lebihBuruk = (baru: StatusKesehatan, lama: StatusKesehatan | undefined): boolean =>
  lama === undefined ? baru !== "SEHAT" : URUT[baru] < URUT[lama];

/** Murni: faskes yang BARU memburuk dibanding snapshot minggu lalu (tanpa snapshot lama = yang tidak sehat). */
export function yangMemburuk(kini: Pick<HasilKesehatan, "account_id" | "status">[], lalu: Map<string, StatusKesehatan>, adaSnapshotLalu: boolean) {
  return kini.filter((k) => (adaSnapshotLalu ? lebihBuruk(k.status, lalu.get(k.account_id)) : k.status !== "SEHAT"));
}

// ── Kueri ────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;

const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function metrik(sql: Sql, sc: DataScope, hariIni: string, akun: number[] | null): Promise<MetrikKso[]> {
  const m0 = bulanTutup(hariIni, 0);   // awal bulan berjalan
  const m1 = bulanTutup(hariIni, 1);
  const m2 = bulanTutup(hariIni, 2);
  const m3 = bulanTutup(hariIni, 3);
  const m6 = bulanTutup(hariIni, 6);
  const rows = await sql`
    WITH aset AS (
      SELECT a.account_id, array_agg(DISTINCT a.skema) AS skema, count(*)::int AS n,
             array_agg(DISTINCT COALESCE(NULLIF(a.nama_alat, ''), a.type_alat)) FILTER (WHERE COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) IS NOT NULL) AS alat,
             COALESCE(sum(a.target_jumlah_tes) FILTER (WHERE a.target_jumlah_tes > 0), 0)::float8 AS target,
             bool_or(a.skema = 'PER_TEST') AS ada_per_test
      FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
        ${akun ? sql`AND a.account_id = ANY(${akun}::bigint[])` : sql``}
      GROUP BY a.account_id
    ),
    kat AS (
      SELECT a.account_id, array_agg(DISTINCT ks.kategori) AS kategori
      FROM aset a CROSS JOIN LATERAL unnest(a.skema) AS s(skema)
      JOIN kso_kategori_skema ks ON ks.skema = s.skema
      GROUP BY a.account_id
    ),
    rev AS (
      SELECT r.account_id,
             COALESCE(sum(r.revenue_netto) FILTER (WHERE r.periode >= ${m3}::date AND r.periode < ${m0}::date), 0)::float8 AS rev3,
             COALESCE(sum(r.revenue_netto) FILTER (WHERE r.periode >= ${m6}::date AND r.periode < ${m3}::date), 0)::float8 AS rev3_sebelum,
             bool_or(r.periode = ${m1}::date AND r.revenue_netto > 0) AS beli_m1,
             bool_or(r.periode = ${m2}::date AND r.revenue_netto > 0) AS beli_m2
      FROM kso_customer_revenue_mv r
      JOIN kat k ON k.account_id = r.account_id AND r.kategori = ANY(k.kategori)
      WHERE r.periode >= ${m6}::date AND r.periode < ${m0}::date
      GROUP BY r.account_id
    ),
    tagih AS (  -- faktur di 3 bulan tutup terakhir = tes periode (bulan faktur − 1)
      SELECT ai.customer_id AS account_id, sum(COALESCE(aii.qty, 0))::float8 AS tes
      FROM accurate_invoice ai
      JOIN accurate_invoice_item aii ON aii.invoice_id = ai.id
      LEFT JOIN accurate_item it ON it.id = aii.item_id
      WHERE ai.customer_id IN (SELECT account_id FROM aset)
        AND ai.tanggal >= ${m3}::date AND ai.tanggal < ${m0}::date
        AND (COALESCE(NULLIF(it.name, ''), aii.raw->'item'->>'name', '') ILIKE 'PEMERIKSAAN%'
             OR COALESCE(NULLIF(it.name, ''), aii.raw->'item'->>'name', '') ILIKE '%PENGULANGAN%')
      GROUP BY ai.customer_id
    ),
    sheet_bln AS (
      SELECT a.account_id, t.periode, sum(t.jumlah_tes)::float8 AS tes
      FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
      JOIN kso_asset_test_monthly t ON t.asset_id = a.id
      WHERE v.status_kode = 'operasional' AND a.account_id IN (SELECT account_id FROM aset) AND t.jumlah_tes IS NOT NULL
      GROUP BY a.account_id, t.periode
    ),
    sheet AS (
      SELECT account_id, avg(tes)::float8 AS rata, max(periode)::text AS sampai
      FROM (SELECT *, row_number() OVER (PARTITION BY account_id ORDER BY periode DESC) AS rn FROM sheet_bln) x
      WHERE rn <= 3 GROUP BY account_id
    ),
    bayar AS (
      SELECT ai.customer_id AS account_id,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${tglBayarSql(sql)} - ai.tanggal)
               FILTER (WHERE ai.status = 'PAID' AND ${tglBayarSql(sql)} >= ai.tanggal AND ${tglBayarSql(sql)} > current_date - 365) AS median,
             max(current_date - ${jatuhTempoSql(sql)}) FILTER (WHERE ai.outstanding > 0 AND ${jatuhTempoSql(sql)} < current_date) AS lewat
      FROM accurate_invoice ai
      WHERE ai.customer_id IN (SELECT account_id FROM aset)
      GROUP BY ai.customer_id
    ),
    kontrak AS (  -- kontrak berjalan dgn tanggal berakhir PALING DEKAT
      SELECT DISTINCT ON (k.account_id) k.account_id, k.berakhir::text AS berakhir, k.terverifikasi
      FROM kso_kontrak k
      WHERE k.status IN ('AKTIF', 'NEGO') AND k.account_id IN (SELECT account_id FROM aset)
      ORDER BY k.account_id, k.berakhir NULLS LAST
    )
    SELECT a.account_id::text, COALESCE(NULLIF(ac.name, ''), 'Customer #' || a.account_id::text) AS nama,
           upper(btrim(COALESCE(NULLIF(omu.cabang, ''), NULLIF(area_customer(a.account_id), '')))) AS cabang,
           COALESCE(NULLIF(omu.nama, ''), oa.owner_am_id) AS pemilik,
           a.n, a.skema, COALESCE(a.alat, '{}') AS alat, a.target, a.ada_per_test,
           COALESCE(r.beli_m1, false) AS beli_m1, COALESCE(r.beli_m2, false) AS beli_m2,
           COALESCE(r.rev3, 0) AS rev3, COALESCE(r.rev3_sebelum, 0) AS rev3_sebelum,
           t.tes AS tes_tagih, s.rata AS sheet_rata, s.sampai AS sheet_sampai,
           round(b.median)::int AS median_bayar, b.lewat::int AS lewat_tempo,
           kt.berakhir, kt.terverifikasi
    FROM aset a
    JOIN accurate_customer ac ON ac.id = a.account_id
    LEFT JOIN crm_account oa ON oa.account_id = a.account_id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    LEFT JOIN rev r ON r.account_id = a.account_id
    LEFT JOIN tagih t ON t.account_id = a.account_id
    LEFT JOIN sheet s ON s.account_id = a.account_id
    LEFT JOIN bayar b ON b.account_id = a.account_id
    LEFT JOIN kontrak kt ON kt.account_id = a.account_id
    WHERE true ${scopeOnClause(sql, sc, sql`oa.owner_am_id`, sql`COALESCE(NULLIF(omu.cabang, ''), area_customer(a.account_id))`)}`;
  return rows.map((r) => ({
    account_id: String(r.account_id), nama: String(r.nama), cabang: r.cabang ? String(r.cabang) : null,
    pemilik: r.pemilik ? String(r.pemilik) : null, aset: Number(r.n), skema: (r.skema as string[]) ?? [],
    alat: ((r.alat as string[]) ?? []).slice(0, 6), target_bln: Number(r.target) || 0, ada_per_test: Boolean(r.ada_per_test),
    beli_m1: Boolean(r.beli_m1), beli_m2: Boolean(r.beli_m2), rev3: Number(r.rev3) || 0, rev3_sebelum: Number(r.rev3_sebelum) || 0,
    tes_tagih_3bln: r.tes_tagih == null ? null : Number(r.tes_tagih),
    tes_sheet_rata: r.sheet_rata == null ? null : Number(r.sheet_rata),
    sheet_sampai: r.sheet_sampai ? String(r.sheet_sampai) : null,
    median_bayar: r.median_bayar == null ? null : Number(r.median_bayar),
    lewat_tempo_hari: r.lewat_tempo == null ? null : Number(r.lewat_tempo),
    kontrak_berakhir: r.berakhir ? String(r.berakhir) : null,
    kontrak_terverifikasi: r.terverifikasi == null ? null : Boolean(r.terverifikasi),
  }));
}

export async function kesehatanKso(sc: DataScope = FULL_SCOPE) {
  const sql = db();
  const hari = hariIniWib();
  const hasil = (await metrik(sql, sc, hari, null)).map((m) => nilaiKesehatan(m, hari))
    .sort((a, b) => URUT[a.status] - URUT[b.status] || a.nama.localeCompare(b.nama));
  const [sheet] = await sql`SELECT max(periode)::text AS sampai FROM kso_asset_test_monthly WHERE jumlah_tes IS NOT NULL`;
  return {
    hari_ini: hari,
    jendela: { beli: [bulanTutup(hari, 2), bulanTutup(hari, 1)], tes_tertagih: [bulanTutup(hari, 4), bulanTutup(hari, 2)] },
    sheet_sampai: sheet?.sampai ?? null,
    ringkas: {
      total: hasil.length,
      kritis: hasil.filter((h) => h.status === "KRITIS").length,
      waspada: hasil.filter((h) => h.status === "WASPADA").length,
      sehat: hasil.filter((h) => h.status === "SEHAT").length,
    },
    faskes: hasil,
  };
}

/** Status satu faskes (briefing #BRIEF / panel faskes). null = bukan faskes KSO operasional. */
export async function kesehatanAkun(ids: number[]): Promise<HasilKesehatan | null> {
  const sql = db();
  const hari = hariIniWib();
  const [m] = await metrik(sql, FULL_SCOPE, hari, ids);
  return m ? nilaiKesehatan(m, hari) : null;
}

// ── Rekap mingguan ke HoD ────────────────────────────────────────────────

export function pesanRekapHod(nama: string, list: Pick<HasilKesehatan, "nama" | "status" | "alasan">[]): string {
  const baris = list.slice(0, 15).map((f) => {
    const utama = f.alasan.filter((a) => a.tingkat !== "info").map((a) => a.teks).slice(0, 2).join("; ");
    return `${f.status === "KRITIS" ? "🔴" : "🟡"} ${f.nama}: ${utama}`;
  });
  return [`🩺 *Kesehatan KSO — tim ${nama}*`, `${list.length} faskes baru memburuk minggu ini:`, ...baris,
    list.length > 15 ? `… dan ${list.length - 15} lainnya — lihat Produktivitas KSO → tab Kesehatan.` : "Rincian: Produktivitas KSO → tab Kesehatan."].join("\n");
}

const seninWib = (hari: string): string => {
  const d = new Date(`${hari}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/**
 * Simpan snapshot minggu ini, bandingkan dgn snapshot sebelumnya, kirim rekap per
 * HoD (cabang → hod_territory → app_user ber-WA). dryRun = tanpa tulis & kirim.
 */
export async function runRekapKesehatanKso(opts: { dryRun?: boolean } = {}) {
  const sql = db();
  const data = await kesehatanKso(FULL_SCOPE);
  const minggu = seninWib(data.hari_ini);
  const [prev] = await sql`SELECT max(minggu)::text AS m FROM kso_kesehatan_snapshot WHERE minggu < ${minggu}::date`;
  const lalu = new Map<string, StatusKesehatan>();
  if (prev?.m) {
    for (const r of await sql`SELECT account_id::text, status FROM kso_kesehatan_snapshot WHERE minggu = ${prev.m}::date`) {
      lalu.set(String(r.account_id), r.status as StatusKesehatan);
    }
  }
  const memburuk = yangMemburuk(data.faskes, lalu, Boolean(prev?.m));
  const perCabang = new Map<string, HasilKesehatan[]>();
  for (const f of data.faskes.filter((x) => memburuk.some((m) => m.account_id === x.account_id))) {
    const k = f.cabang ?? "";
    perCabang.set(k, [...(perCabang.get(k) ?? []), f]);
  }
  const kirim: { hod: string; faskes: number; terkirim: boolean }[] = [];
  const lewati: string[] = [];
  const perHod = new Map<string, HasilKesehatan[]>();
  for (const [cabang, list] of perCabang) {
    if (!cabang) { lewati.push(`${list.length} faskes tanpa cabang`); continue; }
    const h = await sql`SELECT DISTINCT hod_key FROM hod_territory WHERE upper(btrim(cabang)) = ${cabang}`;
    if (h.length !== 1) { lewati.push(`cabang ${cabang}: HoD ${h.length ? "ganda" : "tak terpetakan"}`); continue; }
    const key = String(h[0].hod_key);
    perHod.set(key, [...(perHod.get(key) ?? []), ...list]);
  }
  if (!opts.dryRun) {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`DELETE FROM kso_kesehatan_snapshot WHERE minggu = ${minggu}::date`;
      for (const f of data.faskes) {
        await t`INSERT INTO kso_kesehatan_snapshot (minggu, account_id, status, alasan, cabang)
                VALUES (${minggu}::date, ${f.account_id}, ${f.status}, ${t.json(f.alasan as never)}, ${f.cabang})`;
      }
    });
  }
  for (const [hodKey, list] of perHod) {
    const u = await waHod(hodKey);
    if (!u) { lewati.push(`HoD ${hodKey}: nomor WA tak ditemukan (akun login maupun master_user)`); continue; }
    if (opts.dryRun) { kirim.push({ hod: hodKey, faskes: list.length, terkirim: false }); continue; }
    const gw = await sendViaWaGateway(u.wa, pesanRekapHod(u.nama, list));
    kirim.push({ hod: hodKey, faskes: list.length, terkirim: Boolean(gw.sent && !gw.stub && !gw.dryRun) });
  }
  return { minggu, pembanding: prev?.m ?? null, total: data.faskes.length, memburuk: memburuk.length, kirim, lewati, dry_run: Boolean(opts.dryRun) };
}
