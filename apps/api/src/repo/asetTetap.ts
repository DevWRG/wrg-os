import { db } from "../db.js";
import { normalizeAccurateDate } from "./ar.js";

// F34 — Aset Tetap & Depresiasi (fase 1: cermin Accurate, migrasi 203).
// Accurate = sumber kebenaran register + jurnal depresiasi; di sini hanya
// cermin read-only (syncer di accurateSync.ts) + query untuk menu Finance.

const j = (v: unknown) => v as unknown as Parameters<ReturnType<typeof db>["json"]>[0];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detail = any;

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const idOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n && n > 0 ? n : null;
};
const textOrNull = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v));
const dateOrNull = (v: unknown): string | null => (typeof v === "string" ? normalizeAccurateDate(v) : null);

// Upsert satu payload fixed-asset/detail.do. Nama field persis hasil probe prod
// (scripts/qa/probe-accurate-aset-tetap.mjs). Mengembalikan false kalau
// payload tak punya id/number — baris seperti itu tak bisa dicerminkan.
export async function upsertFixedAssetDetail(d: Detail): Promise<boolean> {
  const id = idOrNull(d?.id);
  const number = textOrNull(d?.number);
  if (!id || !number) return false;
  const sql = db();
  const row = {
    id,
    number,
    description: textOrNull(d.description),
    fa_type_id: idOrNull(d.faTypeId ?? d.faType?.id),
    fa_type_name: textOrNull(d.faType?.name),
    quantity: numOrNull(d.quantity),
    quantity_disposed: numOrNull(d.quantityDisposed),
    disposed: d.disposed === true,
    intangible: d.intangible === true,
    asset_cost: numOrNull(d.assetCost),
    current_asset_cost: numOrNull(d.currentAssetCost),
    book_value: numOrNull(d.bookValue),
    residu: numOrNull(d.residu),
    depreciation_method: textOrNull(d.depreciationMethod),
    depreciation_rate: numOrNull(d.depreciationRate),
    estimated_life_months: numOrNull(d.estimatedLife),
    current_estimated_life: numOrNull(d.currentEstimatedLife),
    trans_date: dateOrNull(d.transDate),
    usage_date: dateOrNull(d.usageDate),
    current_start_date: dateOrNull(d.currentStartDate),
    last_journal_date: dateOrNull(d.lastJournalDate),
    branch_id: idOrNull(d.branchId),
    branch_name: textOrNull(d.assetBranchName),
    location_name: textOrNull(d.location?.name),
    asset_account_id: idOrNull(d.assetAccountId),
    depreciation_account_id: idOrNull(d.depreciationAccountId),
    acm_depreciation_account_id: idOrNull(d.acmDepreciationAccountId),
    purchase_invoice_id: idOrNull(d.purchaseInvoiceId),
    notes: textOrNull(d.notes),
  };
  // Syncer = satu-satunya penulis tabel ini, jadi tiap kolom ditimpa penuh
  // (termasuk ke NULL): nilai Accurate yang dikosongkan harus ikut kosong di sini.
  await sql`
    INSERT INTO accurate_fixed_asset ${sql({ ...row, raw: sql.json(j(d)) } as never)}
    ON CONFLICT (id) DO UPDATE SET
      number = EXCLUDED.number,
      description = EXCLUDED.description,
      fa_type_id = EXCLUDED.fa_type_id,
      fa_type_name = EXCLUDED.fa_type_name,
      quantity = EXCLUDED.quantity,
      quantity_disposed = EXCLUDED.quantity_disposed,
      disposed = EXCLUDED.disposed,
      intangible = EXCLUDED.intangible,
      asset_cost = EXCLUDED.asset_cost,
      current_asset_cost = EXCLUDED.current_asset_cost,
      book_value = EXCLUDED.book_value,
      residu = EXCLUDED.residu,
      depreciation_method = EXCLUDED.depreciation_method,
      depreciation_rate = EXCLUDED.depreciation_rate,
      estimated_life_months = EXCLUDED.estimated_life_months,
      current_estimated_life = EXCLUDED.current_estimated_life,
      trans_date = EXCLUDED.trans_date,
      usage_date = EXCLUDED.usage_date,
      current_start_date = EXCLUDED.current_start_date,
      last_journal_date = EXCLUDED.last_journal_date,
      branch_id = EXCLUDED.branch_id,
      branch_name = EXCLUDED.branch_name,
      location_name = EXCLUDED.location_name,
      asset_account_id = EXCLUDED.asset_account_id,
      depreciation_account_id = EXCLUDED.depreciation_account_id,
      acm_depreciation_account_id = EXCLUDED.acm_depreciation_account_id,
      purchase_invoice_id = EXCLUDED.purchase_invoice_id,
      notes = EXCLUDED.notes,
      raw = EXCLUDED.raw,
      last_synced_at = now()
  `;
  return true;
}

