// Pemetaan cabang → region (OFFICE / West / East) untuk kartu Sales Performance.
//
// Sumber nama cabang = master_user.cabang (fallback accurate_salesman.cabang_override),
// sama seperti breakdown per-cabang di reportRevenue(). Isi map di bawah sesuai
// daftar cabang produksi (case-sensitive, persis seperti tersimpan di DB, mis.
// "SURABAYA 2"). Cabang yang belum ada di map → default OFFICE (koreksi di sini).

export type Region = "OFFICE" | "West" | "East";

// Urutan tampil di kartu (atas → bawah).
export const REGIONS: Region[] = ["East", "West", "OFFICE"];

// TODO(user): isi mapping cabang → region. Contoh:
//   "SURABAYA 2": "East",
//   "MALANG": "East",
//   "BANDUNG": "West",
export const CABANG_REGION: Record<string, Region> = {};

const DEFAULT_REGION: Region = "OFFICE";

export function regionOf(cabang: string | null | undefined): Region {
  if (!cabang) return DEFAULT_REGION;
  return CABANG_REGION[cabang] ?? DEFAULT_REGION;
}
