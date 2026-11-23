// Format angka & Rupiah SATU tempat (evaluasi menu 19 Nov 2026: 97 formatter
// buatan sendiri, "Rp 19.63 M" di samping "Rp 33,9 M").
//
// Kenapa wajib di sini, bukan `toFixed`: toFixed selalu memakai TITIK sebagai
// desimal, dan pembaca Indonesia membaca "19.63" sebagai sembilan belas ribu
// enam ratus tiga puluh — bukan 19,63. Intl id-ID menulis koma desimal & titik
// ribuan dengan benar.

const RP_PENUH = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const pemformat = new Map<number, Intl.NumberFormat>();
function angka(v: number, maksDesimal: number): string {
  let f = pemformat.get(maksDesimal);
  if (!f) {
    f = new Intl.NumberFormat("id-ID", { maximumFractionDigits: maksDesimal });
    pemformat.set(maksDesimal, f);
  }
  return f.format(v);
}

/** Rupiah penuh tanpa desimal: 1250000 → "Rp 1.250.000". null/NaN → Rp 0. */
export function fmtRp(n: number | null | undefined): string {
  return RP_PENUH.format(Number(n) || 0);
}

/**
 * Rupiah ringkas: ≥ 1 T → "Rp 1,25 T", ≥ 1 M → "Rp 19,63 M", ≥ 1 jt → "Rp 950 jt",
 * di bawahnya Rupiah penuh. Desimal koma, nol di belakang dibuang.
 * - `rapat`: tanpa spasi sebelum satuan ("Rp 1,2M") — untuk label sumbu grafik sempit.
 * - `desimalJt`: desimal untuk satuan jt (bawaan 0); mis. 1 di Price Book ("Rp 1,5 jt").
 */
export function fmtRpRingkas(
  n: number | null | undefined,
  o: { rapat?: boolean; desimalJt?: number } = {},
): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const s = o.rapat ? "" : " ";
  if (a >= 1e12) return `Rp ${angka(v / 1e12, 2)}${s}T`;
  if (a >= 1e9) return `Rp ${angka(v / 1e9, 2)}${s}M`;
  if (a >= 1e6) return `Rp ${angka(v / 1e6, o.desimalJt ?? 0)}${s}jt`;
  return fmtRp(v);
}

/** Angka biasa id-ID: 22712 → "22.712"; 1.5 → "1,5". null → "—". */
export function fmtAngka(n: number | null | undefined, maksDesimal = 2): string {
  return n == null || Number.isNaN(Number(n)) ? "—" : angka(Number(n), maksDesimal);
}
