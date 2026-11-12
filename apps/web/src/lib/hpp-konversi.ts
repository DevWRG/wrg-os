// Murni: pratinjau Konversi satuan HPP di browser. Cermin apps/api/src/repo/hpp-konversi.ts
// (hppPerSatuan, gpPct) dan fungsi SQL hpp_item_satuan (migrasi 309).

/** Teks input → angka; "" = null; koma desimal diterima; tak valid = NaN. */
export function bacaAngka(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  // "1.000,5" (gaya Indonesia) → 1000.5; "2,5" → 2.5; "2.5" → 2.5.
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

/** HPP per satuan Accurate: override menang; isi membagi HPP kemasan; tanpa keduanya = HPP kemasan. */
export function hppPerSatuan(hppKemasan: number | null, isi: number | null, override: number | null): number | null {
  if (override != null) return override;
  if (hppKemasan == null) return null;
  return isi != null && isi > 0 ? hppKemasan / isi : hppKemasan;
}

/** GP% = (net − hpp × qty) / net, 1 desimal; null bila net ≤ 0 / HPP tak ada. */
export function gpPct(net: number, qty: number, hpp: number | null): number | null {
  if (hpp == null || !(net > 0)) return null;
  return Math.round(((net - hpp * qty) / net) * 1000) / 10;
}

/** Pesan galat isian (null = sah). Minimal satu terisi; isi > 0; HPP ≥ 0. */
export function galatIsian(isi: number | null, override: number | null): string | null {
  if (Number.isNaN(isi) || Number.isNaN(override)) return "Angka tidak valid";
  if (isi == null && override == null) return "Isi per kemasan atau HPP per satuan wajib diisi";
  if (isi != null && !(isi > 0)) return "Isi per kemasan harus lebih dari 0";
  if (override != null && override < 0) return "HPP per satuan tidak boleh negatif";
  return null;
}
