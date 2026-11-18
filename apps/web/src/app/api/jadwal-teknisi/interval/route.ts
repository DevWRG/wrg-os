import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

// F154 334: interval PM per tipe alat & per alat (baca). Simpan lewat /interval-tipe dan /interval-alat (izin edit).
export const GET = () => teruskan(null, "/jadwal-teknisi/interval", "GET");
