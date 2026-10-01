// F11 Approval — kosakata atribut routing tahap (migrasi 190, #1071).
// Selaras WILAYAH/KATEGORI di apps/api/src/repo/approval.ts (API menolak
// nilai di luar daftar ini). Duplikat sengaja: dua daftar statis kecil, tak
// sepadan dengan endpoint baru.
export const WILAYAH_OPTIONS = [
  { value: "east", label: "East — Sales East" },
  { value: "west", label: "West — Sales West" },
] as const;

export const KATEGORI_OPTIONS = [
  { value: "IVD", label: "IVD — Business IVD" },
  { value: "Medical", label: "Medical — Business Medical" },
] as const;

export type WilayahValue = (typeof WILAYAH_OPTIONS)[number]["value"];
export type KategoriValue = (typeof KATEGORI_OPTIONS)[number]["value"];

export function labelWilayah(v: string | null | undefined): string {
  return WILAYAH_OPTIONS.find((o) => o.value === v)?.label.split(" — ")[0] ?? "—";
}
export function labelKategori(v: string | null | undefined): string {
  return KATEGORI_OPTIONS.find((o) => o.value === v)?.label.split(" — ")[0] ?? "—";
}
