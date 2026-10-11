// F47 — Kontrak KSO & Renewal (fase 1). Skema & alasan desain: migrasi 201.
//
// Fase 1 = register kontrak + status renewal + papan jatuh tempo + kelengkapan
// data. Fase 2 (belum): alert WA 30/60/90/120 hari, realisasi volume vs MMV,
// penalti NPK, draf surat perpanjangan.
//
// Aturan yang SENGAJA ditegakkan di sini, bukan di UI:
//   - status RENEWED hanya lewat perpanjang() — periode baru selalu baris baru,
//     jadi riwayat periode lama tak pernah tertimpa;
//   - alat yang dicakup kontrak harus milik akun kontrak itu;
//   - setiap perubahan tercatat di kso_kontrak_log beserta pelakunya.

import { db } from "../db.js";

export type StatusKontrak = "AKTIF" | "NEGO" | "RENEWED" | "LOST";
export const STATUS_KONTRAK: StatusKontrak[] = ["AKTIF", "NEGO", "RENEWED", "LOST"];

export type Bucket = "LEWAT" | "H30" | "H60" | "H90" | "H120" | "AMAN" | "TANPA_TANGGAL" | "SELESAI";
/** Urutan tampil papan jatuh tempo — yang paling mendesak dulu. */
export const URUTAN_BUCKET: Bucket[] = ["LEWAT", "H30", "H60", "H90", "H120", "AMAN", "TANPA_TANGGAL", "SELESAI"];

/**
 * Kelompok jatuh tempo (alert spesifikasi F47: 30/60/90/120 hari). Kontrak yang
 * sudah RENEWED/LOST = SELESAI, tak ikut dikejar. `sisaHari` < 0 = LEWAT —
 * untuk kontrak isian awal itu belum tentu habis (lihat migrasi 201), karena
 * itu UI menampilkannya bersama penanda "belum diverifikasi".
 */
export function bucketJatuhTempo(status: StatusKontrak, sisaHari: number | null): Bucket {
  if (status === "RENEWED" || status === "LOST") return "SELESAI";
  if (sisaHari == null) return "TANPA_TANGGAL";
  if (sisaHari < 0) return "LEWAT";
  if (sisaHari <= 30) return "H30";
  if (sisaHari <= 60) return "H60";
  if (sisaHari <= 90) return "H90";
  if (sisaHari <= 120) return "H120";
  return "AMAN";
}

/**
 * Transisi status yang boleh lewat ubahStatus(). RENEWED SENGAJA tak ada di
 * sini — hanya perpanjang() yang boleh menghasilkannya, bersama kontrak baru.
 * LOST → AKTIF diizinkan (salah tandai / faskes kembali) tapi wajib catatan.
 */
export function alasanTolakStatus(dari: StatusKontrak, ke: StatusKontrak, catatan?: string | null): string | null {
  if (dari === ke) return `kontrak sudah berstatus ${ke}`;
  if (ke === "RENEWED") return "gunakan Perpanjang untuk menandai kontrak diperpanjang (periode baru dibuat sebagai kontrak baru)";
  if (dari === "RENEWED") return "kontrak yang sudah diperpanjang tidak bisa diubah statusnya — ubah kontrak periode barunya";
  if (dari === "LOST" && ke === "AKTIF" && !catatan?.trim()) return "membuka kembali kontrak LOST wajib disertai catatan alasan";
  return null;
}

export class KontrakError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const tglValid = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const tglAtauNull = (s: unknown, nama: string): string | null => {
  if (s === undefined || s === null || s === "") return null;
  if (!tglValid(s)) throw new KontrakError(`${nama} harus berformat YYYY-MM-DD`);
  return s;
};
const angkaAtauNull = (n: unknown, nama: string): number | null => {
  if (n === undefined || n === null || n === "") return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw new KontrakError(`${nama} harus angka ≥ 0`);
  return v;
};

