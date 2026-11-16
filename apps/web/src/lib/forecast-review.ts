// F19 Forecast — kosakata wilayah/kategori dokumen dan label review HoD Sales
// (migrasi 326). Dulu diambil dari lib/approval-routing (F11); F11 tidak
// dibawa ke main, jadi F19 memakai salinan sendiri. Selaras WILAYAH/KATEGORI
// di apps/api/src/repo/forecast.ts.
export const WILAYAH_OPTIONS = [
  { value: "east", label: "East — Sales East" },
  { value: "west", label: "West — Sales West" },
] as const;

export const KATEGORI_OPTIONS = [
  { value: "IVD", label: "IVD" },
  { value: "Medical", label: "Medical" },
] as const;

export function labelWilayah(v: string | null | undefined): string {
  return WILAYAH_OPTIONS.find((o) => o.value === v)?.label.split(" — ")[0] ?? "—";
}

export interface ReviewInfo {
  status: string;
  reviewStatus: string | null;
  reviewRegion: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
}

export type VarianReview = "default" | "secondary" | "destructive" | "outline";

/**
 * Label lencana review satu dokumen. null = belum pernah diajukan.
 * Ditolak → dokumen sudah kembali draft; catatan penolakan tetap tampil
 * sampai diajukan ulang dan diputus lagi.
 */
export function labelReview(d: ReviewInfo): { label: string; variant: VarianReview; catatan: string | null } | null {
  const oleh = d.reviewedBy ? ` oleh ${d.reviewedBy}` : "";
  switch (d.reviewStatus) {
    case "menunggu":
      return { label: `Menunggu review HoD Sales${d.reviewRegion ? ` ${d.reviewRegion}` : ""}`, variant: "secondary", catatan: null };
    case "disetujui":
      return { label: `Disetujui${oleh}`, variant: "default", catatan: d.reviewNote };
    case "ditolak":
      return { label: `Ditolak${oleh}`, variant: "destructive", catatan: d.reviewNote };
    default:
      return null;
  }
}