// Hapus cermin aset yang sudah tak ada di Accurate. HANYA dipanggil syncer
// sesudah sapuan list lengkap (tak terpotong batas halaman, jumlah = rowCount)
// — sapuan parsial yang memanggil ini akan menghapus aset yang sah.
// Override Finance sengaja TIDAK ikut dihapus (tanpa FK, lihat migrasi 203).
export async function pruneFixedAssets(keepIds: number[]): Promise<number> {
  if (keepIds.length === 0) return 0; // daftar kosong = hampir pasti respons rusak, bukan nol aset
  const sql = db();
  const res = await sql`DELETE FROM accurate_fixed_asset WHERE NOT (id = ANY(${keepIds}::bigint[]))`;
  return res.count;
}

export async function recordFixedAssetSyncState(ok: boolean, summary: Record<string, unknown>): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES ('fixed-asset', now(), ${ok}, ${sql.json(j(summary))})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${ok},
      last_run_summary = ${sql.json(j(summary))}
  `;
}

// Tandai sapuan DIMULAI. Ada karena sinkron pertama prod (12 Okt) mati di aset
// ke-459 saat auto-deploy PR lain me-restart API: sapuan yang dibunuh tak
// sempat menulis status apa pun, jadi halaman tetap bilang "belum pernah
// disinkron". Dengan penanda ini, sapuan yang tak pernah selesai terlihat
// (status 'berjalan' yang basi = terputus). last_synced_at sengaja TIDAK
// diubah — itu waktu sapuan terakhir yang SELESAI.
export async function markFixedAssetSyncStarted(): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES ('fixed-asset', NULL, NULL, jsonb_build_object('status', 'berjalan', 'started_at', now()))
    ON CONFLICT (entity) DO UPDATE SET last_run_ok = NULL,
      last_run_summary = jsonb_build_object('status', 'berjalan', 'started_at', now(),
                                            'sebelumnya', accurate_sync_state.last_run_summary)
  `;
}

// ── Query menu Finance → Aset Tetap ────────────────────────────────────────

