import { db } from "../db.js";

// F34 fase 2 — jembatan nomor KSO-n (aset tetap Accurate) ↔ kso_asset (kunci SN).
//
// Dasar keputusan (diagnostik prod 14 Okt 2026): satu-satunya kunci yang
// bersinyal adalah SN di kolom `notes` aset Accurate. Nama faskes tidak ada di
// Accurate (0 dari 577 cocok), tanggal/nilai tak membedakan (banyak saldo awal
// Rp 1 bertanggal 2024-12-31). Karena itu pencocokan HANYA di `notes`, bukan
// di `raw` — SN numerik pendek bisa nyangkut di id/nominal JSON.
//
// Modul ini hanya MENGUSULKAN. Penulisan = fixed_asset_override.kso_asset_id,
// dan hanya peringkat "pasti" yang boleh diterapkan massal.

export type Peringkat = "pasti" | "kandidat";

export interface AsetAcc { id: number; number: string; description: string | null; notes: string | null }
export interface AlatKso {
  id: number; sn_key: string; sn_raw: string | null; customer_raw: string;
  nama_alat: string | null; type_alat: string | null;
}
export interface Pasangan {
  peringkat: Peringkat;
  accurate_id: number; number: string; description: string | null; notes: string | null;
  kso_asset_id: number; sn_key: string; customer_raw: string; nama_alat: string | null;
  /** Kenapa bukan "pasti" (kosong untuk pasti). */
  alasan: string[];
}
export interface HasilRekon {
  pasti: Pasangan[];
  kandidat: Pasangan[];
  /** kso_asset aktif yang belum tertaut & tak punya usulan. */
  kso_tanpa_pasangan: AlatKso[];
  accurate_tanpa_pasangan: number;
}

/**
 * SN kanonik — SAMA dengan `norm_sn` di scripts/ops/kso-sheet-to-json.py
 * (yang membentuk kso_asset.sn_key), ditambah buang apostrof depan yang
 * Accurate/Excel sisipkan pada SN numerik panjang (`'83222604500768`).
 */
