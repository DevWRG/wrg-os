// Pemetaan nilai → warna untuk graf /network.
//
// Warnanya TIDAK ditulis sebagai hex di sini, melainkan sebagai var CSS yang
// didefinisikan dua kali di globals.css (terang & .dark). Alasannya: nilai gelap
// bukan pembalikan otomatis dari nilai terang — tiap langkah dipilih ulang dan
// divalidasi terhadap permukaan kartu mode itu. Menaruh hex di TSX membuat satu
// mode benar dan satu mode kira-kira.

export const LEVEL_URUT = ["Manual", "Digitalisasi", "Otomasi", "AI"] as const;
export type Level = (typeof LEVEL_URUT)[number];

const VAR_LEVEL: Record<Level, string> = {
  Manual: "var(--viz-level-1)",
  Digitalisasi: "var(--viz-level-2)",
  Otomasi: "var(--viz-level-3)",
  AI: "var(--viz-level-4)",
};

/** null = kolomnya belum diisi PIC — bukan "Manual". Pemanggil menggambarnya
 *  sebagai bingkai putus-putus, supaya bolong terbaca sebagai bolong. */
export function warnaLevel(level: string | null | undefined): string | null {
  if (!level) return null;
  return VAR_LEVEL[level as Level] ?? null;
}

/** Grup node di graf koordinasi. 'internal' & 'external' adalah satu-satunya
 *  pasangan warna; sisanya dibedakan lewat bentuk & garis putus-putus. */
export function warnaGrup(grup: string): string {
  return grup === "external" ? "var(--viz-external)" : "var(--viz-internal)";
}