export interface AsetTetapFilter {
  q?: string;
  prefix?: string;
  tipe?: string;
  status?: "aktif" | "disposed" | "habis" | "semua";
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

export interface AsetTetapRow {
  id: number;
  number: string;
  prefix: string | null;
  description: string | null;
  fa_type_name: string | null;
  disposed: boolean;
  asset_cost: number | null;
  current_asset_cost: number | null;
  book_value: number | null;
  residu: number | null;
  akumulasi: number;
  susut_per_bulan: number | null;
  sisa_bulan: number | null;
  habis_susut: boolean;
  depreciation_method: string | null;
  current_estimated_life: number | null;
  trans_date: string | null;
  current_start_date: string | null;
  last_journal_date: string | null;
  tgl_perolehan_asli: string | null;
  kso_asset_id: number | null;
  catatan_finance: string | null;
}

const MAX_LIMIT = 200;
// Kolom yang boleh dipakai ORDER BY — id kolom tabel web → ekspresi SQL.
// Whitelist, karena nama kolom tak bisa diparameterisasi.
const SORT_COL: Record<string, string> = {
  number: "number", description: "description", fa_type_name: "fa_type_name",
  current_asset_cost: "current_asset_cost", book_value: "book_value", akumulasi: "akumulasi",
  susut_per_bulan: "susut_per_bulan", sisa_bulan: "sisa_bulan", trans_date: "trans_date",
};

// Tabel server-paged: total_rows dihitung di DB, bukan di klien (#tabel-limit).
export async function listAsetTetap(f: AsetTetapFilter): Promise<{
  count: number; total_rows: number; limit: number; offset: number; rows: AsetTetapRow[];
}> {
  const sql = db();
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const q = f.q?.trim();
  // Wildcard LIKE di-escape: '%' / '_' dari pengguna adalah karakter biasa.
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const status = f.status ?? "aktif";
  const where = sql`
    WHERE true
    ${like ? sql`AND (number ILIKE ${like} OR description ILIKE ${like})` : sql``}
    ${f.prefix ? sql`AND prefix = ${f.prefix.toUpperCase()}` : sql``}
    ${f.tipe ? sql`AND fa_type_name = ${f.tipe}` : sql``}
    ${status === "aktif" ? sql`AND NOT disposed` : sql``}
    ${status === "disposed" ? sql`AND disposed` : sql``}
    ${status === "habis" ? sql`AND habis_susut` : sql``}
  `;
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM fixed_asset_v ${where}`;
  const rows = await sql<AsetTetapRow[]>`
    SELECT id::int, number, prefix, description, fa_type_name, disposed,
           asset_cost::float8, current_asset_cost::float8, book_value::float8, residu::float8,
           akumulasi::float8, susut_per_bulan::float8, sisa_bulan, habis_susut,
           depreciation_method, current_estimated_life,
           to_char(trans_date, 'YYYY-MM-DD') AS trans_date,
           to_char(current_start_date, 'YYYY-MM-DD') AS current_start_date,
           to_char(last_journal_date, 'YYYY-MM-DD') AS last_journal_date,
           to_char(tgl_perolehan_asli, 'YYYY-MM-DD') AS tgl_perolehan_asli,
           kso_asset_id::int, catatan_finance
    FROM fixed_asset_v ${where}
    ORDER BY ${sql.unsafe(SORT_COL[f.sort ?? ""] ?? "number")} ${sql.unsafe(f.dir === "desc" ? "DESC NULLS LAST" : "ASC NULLS LAST")}, id
    LIMIT ${limit} OFFSET ${offset}
  `;
  return { count: rows.length, total_rows: total, limit, offset, rows };
}

export interface AsetTetapRingkasan {
  per_kelompok: {
    prefix: string | null; fa_type_name: string | null; jumlah: number; disposed: number; habis_susut: number;
    nilai_perolehan: number; nilai_buku: number; akumulasi: number; susut_per_bulan: number;
  }[];
  total: { jumlah: number; disposed: number; nilai_perolehan: number; nilai_buku: number; akumulasi: number; susut_per_bulan: number };
  tipe: string[];
  sync: {
    last_synced_at: string | null; last_run_ok: boolean | null; summary: unknown;
    /** 'berjalan' = sapuan sedang jalan; 'terputus' = penanda mulai >45 menit tanpa selesai. */
    status_sapuan: "berjalan" | "terputus" | null; mulai_at: string | null;
  };
}

// Agregat hanya dari kolom bertipe — tak pernah dari raw jsonb (#1417).
// Nilai uang menjumlah aset AKTIF saja; aset disposed dihitung jumlahnya.
export async function ringkasanAsetTetap(): Promise<AsetTetapRingkasan> {
  const sql = db();
  const per = await sql<AsetTetapRingkasan["per_kelompok"]>`
    SELECT prefix, fa_type_name,
           count(*)::int AS jumlah,
           count(*) FILTER (WHERE disposed)::int AS disposed,
           count(*) FILTER (WHERE habis_susut)::int AS habis_susut,
           COALESCE(sum(current_asset_cost) FILTER (WHERE NOT disposed), 0)::float8 AS nilai_perolehan,
           COALESCE(sum(book_value) FILTER (WHERE NOT disposed), 0)::float8 AS nilai_buku,
           COALESCE(sum(akumulasi) FILTER (WHERE NOT disposed), 0)::float8 AS akumulasi,
           COALESCE(sum(susut_per_bulan) FILTER (WHERE NOT disposed AND NOT habis_susut), 0)::float8 AS susut_per_bulan
    FROM fixed_asset_v
    GROUP BY prefix, fa_type_name
    ORDER BY nilai_perolehan DESC, jumlah DESC
  `;
  const total = per.reduce(
    (t, r) => ({
      jumlah: t.jumlah + r.jumlah,
      disposed: t.disposed + r.disposed,
      nilai_perolehan: t.nilai_perolehan + r.nilai_perolehan,
      nilai_buku: t.nilai_buku + r.nilai_buku,
      akumulasi: t.akumulasi + r.akumulasi,
      susut_per_bulan: t.susut_per_bulan + r.susut_per_bulan,
    }),
    { jumlah: 0, disposed: 0, nilai_perolehan: 0, nilai_buku: 0, akumulasi: 0, susut_per_bulan: 0 },
  );
  const tipe = (await sql<{ t: string }[]>`
    SELECT DISTINCT fa_type_name AS t FROM accurate_fixed_asset WHERE fa_type_name IS NOT NULL ORDER BY 1
  `).map((r) => r.t);
  // Sapuan normal ±10 menit; penanda 'berjalan' yang lewat 45 menit = prosesnya
  // mati di tengah (mis. API di-restart auto-deploy) → 'terputus'.
  const [st] = await sql<AsetTetapRingkasan["sync"][]>`
    SELECT last_synced_at::text, last_run_ok, last_run_summary AS summary,
           CASE WHEN last_run_summary->>'status' = 'berjalan'
                THEN CASE WHEN (last_run_summary->>'started_at')::timestamptz < now() - interval '45 minutes'
                          THEN 'terputus' ELSE 'berjalan' END
           END AS status_sapuan,
           CASE WHEN last_run_summary->>'status' = 'berjalan' THEN last_run_summary->>'started_at' END AS mulai_at
    FROM accurate_sync_state WHERE entity = 'fixed-asset'
  `;
  return {
    per_kelompok: per, total, tipe,
    sync: st ?? { last_synced_at: null, last_run_ok: null, summary: null, status_sapuan: null, mulai_at: null },
  };
}

export interface JadwalBaris { periode: string; susut: number; akumulasi: number; nilai_buku: number; status: "lewat" | "berjalan" | "proyeksi" }

// Jadwal garis lurus per bulan, dihitung dari periode berjalan Accurate.
// Status per bulan relatif ke bulan WIB sekarang (lewat/berjalan/proyeksi).
// Apakah Accurate sudah menjurnal bulan itu dilihat dari last_journal_date aset.
// Metode selain STRAIGHTLINE → jadwal kosong + alasan (tak menebak rumus).
export async function jadwalAsetTetap(id: number): Promise<
  { ok: true; aset: AsetTetapRow; jadwal: JadwalBaris[]; catatan: string | null } | { ok: false; error: string }
> {
  const sql = db();
  const [aset] = await sql<AsetTetapRow[]>`
    SELECT id::int, number, prefix, description, fa_type_name, disposed,
           asset_cost::float8, current_asset_cost::float8, book_value::float8, residu::float8,
           akumulasi::float8, susut_per_bulan::float8, sisa_bulan, habis_susut,
           depreciation_method, current_estimated_life,
           to_char(trans_date, 'YYYY-MM-DD') AS trans_date,
           to_char(current_start_date, 'YYYY-MM-DD') AS current_start_date,
           to_char(last_journal_date, 'YYYY-MM-DD') AS last_journal_date,
           to_char(tgl_perolehan_asli, 'YYYY-MM-DD') AS tgl_perolehan_asli,
           kso_asset_id::int, catatan_finance
    FROM fixed_asset_v WHERE id = ${id}
  `;
  if (!aset) return { ok: false, error: "aset tak ditemukan" };
  const jadwal = hitungJadwal(aset);
  const catatan =
    aset.depreciation_method !== "STRAIGHTLINE"
      ? `Metode ${aset.depreciation_method ?? "(kosong)"} belum didukung — jadwal tak dihitung.`
      : !aset.current_start_date || !aset.current_estimated_life
        ? "Tanggal mulai / umur periode berjalan kosong di Accurate — jadwal tak bisa dihitung."
        : null;
  return { ok: true, aset, jadwal, catatan };
}

// Murni (tanpa DB) supaya bisa diuji. Pembulatan per bulan ke rupiah; selisih
// pembulatan ditaruh di bulan terakhir supaya akumulasi akhir = cost − residu.
export function hitungJadwal(a: Pick<AsetTetapRow,
  "depreciation_method" | "current_asset_cost" | "residu" | "current_estimated_life" | "current_start_date"
>): JadwalBaris[] {
  if (a.depreciation_method !== "STRAIGHTLINE") return [];
  const umur = Number(a.current_estimated_life) || 0;
  const start = a.current_start_date;
  if (umur <= 0 || !start) return [];
  const basis = (Number(a.current_asset_cost) || 0) - (Number(a.residu) || 0);
  if (basis <= 0) return [];
  const per = Math.round(basis / umur);
  const [y0, m0] = start.split("-").map(Number);
  const now = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7); // bulan WIB
  const out: JadwalBaris[] = [];
  let akum = 0;
  for (let i = 0; i < umur; i++) {
    const total = y0 * 12 + (m0 - 1) + i;
    const periode = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    const susut = i === umur - 1 ? basis - akum : per;
    akum += susut;
    const status: JadwalBaris["status"] = periode < now ? "lewat" : periode === now ? "berjalan" : "proyeksi";
    out.push({ periode, susut, akumulasi: akum, nilai_buku: (Number(a.current_asset_cost) || 0) - akum, status });
  }
  return out;
}

// Lapisan override Finance (tak pernah disentuh syncer). Field yang tak
// dikirim = tak diubah; kirim null untuk mengosongkan.
export async function simpanOverrideAsetTetap(
  id: number,
  b: { tgl_perolehan_asli?: string | null; kso_asset_id?: number | null; catatan?: string | null },
  oleh: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = db();
  const [ada] = await sql`SELECT 1 FROM accurate_fixed_asset WHERE id = ${id}`;
  if (!ada) return { ok: false, error: "aset tak ditemukan" };
  if (b.tgl_perolehan_asli != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.tgl_perolehan_asli)) {
    return { ok: false, error: "tgl_perolehan_asli harus YYYY-MM-DD" };
  }
  if (b.kso_asset_id != null) {
    const [k] = await sql`SELECT 1 FROM kso_asset WHERE id = ${b.kso_asset_id}`;
    if (!k) return { ok: false, error: "kso_asset_id tak ditemukan" };
  }
  const has = (k: keyof typeof b) => Object.prototype.hasOwnProperty.call(b, k);
  const catatan = has("catatan") ? (b.catatan?.trim() || null) : undefined;
  await sql`
    INSERT INTO fixed_asset_override (accurate_id, tgl_perolehan_asli, kso_asset_id, catatan, updated_by, updated_at)
    VALUES (${id}, ${b.tgl_perolehan_asli ?? null}, ${b.kso_asset_id ?? null}, ${catatan ?? null}, ${oleh}, now())
    ON CONFLICT (accurate_id) DO UPDATE SET
      tgl_perolehan_asli = ${has("tgl_perolehan_asli") ? sql`EXCLUDED.tgl_perolehan_asli` : sql`fixed_asset_override.tgl_perolehan_asli`},
      kso_asset_id = ${has("kso_asset_id") ? sql`EXCLUDED.kso_asset_id` : sql`fixed_asset_override.kso_asset_id`},
      catatan = ${has("catatan") ? sql`EXCLUDED.catatan` : sql`fixed_asset_override.catatan`},
      updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  return { ok: true };
}