export interface KontrakRow {
  id: string;
  nomor: string;
  account_id: string;
  account_nama: string;
  owner_nama: string | null;
  mulai: string | null;
  berakhir: string | null;
  sisa_hari: number | null;
  bucket: Bucket;
  nkt: number | null;
  auto_renew: boolean;
  pic_nama: string | null;
  status: StatusKontrak;
  terverifikasi: boolean;
  sumber: "isian_awal" | "manual";
  jumlah_alat: number;
  diganti_oleh: string | null;
  catatan: string | null;
  updated_at: string;
}

const KOLOM_KONTRAK = (sql: ReturnType<typeof db>) => sql`
  k.id::text AS id, k.nomor, k.account_id::text AS account_id,
  COALESCE(NULLIF(ac.name,''), 'Customer #' || k.account_id::text) AS account_nama,
  NULLIF(omu.nama,'') AS owner_nama,
  k.mulai::text AS mulai, k.berakhir::text AS berakhir,
  (k.berakhir - CURRENT_DATE)::int AS sisa_hari,
  k.nkt::float8 AS nkt, k.auto_renew, k.pic_nama, k.status, k.terverifikasi, k.sumber,
  (SELECT count(*) FROM kso_kontrak_alat ka WHERE ka.kontrak_id = k.id)::int AS jumlah_alat,
  k.diganti_oleh::text AS diganti_oleh, k.catatan, k.updated_at::text AS updated_at`;

const JOIN_KONTRAK = (sql: ReturnType<typeof db>) => sql`
  FROM kso_kontrak k
  LEFT JOIN accurate_customer ac ON ac.id = k.account_id
  LEFT JOIN crm_account oa ON oa.account_id = k.account_id
  LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id`;

function mapKontrak(r: Record<string, unknown>): KontrakRow {
  const sisa = r.sisa_hari == null ? null : Number(r.sisa_hari);
  const status = r.status as StatusKontrak;
  return {
    id: String(r.id), nomor: String(r.nomor), account_id: String(r.account_id), account_nama: String(r.account_nama),
    owner_nama: r.owner_nama ? String(r.owner_nama) : null,
    mulai: r.mulai ? String(r.mulai) : null, berakhir: r.berakhir ? String(r.berakhir) : null,
    sisa_hari: sisa, bucket: bucketJatuhTempo(status, sisa),
    nkt: r.nkt == null ? null : Number(r.nkt), auto_renew: Boolean(r.auto_renew),
    pic_nama: r.pic_nama ? String(r.pic_nama) : null, status, terverifikasi: Boolean(r.terverifikasi),
    sumber: r.sumber as KontrakRow["sumber"], jumlah_alat: Number(r.jumlah_alat),
    diganti_oleh: r.diganti_oleh ? String(r.diganti_oleh) : null,
    catatan: r.catatan ? String(r.catatan) : null, updated_at: String(r.updated_at),
  };
}

export async function listKontrak(): Promise<{ kontrak: KontrakRow[]; ringkasan: Record<Bucket, number>; belum_verifikasi: number }> {
  const sql = db();
  const rows = await sql`SELECT ${KOLOM_KONTRAK(sql)} ${JOIN_KONTRAK(sql)} ORDER BY k.berakhir NULLS LAST, k.id`;
  const kontrak = rows.map(mapKontrak);
  const ringkasan = Object.fromEntries(URUTAN_BUCKET.map((b) => [b, 0])) as Record<Bucket, number>;
  for (const k of kontrak) ringkasan[k.bucket] += 1;
  return {
    kontrak,
    ringkasan,
    belum_verifikasi: kontrak.filter((k) => !k.terverifikasi && k.bucket !== "SELESAI").length,
  };
}

