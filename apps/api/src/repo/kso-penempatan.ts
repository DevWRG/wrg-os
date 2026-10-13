// F169 — Riwayat penempatan alat KSO (migrasi 217).
//
// Satu alat bisa berpindah faskes; tiap periode di satu faskes = satu baris
// kso_asset_penempatan. Tes & revenue tetap milik faskes tempat alat berada pada
// bulan itu (atribusinya di view kso_tes_lokasi_v, bukan di sini).
//
// TULIS HANYA LEWAT FUNGSI SQL kso_pindahkan_alat / kso_batalkan_pindah. Aturan
// validasi (tanggal sesudah tanggal masuk, tak boleh masa depan, tak bertumpuk)
// ada di sana supaya importer sheet, menu, dan skrip ops memakai aturan yang sama.
// Gerbang izin ada di BFF (apps/web /api/kso-penempatan/*); `oleh` dari sesi.

import { db, isDbEnabled } from "../db.js";

export class PenempatanError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export interface PenempatanRow {
  id: number;
  assetId: number;
  snKey: string;
  snRaw: string | null;
  typeAlat: string | null;
  namaAlat: string | null;
  skema: string;
  accountId: number | null;
  faskes: string | null;
  customerRaw: string;
  mulai: string | null;     // 'YYYY-MM-DD'; null = sejak awal tercatat
  selesai: string | null;   // hari pertama alat SUDAH tidak di sana; null = masih
  terbuka: boolean;
  sumber: string;
  catatan: string | null;
  dicatatOleh: string;
  dicatatAt: string;
  tes: number | null;       // tes sheet teknisi selama di lokasi ini
  bulanLapor: number;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const peta = (r: Record<string, unknown>): PenempatanRow => ({
  id: Number(r.id),
  assetId: Number(r.asset_id),
  snKey: String(r.sn_key),
  snRaw: r.sn_raw ? String(r.sn_raw) : null,
  typeAlat: r.type_alat ? String(r.type_alat) : null,
  namaAlat: r.nama_alat ? String(r.nama_alat) : null,
  skema: String(r.skema),
  accountId: num(r.account_id),
  faskes: r.faskes ? String(r.faskes) : null,
  customerRaw: String(r.customer_raw),
  mulai: r.mulai ? String(r.mulai) : null,
  selesai: r.selesai ? String(r.selesai) : null,
  terbuka: Boolean(r.terbuka),
  sumber: String(r.sumber),
  catatan: r.catatan ? String(r.catatan) : null,
  dicatatOleh: String(r.dicatat_oleh),
  dicatatAt: String(r.dicatat_at),
  tes: num(r.tes),
  bulanLapor: Number(r.bulan_lapor ?? 0),
});

// Riwayat SEMUA alat yang pernah berada di faskes ini — termasuk penempatan
// mereka di faskes lain, supaya terlihat dari mana alat datang dan ke mana pergi.
// Tanggal diformat di SQL (kolom date → Date di JS bergeser ke UTC, lihat
// kso-produktivitas.ts).
export async function riwayatFaskes(accountId: number): Promise<PenempatanRow[]> {
  if (!isDbEnabled()) return [];
  const rows = await db()`
    SELECT v.id, v.asset_id, v.sn_key, v.sn_raw, v.type_alat, v.nama_alat, v.skema,
           v.account_id, v.faskes, v.customer_raw,
           to_char(v.mulai, 'YYYY-MM-DD') AS mulai, to_char(v.selesai, 'YYYY-MM-DD') AS selesai,
           v.terbuka, v.sumber, v.catatan, v.dicatat_oleh, v.dicatat_at::text AS dicatat_at,
           v.tes, v.bulan_lapor
      FROM kso_penempatan_v v
     WHERE v.asset_id IN (SELECT asset_id FROM kso_asset_penempatan WHERE account_id = ${accountId})
     ORDER BY v.nama_alat NULLS LAST, v.asset_id, v.mulai NULLS FIRST`;
  return rows.map(peta);
}

// Riwayat satu alat (dialog Pindah/tarik di Daftar Alat).
export async function riwayatAlat(assetId: number): Promise<PenempatanRow[]> {
  if (!isDbEnabled()) return [];
  const rows = await db()`
    SELECT v.id, v.asset_id, v.sn_key, v.sn_raw, v.type_alat, v.nama_alat, v.skema,
           v.account_id, v.faskes, v.customer_raw,
           to_char(v.mulai, 'YYYY-MM-DD') AS mulai, to_char(v.selesai, 'YYYY-MM-DD') AS selesai,
           v.terbuka, v.sumber, v.catatan, v.dicatat_oleh, v.dicatat_at::text AS dicatat_at,
           v.tes, v.bulan_lapor
      FROM kso_penempatan_v v
     WHERE v.asset_id = ${assetId}
     ORDER BY v.mulai NULLS FIRST`;
  return rows.map(peta);
}

// Tiap kata harus muncul, urutan bebas: nama Accurate ditulis "INTI, JENIS KOTA"
// ("HAJI, RS KOTA SURABAYA"), jadi "haji surabaya" sebagai satu frasa tak ketemu.
export async function cariFaskes(q: string): Promise<{ id: number; nama: string }[]> {
  if (!isDbEnabled()) return [];
  const kata = q.trim().split(/\s+/).filter((k) => k.length >= 2).slice(0, 6);
  if (!kata.length) return [];
  const pola = kata.map((k) => `%${k.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const rows = await db()`
    SELECT id, name FROM accurate_customer
     WHERE name ILIKE ALL (${pola}::text[])
     ORDER BY length(name), name
     LIMIT 20`;
  return rows.map((r) => ({ id: Number(r.id), nama: String(r.name) }));
}

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export interface PindahInput {
  assetId: number;
  tujuan: "faskes" | "stok" | "lainnya";
  accountId: number | null;
  customerRaw: string | null;
  tanggal: string;
  catatan: string | null;
}

export function bacaPindah(b: Record<string, unknown>): PindahInput {
  const assetId = Number(b.asset_id);
  if (!Number.isInteger(assetId) || assetId <= 0) throw new PenempatanError("alat tak valid");
  const tujuan = String(b.tujuan ?? "");
  if (!["faskes", "stok", "lainnya"].includes(tujuan)) throw new PenempatanError("tujuan tak valid");
  const tanggal = String(b.tanggal ?? "");
  if (!TANGGAL.test(tanggal)) throw new PenempatanError("tanggal wajib diisi (YYYY-MM-DD)");
  const accountId = b.account_id === null || b.account_id === undefined || b.account_id === "" ? null : Number(b.account_id);
  if (tujuan === "faskes" && !(Number.isInteger(accountId) && (accountId as number) > 0)) {
    throw new PenempatanError("faskes tujuan wajib dipilih");
  }
  const customerRaw = typeof b.customer_raw === "string" && b.customer_raw.trim() ? b.customer_raw.trim() : null;
  if (tujuan === "lainnya" && !customerRaw) throw new PenempatanError("nama lokasi tujuan wajib diisi");
  const catatan = typeof b.catatan === "string" && b.catatan.trim() ? b.catatan.trim().slice(0, 500) : null;
  return { assetId, tujuan: tujuan as PindahInput["tujuan"], accountId: tujuan === "faskes" ? accountId : null, customerRaw, tanggal, catatan };
}

// Galat dari fungsi SQL berbahasa Indonesia dan memang untuk dibaca pengguna.
const galatSql = (e: unknown): never => {
  const g = e as { code?: string; message?: string };
  if (g.code === "P0002") throw new PenempatanError(g.message ?? "tidak ditemukan", 404);
  if (g.code === "23514" || g.code === "23P01") throw new PenempatanError(g.message ?? "ditolak", 409);
  throw e;
};

// Snapshot produktivitas dibaca dari materialized view; tanpa refresh, pindah
// baru terlihat sesudah sinkron Accurate berikutnya.
async function segarkan(): Promise<void> {
  try {
    await db()`SELECT kso_refresh_snapshots()`;
  } catch (e) {
    console.error("[kso-penempatan] refresh snapshot gagal:", e);
  }
}

export async function pindahkan(input: PindahInput, oleh: string | null): Promise<{ id: number }> {
  const sql = db();
  let customerRaw: string;
  if (input.tujuan === "faskes") {
    const [ak] = await sql`SELECT name FROM accurate_customer WHERE id = ${input.accountId}`;
    if (!ak) throw new PenempatanError("faskes tujuan tidak ditemukan", 404);
    customerRaw = String(ak.name);
  } else if (input.tujuan === "stok") {
    // Awalan "STOK KANTOR" = penanda stok kantor di kso_asset_status_kode (197).
    customerRaw = input.customerRaw ? `STOK KANTOR ${input.customerRaw}` : "STOK KANTOR";
  } else {
    customerRaw = input.customerRaw as string;
  }
  try {
    const [r] = await sql`
      SELECT kso_pindahkan_alat(${input.assetId}, ${customerRaw}, ${input.accountId},
        ${input.tanggal}::date, 'manual', ${input.catatan}, ${oleh ?? "menu"}) AS id`;
    await segarkan();
    return { id: Number(r.id) };
  } catch (e) {
    return galatSql(e);
  }
}

export async function batalkanPindah(assetId: number): Promise<{ id: number }> {
  if (!Number.isInteger(assetId) || assetId <= 0) throw new PenempatanError("alat tak valid");
  try {
    const [r] = await db()`SELECT kso_batalkan_pindah(${assetId}) AS id`;
    await segarkan();
    return { id: Number(r.id) };
  } catch (e) {
    return galatSql(e);
  }
}
