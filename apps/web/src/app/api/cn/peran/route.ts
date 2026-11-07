import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// Daftar HoD per peran CN (master_hod.peran) — pengisi pilihan HoD Sales/Business & cek Finance/GA.
export function GET() {
  return teruskan(null, "/cn/peran", "GET", "view");
}