export async function getKontrak(id: string) {
  const sql = db();
  const kid = Number(id);
  if (!Number.isInteger(kid)) throw new KontrakError("id kontrak tidak valid", 404);
  const [r] = await sql`SELECT ${KOLOM_KONTRAK(sql)} ${JOIN_KONTRAK(sql)} WHERE k.id = ${kid}`;
  if (!r) throw new KontrakError("kontrak tidak ditemukan", 404);
  const alat = await sql`
    SELECT a.id::text AS id, a.sn_raw, COALESCE(NULLIF(a.nama_alat,''), a.type_alat) AS nama_alat, a.skema,
      a.nomor_mou AS nomor_sheet, a.mou_berlaku_sampai::text AS berakhir_sheet, v.status_label
    FROM kso_kontrak_alat ka JOIN kso_asset a ON a.id = ka.kso_asset_id
    LEFT JOIN kso_asset_status_v v ON v.id = a.id
    WHERE ka.kontrak_id = ${kid} ORDER BY a.id`;
  // Alat akun ini yang bisa ditambahkan (operasional, belum di kontrak ini).
  const kandidat = await sql`
    SELECT a.id::text AS id, a.sn_raw, COALESCE(NULLIF(a.nama_alat,''), a.type_alat) AS nama_alat, a.nomor_mou AS nomor_sheet
    FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
    WHERE a.account_id = ${r.account_id}::bigint AND v.status_kode = 'operasional'
      AND NOT EXISTS (SELECT 1 FROM kso_kontrak_alat ka WHERE ka.kontrak_id = ${kid} AND ka.kso_asset_id = a.id)
    ORDER BY a.id`;
  const log = await sql`
    SELECT aksi, dari_status, ke_status, perubahan, catatan, oleh, created_at::text AS created_at
    FROM kso_kontrak_log WHERE kontrak_id = ${kid} ORDER BY created_at DESC, id DESC`;
  return {
    kontrak: mapKontrak(r),
    alat: alat.map((a) => ({
      id: String(a.id), sn: a.sn_raw ? String(a.sn_raw) : null, nama_alat: a.nama_alat ? String(a.nama_alat) : null,
      skema: a.skema ? String(a.skema) : null, nomor_sheet: a.nomor_sheet ? String(a.nomor_sheet) : null,
      berakhir_sheet: a.berakhir_sheet ? String(a.berakhir_sheet) : null, status_label: a.status_label ? String(a.status_label) : null,
    })),
    kandidat_alat: kandidat.map((a) => ({
      id: String(a.id), sn: a.sn_raw ? String(a.sn_raw) : null, nama_alat: a.nama_alat ? String(a.nama_alat) : null,
      nomor_sheet: a.nomor_sheet ? String(a.nomor_sheet) : null,
    })),
    log: log.map((l) => ({
      aksi: String(l.aksi), dari_status: l.dari_status ? String(l.dari_status) : null, ke_status: l.ke_status ? String(l.ke_status) : null,
      perubahan: l.perubahan ?? null, catatan: l.catatan ? String(l.catatan) : null, oleh: l.oleh ? String(l.oleh) : null,
      created_at: String(l.created_at),
    })),
  };
}

/**
 * Daftar kerja tim KSO: data yang membuat papan jatuh tempo tak bisa dipercaya.
 * Semua dihitung dari alat OPERASIONAL (kso_asset_status_v) — alat stok kantor
 * atau nonaktif memang tak butuh kontrak.
 */
