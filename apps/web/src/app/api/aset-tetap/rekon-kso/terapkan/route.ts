import { teruskanTulis } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Tanpa body = terapkan semua peringkat "pasti"; dengan { pilihan: [...] } = pasangan
// yang dikonfirmasi orang. Server menghitung ulang usulan, jadi pasangan sembarang ditolak.
export const POST = (req: Request) => teruskanTulis(req, "/aset-tetap/rekon-kso/terapkan", "POST");
