import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// Jalankan rekonsiliasi bon → SJ (otomatis bila tepat satu SJ cocok).
export async function POST() {
  return teruskan(null, "/bon-sparepart/rekonsiliasi", "POST");
}