export async function kelengkapanKontrak() {
  const sql = db();
  const tanpaKontrak = await sql`
    SELECT a.account_id::text AS account_id,
      COALESCE(NULLIF(ac.name,''), 'Customer #' || a.account_id::text) AS account_nama,
      count(*)::int AS jumlah_alat,
      bool_or(upper(btrim(a.nomor_mou)) LIKE 'DRAFT%') AS ada_draft,
      string_agg(DISTINCT NULLIF(btrim(a.nomor_mou),''), ' · ') AS nomor_sheet
    FROM kso_asset a
    JOIN kso_asset_status_v v ON v.id = a.id
    LEFT JOIN accurate_customer ac ON ac.id = a.account_id
    WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM kso_kontrak_alat ka JOIN kso_kontrak k ON k.id = ka.kontrak_id
        WHERE ka.kso_asset_id = a.id AND k.status IN ('AKTIF', 'NEGO'))
    GROUP BY a.account_id, ac.name
    ORDER BY count(*) DESC, 2`;
  const tanpaTanggal = await sql`
    SELECT ${KOLOM_KONTRAK(sql)} ${JOIN_KONTRAK(sql)}
    WHERE k.status IN ('AKTIF', 'NEGO') AND k.berakhir IS NULL ORDER BY 2`;
  // MoU yang alat-alatnya di sheet punya tanggal berakhir berbeda — isian awal
  // mengambil yang terjauh, tim KSO perlu memastikan.
  const tanggalBeda = await sql`
    SELECT ${KOLOM_KONTRAK(sql)}, d.tanggal_sheet ${JOIN_KONTRAK(sql)}
    JOIN LATERAL (
      SELECT string_agg(DISTINCT a.mou_berlaku_sampai::text, ' · ') AS tanggal_sheet,
        count(DISTINCT a.mou_berlaku_sampai) AS n
      FROM kso_kontrak_alat ka JOIN kso_asset a ON a.id = ka.kso_asset_id WHERE ka.kontrak_id = k.id
    ) d ON d.n > 1
    WHERE k.status IN ('AKTIF', 'NEGO') ORDER BY 2`;
  return {
    alat_tanpa_kontrak: tanpaKontrak.map((r) => ({
      account_id: String(r.account_id), account_nama: String(r.account_nama), jumlah_alat: Number(r.jumlah_alat),
      kategori: r.ada_draft ? "draft" as const : "kosong" as const,
      nomor_sheet: r.nomor_sheet ? String(r.nomor_sheet) : null,
    })),
    kontrak_tanpa_tanggal: tanpaTanggal.map(mapKontrak),
    kontrak_tanggal_beda: tanggalBeda.map((r) => ({ ...mapKontrak(r), tanggal_sheet: String(r.tanggal_sheet) })),
  };
}

export interface InputKontrak {
  nomor?: string;
  account_id?: string | number;
  mulai?: string | null;
  berakhir?: string | null;
  nkt?: number | string | null;
  auto_renew?: boolean;
  pic_nama?: string | null;
  catatan?: string | null;
  terverifikasi?: boolean;
  status?: StatusKontrak;
  alat_ids?: (string | number)[];
}

async function validasiAlat(sql: ReturnType<typeof db>, accountId: number, ids: (string | number)[] | undefined): Promise<number[]> {
  if (!ids?.length) return [];
  const nums = [...new Set(ids.map(Number))];
  if (nums.some((n) => !Number.isInteger(n))) throw new KontrakError("alat_ids tidak valid");
  const ok = await sql`SELECT id FROM kso_asset WHERE id = ANY(${nums}::bigint[]) AND account_id = ${accountId}`;
  if (ok.length !== nums.length) throw new KontrakError("ada alat yang bukan milik akun kontrak ini");
  return nums;
}

