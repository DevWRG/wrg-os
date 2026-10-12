// Resolusi SATU identitas customer dari daftar kandidat fuzzy — dipakai #CEK
// CUSTOMER (QW3, inbound-cek.ts) dan #CALL/#NOTE (F95, interaction.ts). Fungsi
// murni (tanpa DB) supaya aturan anti-salah-tempelnya bisa diuji
// (inbound-cek-resolve.test.ts). Asal-usul aturannya: issue #839 — dua customer
// bernama mirip saling mencuri hasil ketika tiap query memilih skor tertinggi
// sendiri-sendiri. Satu identitas atau BERTANYA, tak pernah memilih diam-diam.

const MAX_KANDIDAT = 5;

export interface CustCandidate {
  /** null di jalur fallback (identitas cuma punya nama, belum tentu ada di accurate_customer). */
  id: number | null;
  name: string;
  score: number;
}

export type CekResolve =
  | { kind: "none" }
  | { kind: "one"; name: string; ids: number[] }
  | { kind: "ambiguous"; names: string[] };

/** Normalisasi buat perbandingan nama: case-insensitive + rapikan spasi. */
export function normNama(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pilih SATU identitas customer dari daftar kandidat. Dipisah jadi fungsi
 * murni supaya aturan anti-bocornya bisa diuji tanpa DB
 * (apps/api/src/repo/inbound-cek-resolve.test.ts).
 *
 * Aturan:
 *  1. Ada kandidat yang namanya PERSIS sama dengan query → itu yang dipakai,
 *     tanpa peduli ada nama mirip lain yang skornya tinggi. Ini yang menutup
 *     kasus #5: "CV Sample Dua" tak lagi kalah oleh "CV Sample Satu" (0.588).
 *  2. Beberapa baris `accurate_customer` dengan nama sama = satu entitas yang
 *     kebetulan punya record kembar di Accurate (kasus faskes kembar 744/765).
 *     Semua id-nya dipakai — memilih salah satu diam-diam akan menyembunyikan
 *     SO/SJ yang tercatat di kembarannya.
 *  3. Lebih dari satu NAMA berbeda lolos ambang → ambigu, jangan pilih.
 */
export function resolveCustomer(q: string, rows: CustCandidate[]): CekResolve {
  const nq = normNama(q);
  const bersih = rows.filter((r) => r.name && r.name.trim() !== "");
  if (bersih.length === 0) return { kind: "none" };

  const persis = bersih.filter((r) => normNama(r.name) === nq);
  if (persis.length > 0) {
    return { kind: "one", name: persis[0].name, ids: idsDari(persis) };
  }

  // Kelompokkan per nama ternormalisasi — dua record kembar bukan dua kandidat.
  const grup = new Map<string, CustCandidate[]>();
  for (const r of [...bersih].sort((a, b) => b.score - a.score)) {
    const k = normNama(r.name);
    const g = grup.get(k);
    if (g) g.push(r);
    else grup.set(k, [r]);
  }
  const kelompok = [...grup.values()];
  if (kelompok.length === 1) {
    return { kind: "one", name: kelompok[0][0].name, ids: idsDari(kelompok[0]) };
  }
  return { kind: "ambiguous", names: kelompok.slice(0, MAX_KANDIDAT).map((g) => g[0].name) };
}

function idsDari(rows: CustCandidate[]): number[] {
  return [...new Set(rows.map((r) => r.id).filter((v): v is number => v != null))];
}