export function normSn(raw: unknown): string {
  let s = String(raw ?? "").trim().replace(/^['"`‘’]+/, "");
  if (!s) return "";
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  s = s.toUpperCase().replace(/\s+/g, "");
  return s.replace(/^0+/, "") || s;
}

const alnum = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const SN_MIN_PASTI = 5; // SN 4 digit (Nihon/Diesse) terlalu pendek untuk dipercaya otomatis
const SN_MIN_TERMUAT = 6;

// Kata umum yang ada di hampir semua deskripsi alat — bukan penanda merek/model.
const KATA_UMUM = new Set([
  "ANALYZER", "ANALYSER", "MACHINE", "MACHINES", "MESIN", "AUTO", "AUTOMATED", "SELF", "TYPE",
  "ALAT", "DIGITAL", "SET", "WITH", "KLINIK", "AUTOMATIC", "SYSTEM", "METER",
]);
const token = (s: string | null | undefined): Set<string> =>
  new Set((s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !KATA_UMUM.has(t)));

/**
 * Merek/model di `nama_alat` kso_asset muncul di deskripsi aset Accurate?
 * Penjaga terhadap SN yang kebetulan sama tapi alatnya lain. Jatuh ke
 * `type_alat` bila nama_alat kosong; bila keduanya kosong → tak bisa menilai
 * (dianggap tidak sejalan, supaya tak lolos "pasti" tanpa bukti).
 */
export function jenisSejalan(acc: Pick<AsetAcc, "description">, kso: Pick<AlatKso, "nama_alat" | "type_alat">): boolean {
  const k = token(kso.nama_alat?.trim() ? kso.nama_alat : kso.type_alat);
  if (k.size === 0) return false;
  const a = token(acc.description);
  for (const t of k) if (a.has(t)) return true;
  return false;
}

export function cocokkan(
  accList: AsetAcc[],
  ksoList: AlatKso[],
  tertaut: { accurateIds: Set<number>; ksoIds: Set<number> },
): HasilRekon {
  const bebas = accList.filter((a) => !tertaut.accurateIds.has(a.id));
  const accByKey = new Map<string, AsetAcc[]>();
  for (const a of bebas) {
    const k = normSn(a.notes);
    if (!k) continue;
    const arr = accByKey.get(k);
    if (arr) arr.push(a); else accByKey.set(k, [a]);
  }
  const accAlnum = bebas.map((a) => ({ a, n: alnum(a.notes) }));

  const pasti: Pasangan[] = [];
  const kandidat: Pasangan[] = [];
  const diusulkanAcc = new Set<number>();
  const diusulkanKso = new Set<number>();
  const mk = (p: Peringkat, a: AsetAcc, k: AlatKso, alasan: string[]): Pasangan => ({
    peringkat: p, accurate_id: a.id, number: a.number, description: a.description, notes: a.notes,
    kso_asset_id: k.id, sn_key: k.sn_key, customer_raw: k.customer_raw, nama_alat: k.nama_alat, alasan,
  });

  for (const k of ksoList) {
    if (tertaut.ksoIds.has(k.id) || k.sn_key.startsWith("NOSN:")) continue;
    const persis = accByKey.get(k.sn_key) ?? [];
    if (persis.length === 1) {
      const a = persis[0];
      const alasan: string[] = [];
      if (k.sn_key.length < SN_MIN_PASTI) alasan.push(`SN pendek (${k.sn_key.length} karakter)`);
      if (!jenisSejalan(a, k)) alasan.push("nama alat tak sejalan dengan deskripsi Accurate");
      if (alasan.length === 0) pasti.push(mk("pasti", a, k, []));
      else kandidat.push(mk("kandidat", a, k, alasan));
      diusulkanAcc.add(a.id); diusulkanKso.add(k.id);
    } else if (persis.length > 1) {
      for (const a of persis) kandidat.push(mk("kandidat", a, k, [`SN sama di ${persis.length} aset Accurate`]));
      for (const a of persis) diusulkanAcc.add(a.id);
      diusulkanKso.add(k.id);
    } else if (alnum(k.sn_key).length >= SN_MIN_TERMUAT) {
      const kn = alnum(k.sn_key);
      const hit = accAlnum.filter((x) => x.n.includes(kn));
      for (const { a } of hit) kandidat.push(mk("kandidat", a, k, ["SN termuat di dalam catatan Accurate (bukan sama persis)"]));
      if (hit.length) {
        for (const { a } of hit) diusulkanAcc.add(a.id);
        diusulkanKso.add(k.id);
      }
    }
  }

  return {
    pasti,
    kandidat,
    kso_tanpa_pasangan: ksoList.filter((k) => !tertaut.ksoIds.has(k.id) && !diusulkanKso.has(k.id)),
    accurate_tanpa_pasangan: bebas.filter((a) => !diusulkanAcc.has(a.id)).length,
  };
}

// ── DB ─────────────────────────────────────────────────────────────────────

export interface RingkasanRekon {
  accurate_kso_aktif: number;
  kso_aktif: number;
  sudah_tertaut: number;
  tertaut_per_sumber: Record<string, number>;
  pasti: number;
  kandidat: number;
  kso_tanpa_pasangan: number;
  accurate_tanpa_pasangan: number;
}
export interface PratinjauRekon extends HasilRekon { ringkasan: RingkasanRekon }

async function muat() {
  const sql = db();
  // KSO = prefiks KSO (alat) + KS (1 baris salah-ketik nomor di sumber). Yang dilepas
  // (disposed) tak lagi menghasilkan revenue → tak ikut dicocokkan.
  const acc = await sql<AsetAcc[]>`
    SELECT id::int, number, description, notes FROM accurate_fixed_asset
    WHERE prefix IN ('KSO', 'KS') AND NOT disposed ORDER BY number`;
  const kso = await sql<AlatKso[]>`
    SELECT id::int, sn_key, sn_raw, customer_raw, nama_alat, type_alat FROM kso_asset
    WHERE aktif ORDER BY id`;
  const link = await sql<{ accurate_id: number; kso_asset_id: number; tautan_sumber: string | null }[]>`
    SELECT accurate_id::int, kso_asset_id::int, tautan_sumber FROM fixed_asset_override
    WHERE kso_asset_id IS NOT NULL`;
  return { acc, kso, link };
}

export async function pratinjauRekon(): Promise<PratinjauRekon> {
  const { acc, kso, link } = await muat();
  const h = cocokkan(acc, kso, {
    accurateIds: new Set(link.map((l) => l.accurate_id)),
    ksoIds: new Set(link.map((l) => l.kso_asset_id)),
  });
  const per: Record<string, number> = {};
  for (const l of link) per[l.tautan_sumber ?? "manual"] = (per[l.tautan_sumber ?? "manual"] ?? 0) + 1;
  return {
    ...h,
    ringkasan: {
      accurate_kso_aktif: acc.length, kso_aktif: kso.length,
      sudah_tertaut: link.length, tertaut_per_sumber: per,
      pasti: h.pasti.length, kandidat: h.kandidat.length,
      kso_tanpa_pasangan: h.kso_tanpa_pasangan.length,
      accurate_tanpa_pasangan: h.accurate_tanpa_pasangan,
    },
  };
}

export interface HasilTerapkan { diterapkan: number; dilewati: number }

/**
 * Terapkan usulan. Tanpa `pilihan` → semua peringkat "pasti". Dengan `pilihan`
 * (pasangan yang dikonfirmasi orang) → hanya pasangan yang MASIH ada di usulan
 * hasil hitung ulang di server; klien tak bisa menautkan pasangan sembarang lewat
 * jalur ini. Tak pernah menimpa tautan yang sudah ada.
 */
export async function terapkanRekon(
  oleh: string | null,
  pilihan?: { accurate_id: number; kso_asset_id: number }[],
): Promise<HasilTerapkan> {
  const sql = db();
  const { acc, kso, link } = await muat();
  const h = cocokkan(acc, kso, {
    accurateIds: new Set(link.map((l) => l.accurate_id)),
    ksoIds: new Set(link.map((l) => l.kso_asset_id)),
  });
  let target: Pasangan[];
  if (pilihan) {
    const diminta = new Set(pilihan.map((p) => `${p.accurate_id}|${p.kso_asset_id}`));
    target = [...h.pasti, ...h.kandidat].filter((p) => diminta.has(`${p.accurate_id}|${p.kso_asset_id}`));
  } else {
    target = h.pasti;
  }
  // Satu alat / satu aset hanya sekali per tembakan (kandidat bisa berbagi).
  const pakaiAcc = new Set<number>();
  const pakaiKso = new Set<number>();
  const siap = target.filter((p) => {
    if (pakaiAcc.has(p.accurate_id) || pakaiKso.has(p.kso_asset_id)) return false;
    pakaiAcc.add(p.accurate_id); pakaiKso.add(p.kso_asset_id);
    return true;
  });
  let diterapkan = 0;
  await sql.begin(async (tx) => {
    for (const p of siap) {
      // Asal ditentukan JALURNYA, bukan peringkatnya: pasangan yang dipilih orang selalu
      // 'konfirmasi' (walau berperingkat pasti) agar tak ikut terhapus "batalkan otomatis".
      const sumber = pilihan ? "konfirmasi" : "otomatis";
      const r = await tx`
        INSERT INTO fixed_asset_override (accurate_id, kso_asset_id, tautan_sumber, tautan_at, updated_by, updated_at)
        VALUES (${p.accurate_id}, ${p.kso_asset_id}, ${sumber}, now(), ${oleh}, now())
        ON CONFLICT (accurate_id) DO UPDATE SET
          kso_asset_id = EXCLUDED.kso_asset_id, tautan_sumber = EXCLUDED.tautan_sumber,
          tautan_at = now(), updated_by = EXCLUDED.updated_by, updated_at = now()
        WHERE fixed_asset_override.kso_asset_id IS NULL
        RETURNING 1`;
      diterapkan += r.length;
    }
  });
  return { diterapkan, dilewati: target.length - diterapkan };
}

/** Batalkan SEMUA tautan hasil otomatis (peringkat pasti). Tautan manual/konfirmasi tak disentuh. */
export async function batalkanTautanOtomatis(oleh: string | null): Promise<number> {
  const sql = db();
  const r = await sql`
    UPDATE fixed_asset_override
       SET kso_asset_id = NULL, tautan_sumber = NULL, tautan_at = NULL, updated_by = ${oleh}, updated_at = now()
     WHERE tautan_sumber = 'otomatis' AND kso_asset_id IS NOT NULL
    RETURNING 1`;
  return r.length;
}

export interface AlatKsoCari extends AlatKso { tertaut_ke: string | null }

/** Pencarian alat KSO untuk penautan manual: SN, nama alat, atau faskes. */
export async function cariAlatKso(q: string, limit = 20): Promise<AlatKsoCari[]> {
  const sql = db();
  const s = q.trim();
  if (s.length < 2) return [];
  const like = `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return sql<AlatKsoCari[]>`
    SELECT k.id::int, k.sn_key, k.sn_raw, k.customer_raw, k.nama_alat, k.type_alat, a.number AS tertaut_ke
    FROM kso_asset k
    LEFT JOIN fixed_asset_override o ON o.kso_asset_id = k.id
    LEFT JOIN accurate_fixed_asset a ON a.id = o.accurate_id
    WHERE k.aktif AND (k.sn_key ILIKE ${like} OR k.sn_raw ILIKE ${like} OR k.nama_alat ILIKE ${like} OR k.customer_raw ILIKE ${like})
    ORDER BY (a.number IS NULL) DESC, k.nama_alat, k.id
    LIMIT ${Math.min(Math.max(limit, 1), 50)}`;
}