export async function buatKontrak(input: InputKontrak, oleh: string | null): Promise<KontrakRow> {
  const nomor = input.nomor?.trim();
  if (!nomor) throw new KontrakError("nomor kontrak wajib diisi");
  const accountId = Number(input.account_id);
  if (!Number.isInteger(accountId)) throw new KontrakError("akun wajib dipilih");
  const status: StatusKontrak = input.status === "NEGO" ? "NEGO" : "AKTIF";
  const mulai = tglAtauNull(input.mulai, "tanggal mulai");
  const berakhir = tglAtauNull(input.berakhir, "tanggal berakhir");
  if (mulai && berakhir && mulai > berakhir) throw new KontrakError("tanggal mulai harus sebelum tanggal berakhir");
  const nkt = angkaAtauNull(input.nkt, "NKT");
  const sql = db();
  const [akun] = await sql`SELECT id FROM accurate_customer WHERE id = ${accountId}`;
  if (!akun) throw new KontrakError("akun tidak ditemukan", 404);
  const alat = await validasiAlat(sql, accountId, input.alat_ids);
  const id = await sql.begin(async (tx) => {
    const [dup] = await tx`SELECT id FROM kso_kontrak WHERE nomor_norm = upper(regexp_replace(btrim(${nomor}), '\\s+', ' ', 'g')) AND account_id = ${accountId}`;
    if (dup) throw new KontrakError(`kontrak dengan nomor ini sudah ada untuk akun ini (id ${dup.id})`, 409);
    const [row] = await tx`
      INSERT INTO kso_kontrak (nomor, account_id, mulai, berakhir, nkt, auto_renew, pic_nama, status, terverifikasi, sumber, catatan, created_by, updated_by)
      VALUES (${nomor}, ${accountId}, ${mulai}, ${berakhir}, ${nkt}, ${Boolean(input.auto_renew)}, ${input.pic_nama?.trim() || null},
              ${status}, true, 'manual', ${input.catatan?.trim() || null}, ${oleh}, ${oleh})
      RETURNING id`;
    for (const a of alat) await tx`INSERT INTO kso_kontrak_alat (kontrak_id, kso_asset_id) VALUES (${row.id}, ${a}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO kso_kontrak_log (kontrak_id, aksi, ke_status, catatan, oleh) VALUES (${row.id}, 'BUAT', ${status}, ${input.catatan?.trim() || null}, ${oleh})`;
    return String(row.id);
  });
  return (await getKontrak(id)).kontrak;
}

/** Ubah isi kontrak (bukan status). Kontrak RENEWED dikunci — riwayat periode lama. */
export async function ubahKontrak(id: string, input: InputKontrak, oleh: string | null): Promise<KontrakRow> {
  const sql = db();
  const kid = Number(id);
  const lama = (await getKontrak(id)).kontrak;
  if (lama.status === "RENEWED") throw new KontrakError("kontrak yang sudah diperpanjang tidak bisa diubah — ubah kontrak periode barunya", 409);
  const baru = {
    nomor: input.nomor === undefined ? lama.nomor : input.nomor.trim(),
    mulai: input.mulai === undefined ? lama.mulai : tglAtauNull(input.mulai, "tanggal mulai"),
    berakhir: input.berakhir === undefined ? lama.berakhir : tglAtauNull(input.berakhir, "tanggal berakhir"),
    nkt: input.nkt === undefined ? lama.nkt : angkaAtauNull(input.nkt, "NKT"),
    auto_renew: input.auto_renew === undefined ? lama.auto_renew : Boolean(input.auto_renew),
    pic_nama: input.pic_nama === undefined ? lama.pic_nama : (input.pic_nama?.trim() || null),
    catatan: input.catatan === undefined ? lama.catatan : (input.catatan?.trim() || null),
    terverifikasi: input.terverifikasi === undefined ? lama.terverifikasi : Boolean(input.terverifikasi),
  };
  if (!baru.nomor) throw new KontrakError("nomor kontrak wajib diisi");
  if (baru.mulai && baru.berakhir && baru.mulai > baru.berakhir) throw new KontrakError("tanggal mulai harus sebelum tanggal berakhir");
  const alat = input.alat_ids === undefined ? null : await validasiAlat(sql, Number(lama.account_id), input.alat_ids);
  const perubahan: Record<string, { dari: unknown; ke: unknown }> = {};
  for (const k of Object.keys(baru) as (keyof typeof baru)[]) {
    if (baru[k] !== lama[k]) perubahan[k] = { dari: lama[k], ke: baru[k] };
  }
  await sql.begin(async (tx) => {
    try {
      await tx`
        UPDATE kso_kontrak SET nomor = ${baru.nomor}, mulai = ${baru.mulai}, berakhir = ${baru.berakhir}, nkt = ${baru.nkt},
          auto_renew = ${baru.auto_renew}, pic_nama = ${baru.pic_nama}, catatan = ${baru.catatan},
          terverifikasi = ${baru.terverifikasi}, updated_by = ${oleh}, updated_at = now()
        WHERE id = ${kid}`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new KontrakError("nomor ini sudah dipakai kontrak lain di akun yang sama", 409);
      throw e;
    }
    if (alat) {
      await tx`DELETE FROM kso_kontrak_alat WHERE kontrak_id = ${kid}`;
      for (const a of alat) await tx`INSERT INTO kso_kontrak_alat (kontrak_id, kso_asset_id) VALUES (${kid}, ${a})`;
      perubahan.alat = { dari: lama.jumlah_alat, ke: alat.length };
    }
    if (Object.keys(perubahan).length) {
      const aksi = Object.keys(perubahan).length === 1 && perubahan.terverifikasi ? "VERIFIKASI" : "UBAH";
      await tx`INSERT INTO kso_kontrak_log (kontrak_id, aksi, perubahan, oleh) VALUES (${kid}, ${aksi}, ${sql.json(perubahan as never)}, ${oleh})`;
    }
  });
  return (await getKontrak(id)).kontrak;
}

