import { db, isDbEnabled } from "../db.js";

/**
 * Pengawas kesegaran mirror Accurate.
 *
 * KENAPA PERLU. `syncAccurateInvoices` menarik dengan JENDELA BERGULIR 7 hari
 * (accurateSync.ts: `const days = opts.days ?? 7`), bukan inkremental berbasis
 * watermark. Selama gangguan lebih pendek dari jendela itu, run berikutnya
 * menyapu ulang seluruh periode dan tak ada yang hilang — itu sebabnya libur
 * 4 hari (15–17 Agu 2026: akhir pekan + HUT RI) sama sekali tidak berbahaya.
 *
 * Yang berbahaya adalah gangguan LEBIH PANJANG dari jendela: faktur yang jatuh di
 * luar 7 hari tidak akan pernah ditarik lagi oleh siklus normal. Tidak ada error,
 * tidak ada baris hilang yang kelihatan — revenue hanya diam-diam kurang, permanen.
 * Kelas kesalahan yang sama dengan AR >90 hari yang dulu Rp 0 hijau (#806), tapi
 * lebih buruk: tak meninggalkan jejak untuk ditemukan belakangan.
 *
 * AMBANG DIHITUNG DALAM HARI KALENDER, BUKAN HARI KERJA — sengaja. Jendela 7 hari
 * itu sendiri kalender; ia tidak berhenti berjalan saat libur. Justru libur panjang
 * (Idul Fitri) adalah saat risikonya paling nyata, jadi alarm yang "sopan" terhadap
 * hari libur akan diam persis ketika paling dibutuhkan.
 *
 * Default 5 hari memberi jarak 2 hari sebelum kehilangan data mulai terjadi.
 */
export const SYNC_WINDOW_DAYS = 7;

export interface MirrorSource {
  sumber: string;
  lastSyncedAt: string | null;
  umurHari: number | null;
  stale: boolean;
}

export interface MirrorHealth {
  ok: boolean;
  ambangHari: number;
  jendelaSyncHari: number;
  /** Sisa hari sebelum data mulai jatuh di luar jendela tarik. */
  sisaHariSebelumKehilangan: number | null;
  sumber: MirrorSource[];
  catatan: string;
}

export function staleThresholdDays(): number {
  const raw = Number(process.env.MIRROR_STALE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

export async function mirrorFreshness(): Promise<MirrorHealth> {
  const ambang = staleThresholdDays();
  if (!isDbEnabled()) {
    return {
      ok: false, ambangHari: ambang, jendelaSyncHari: SYNC_WINDOW_DAYS,
      sisaHariSebelumKehilangan: null, sumber: [],
      catatan: "DATABASE_URL off — kesegaran mirror tak bisa dinilai",
    };
  }
  const sql = db();
  const rows = await sql<{ sumber: string; last_synced_at: string | null; umur: number | null }[]>`
    SELECT 'invoice' AS sumber, max(last_synced_at)::text AS last_synced_at,
           (CURRENT_DATE - max(last_synced_at)::date) AS umur FROM accurate_invoice
    UNION ALL SELECT 'sales_order', max(last_synced_at)::text, CURRENT_DATE - max(last_synced_at)::date FROM accurate_sales_order
    UNION ALL SELECT 'delivery_order', max(last_synced_at)::text, CURRENT_DATE - max(last_synced_at)::date FROM accurate_delivery_order
    UNION ALL SELECT 'customer', max(last_synced_at)::text, CURRENT_DATE - max(last_synced_at)::date FROM accurate_customer`;

  const sumber: MirrorSource[] = rows.map((r) => {
    const umur = r.umur === null || r.umur === undefined ? null : Number(r.umur);
    // Mirror yang belum pernah terisi (last_synced_at NULL) dihitung STALE, bukan
    // dilewati: "belum pernah sync" adalah kondisi yang justru perlu diteriakkan.
    return {
      sumber: r.sumber,
      lastSyncedAt: r.last_synced_at,
      umurHari: umur,
      stale: umur === null || umur >= ambang,
    };
  });

  const terburuk = sumber.reduce<number | null>(
    (a, s) => (s.umurHari === null ? a : a === null ? s.umurHari : Math.max(a, s.umurHari)),
    null,
  );
  const adaYangKosong = sumber.some((s) => s.umurHari === null);
  const sisa = terburuk === null ? null : SYNC_WINDOW_DAYS - terburuk;

  return {
    ok: !sumber.some((s) => s.stale),
    ambangHari: ambang,
    jendelaSyncHari: SYNC_WINDOW_DAYS,
    sisaHariSebelumKehilangan: sisa,
    sumber,
    catatan: adaYangKosong
      ? "Ada mirror yang belum pernah tersinkron sama sekali."
      : sisa !== null && sisa <= 0
        ? `Mirror tertinggal ${terburuk} hari — MELEWATI jendela tarik ${SYNC_WINDOW_DAYS} hari. Faktur di luar jendela tidak akan tertarik siklus normal; perlu sync manual dengan ?days= lebih besar.`
        : `Mirror tertinggal ${terburuk ?? 0} hari; sisa ${sisa} hari sebelum data mulai jatuh di luar jendela tarik.`,
  };
}