export async function ubahStatusKontrak(id: string, ke: string, catatan: string | null, oleh: string | null): Promise<KontrakRow> {
  if (!STATUS_KONTRAK.includes(ke as StatusKontrak)) throw new KontrakError(`status tidak dikenal: ${ke}`);
  const sql = db();
  const kid = Number(id);
  await sql.begin(async (tx) => {
    const [k] = await tx`SELECT status FROM kso_kontrak WHERE id = ${Number.isInteger(kid) ? kid : -1} FOR UPDATE`;
    if (!k) throw new KontrakError("kontrak tidak ditemukan", 404);
    const tolak = alasanTolakStatus(k.status as StatusKontrak, ke as StatusKontrak, catatan);
    if (tolak) throw new KontrakError(tolak, 409);
    await tx`UPDATE kso_kontrak SET status = ${ke}, updated_by = ${oleh}, updated_at = now() WHERE id = ${kid}`;
    await tx`INSERT INTO kso_kontrak_log (kontrak_id, aksi, dari_status, ke_status, catatan, oleh)
             VALUES (${kid}, 'STATUS', ${k.status}, ${ke}, ${catatan?.trim() || null}, ${oleh})`;
  });
  return (await getKontrak(id)).kontrak;
}

/**
 * Perpanjang: kontrak lama → RENEWED (diganti_oleh = baru), periode baru dibuat
 * sebagai kontrak BARU (AKTIF, terverifikasi) dengan akun, PIC, auto-renew, dan
 * alat yang sama. Satu transaksi + kunci baris lama: dua klik bersamaan tidak
 * bisa menghasilkan dua periode baru.
 */
export async function perpanjangKontrak(
  id: string,
  input: { nomor?: string; mulai?: string | null; berakhir?: string | null; nkt?: number | string | null; catatan?: string | null },
  oleh: string | null,
): Promise<{ lama: KontrakRow; baru: KontrakRow }> {
  const nomor = input.nomor?.trim();
  if (!nomor) throw new KontrakError("nomor kontrak periode baru wajib diisi");
  const berakhir = tglAtauNull(input.berakhir, "tanggal berakhir");
  if (!berakhir) throw new KontrakError("tanggal berakhir periode baru wajib diisi");
  const mulai = tglAtauNull(input.mulai, "tanggal mulai");
  if (mulai && mulai > berakhir) throw new KontrakError("tanggal mulai harus sebelum tanggal berakhir");
  const nkt = angkaAtauNull(input.nkt, "NKT");
  const sql = db();
  const kid = Number(id);
  const idBaru = await sql.begin(async (tx) => {
    const [k] = await tx`SELECT * FROM kso_kontrak WHERE id = ${Number.isInteger(kid) ? kid : -1} FOR UPDATE`;
    if (!k) throw new KontrakError("kontrak tidak ditemukan", 404);
    if (k.status !== "AKTIF" && k.status !== "NEGO") throw new KontrakError(`kontrak berstatus ${k.status} tidak bisa diperpanjang`, 409);
    const [dup] = await tx`SELECT id FROM kso_kontrak WHERE nomor_norm = upper(regexp_replace(btrim(${nomor}), '\\s+', ' ', 'g')) AND account_id = ${k.account_id}`;
    if (dup) throw new KontrakError(`nomor ini sudah dipakai kontrak id ${dup.id} di akun yang sama`, 409);
    const [row] = await tx`
      INSERT INTO kso_kontrak (nomor, account_id, mulai, berakhir, nkt, auto_renew, pic_nama, status, terverifikasi, sumber, catatan, created_by, updated_by)
      VALUES (${nomor}, ${k.account_id}, ${mulai}, ${berakhir}, ${nkt ?? k.nkt}, ${k.auto_renew}, ${k.pic_nama},
              'AKTIF', true, 'manual', ${input.catatan?.trim() || null}, ${oleh}, ${oleh})
      RETURNING id`;
    await tx`INSERT INTO kso_kontrak_alat (kontrak_id, kso_asset_id) SELECT ${row.id}, kso_asset_id FROM kso_kontrak_alat WHERE kontrak_id = ${kid}`;
    await tx`UPDATE kso_kontrak SET status = 'RENEWED', diganti_oleh = ${row.id}, updated_by = ${oleh}, updated_at = now() WHERE id = ${kid}`;
    await tx`INSERT INTO kso_kontrak_log (kontrak_id, aksi, dari_status, ke_status, perubahan, catatan, oleh)
             VALUES (${kid}, 'PERPANJANG', ${k.status}, 'RENEWED', ${sql.json({ diganti_oleh: String(row.id), nomor_baru: nomor, berakhir_baru: berakhir } as never)}, ${input.catatan?.trim() || null}, ${oleh})`;
    await tx`INSERT INTO kso_kontrak_log (kontrak_id, aksi, ke_status, perubahan, oleh)
             VALUES (${row.id}, 'BUAT', 'AKTIF', ${sql.json({ perpanjangan_dari: String(kid) } as never)}, ${oleh})`;
    return String(row.id);
  });
  return { lama: (await getKontrak(id)).kontrak, baru: (await getKontrak(idBaru)).kontrak };
}

/**
 * Akun ber-alat KSO operasional + alatnya — pilihan saat membuat kontrak manual.
 * `berkontrak` = alat sudah tercakup kontrak AKTIF/NEGO (tetap boleh dipilih:
 * satu alat bisa pindah ke MoU baru, tapi UI memberi tanda).
 */
export async function akunKso() {
  const rows = await db()`
    SELECT a.account_id::text AS account_id, COALESCE(NULLIF(ac.name,''), 'Customer #' || a.account_id::text) AS nama,
      a.id::text AS alat_id, a.sn_raw, COALESCE(NULLIF(a.nama_alat,''), a.type_alat) AS nama_alat, a.nomor_mou,
      EXISTS (SELECT 1 FROM kso_kontrak_alat ka JOIN kso_kontrak k ON k.id = ka.kontrak_id
              WHERE ka.kso_asset_id = a.id AND k.status IN ('AKTIF', 'NEGO')) AS berkontrak
    FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
    LEFT JOIN accurate_customer ac ON ac.id = a.account_id
    WHERE v.status_kode = 'operasional' AND a.account_id IS NOT NULL
    ORDER BY 2, a.id`;
  const akun = new Map<string, { id: string; nama: string; alat: { id: string; sn: string | null; nama_alat: string | null; nomor_sheet: string | null; berkontrak: boolean }[] }>();
  for (const r of rows) {
    const id = String(r.account_id);
    if (!akun.has(id)) akun.set(id, { id, nama: String(r.nama), alat: [] });
    akun.get(id)!.alat.push({
      id: String(r.alat_id), sn: r.sn_raw ? String(r.sn_raw) : null, nama_alat: r.nama_alat ? String(r.nama_alat) : null,
      nomor_sheet: r.nomor_mou ? String(r.nomor_mou) : null, berkontrak: Boolean(r.berkontrak),
    });
  }
  return [...akun.values()];
}
